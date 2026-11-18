import type { SessionOrigins } from '../session/sessionOrigins.js'
import type { SessionOrigin } from '../../shared/sessionOrigin.js'
export type { SessionOrigin } from '../../shared/sessionOrigin.js'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import type { Engine, EngineOptions } from './engine.js'
import type { ManagedWorktree } from '../vcs/worktrees.js'
import type { PermissionDecision, SessionSettings } from '../../shared/protocol.js'
import { INITIAL_ATTENTION, type SessionAttention } from '../../shared/sessionAttention.js'
import { initialThreadState, threadReducer, type LoadedEntry, type ThreadAction, type ThreadState } from '../../shared/thread.js'
import type { ChatWorkspaces } from '../workspace/chats.js'

/** Stable desktop ID, independent of the CLI ID assigned at initialization/fork. */
export type SessionSnapshot = {
  id: string
  cwd: string
  chat?: boolean
  worktree?: ManagedWorktree
  revision: number
  updatedAt: number
  settings: SessionSettings
  state: ThreadState
  attention: SessionAttention
  /**
   * Qui a ouvert cette session, quand ce n'est pas l'utilisateur.
   *
   * Absent pour une session ouverte à la main — le cas courant n'a pas besoin
   * d'être annoncé. Renseigné pour une exécution déclenchée par une routine :
   * sans cela, on retrouve au réveil des conversations qu'on n'a pas lancées,
   * sans savoir laquelle des routines en est l'auteur ni pourquoi elle a
   * tourné cette nuit-là.
   */
  origin?: SessionOrigin
}

type ManagedSession = { engine: Engine; snapshot: SessionSnapshot; result?: boolean; originSavedFor?: string; timer?: ReturnType<typeof setTimeout> }
type FactoryOptions = Pick<EngineOptions, 'cwd' | 'settings' | 'resumeSessionId' | 'chat'> & { diagnosticSessionId: string }

export function sameWorkspace(a: string, b: string): boolean {
  const normalize = (p: string) => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p)
  return normalize(a) === normalize(b)
}

/** Owns sessions, including background streams and pending permissions. No active-session global. */
export class EngineManager extends EventEmitter {
  private sessions = new Map<string, ManagedSession>()
  private viewed: string | null = null
  private workspaceMutation: string | null = null

  constructor(private readonly factory: (options: FactoryOptions) => Engine, private readonly origins?: SessionOrigins, private readonly chats?: ChatWorkspaces) { super() }

  createChat(settings: SessionSettings): SessionSnapshot {
    if (!this.chats) throw Error('Le dossier des chats est indisponible.')
    return this.create(this.chats.create(), { ...settings, extraDirs: [], projectInstructions: undefined })
  }

  create(cwd: string, settings: SessionSettings, worktree?: ManagedWorktree, origin?: SessionOrigin): SessionSnapshot {
    return this.add(cwd, settings, undefined, [], worktree, origin)
  }

  find(cwd: string, sessionId: string): SessionSnapshot | undefined {
    return this.list().find(s => sameWorkspace(s.cwd, cwd) &&
      (s.id === sessionId || s.state.status.sessionId === sessionId))
  }

  resume(cwd: string, sessionId: string, settings: SessionSettings, entries: LoadedEntry[], worktree?: ManagedWorktree, updatedAt = 0): SessionSnapshot {
    return this.find(cwd, sessionId) ?? this.add(cwd, settings, sessionId, entries, worktree, this.origins?.read(cwd, sessionId), updatedAt)
  }

  private add(cwd: string, settings: SessionSettings, resumeSessionId?: string, entries: LoadedEntry[] = [], worktree?: ManagedWorktree, origin?: SessionOrigin, updatedAt = Date.now()): SessionSnapshot {
    if (!cwd.trim()) throw new Error('Choisissez un dossier de travail.')
    const id = randomUUID()
    const savedSettings = structuredClone(settings)
    const chat = this.chats?.owns(cwd)
    const engine = this.factory({ cwd, settings: savedSettings, resumeSessionId, chat, diagnosticSessionId: id })
    const session: ManagedSession = {
      engine,
      snapshot: { id, cwd, ...(chat ? { chat: true } : {}), worktree, origin: origin ? { ...origin } : undefined, settings: savedSettings, revision: 0, updatedAt, attention: { ...INITIAL_ATTENTION },
        state: resumeSessionId
          ? threadReducer(initialThreadState, { type: 'load-transcript', entries, sessionId: resumeSessionId })
          : threadReducer(initialThreadState, { type: 'reset' }) },
    }
    this.sessions.set(id, session)
    engine.on('message', message => this.reduce(session, { type: 'engine-message', message }))
    engine.on('permission-cleared', requestId => {
      if (session.snapshot.state.pending?.requestId === requestId) this.reduce(session, { type: 'permission-resolved', decision: 'deny' })
    })
    engine.on('notice', notice => this.reduce(session, { type: 'notice', ...notice }))
    engine.on('settings', settings => {
      session.snapshot = { ...session.snapshot, settings: structuredClone(settings), revision: session.snapshot.revision + 1 }
      this.publish(session)
    })
    engine.on('turn-end', (outcome?: { cancelled: boolean; failed: boolean }) => {
      if (!session.snapshot.state.status.busy) return
      const phase = outcome?.cancelled || session.snapshot.state.cancelling ? 'interrupted'
        : (outcome ? !outcome.failed : session.result === true) ? 'done' : 'failed'
      session.snapshot = { ...session.snapshot, attention: { ...session.snapshot.attention,
        phase, endedAt: Date.now(), eventId: session.snapshot.attention.eventId + 1, unread: this.viewed !== id } }
      this.reduce(session, { type: 'turn-end', outcome: phase })
      this.publish(session)
      this.emit('turn-end', id)
    })
    return session.snapshot
  }

  private require(id: string): ManagedSession {
    const session = this.sessions.get(id)
    if (!session) throw new Error('Session inconnue. Rouvrez la conversation.')
    return session
  }

  get(id: string): SessionSnapshot { return this.require(id).snapshot }
  list(): SessionSnapshot[] { return [...this.sessions.values()].map(s => s.snapshot) }
  get isBusy(): boolean { return [...this.sessions.values()].some(s => s.engine.isBusy) }

  /** Keep new manual and scheduled turns out while shared files are being changed. */
  async withIdleWorkspace<T>(action: () => Promise<T>, operation = 'Git'): Promise<T> {
    if (this.workspaceMutation || this.isBusy || this.list().some(session => session.state.status.busy)) {
      throw new Error(`Attendez la fin des tours ou opérations en cours avant cette opération ${operation}.`)
    }
    this.workspaceMutation = operation
    try { return await action() }
    finally { this.workspaceMutation = null }
  }

  /**
   * Sessions en plein tour dans ce dossier.
   *
   * Restaurer des fichiers pendant qu'un tour les écrit ferait perdre du
   * travail des deux côtés. Le dossier est le bon périmètre, pas la session :
   * plusieurs sessions ouvertes au même endroit écrivent les mêmes fichiers,
   * et celle qui restaure n'est pas forcément celle qui édite.
   */
  busyIn(cwd: string): SessionSnapshot[] {
    return [...this.sessions.values()]
      .filter(s => sameWorkspace(s.snapshot.cwd, cwd) && (s.engine.isBusy || s.snapshot.state.status.busy))
      .map(s => s.snapshot)
  }

  /** The main window supplies this only while it is focused and showing the session. */
  setViewed(id: string | null): void {
    // Window events can arrive after logout or session cleanup.
    const session = id ? this.sessions.get(id) : undefined
    this.viewed = session?.snapshot.id ?? null
    if (!session?.snapshot.attention.unread) return
    session.snapshot = { ...session.snapshot, revision: session.snapshot.revision + 1,
      attention: { ...session.snapshot.attention, unread: false } }
    this.publish(session)
  }

  private reduce(session: ManagedSession, action: ThreadAction): void {
    const previous = session.snapshot
    const state = threadReducer(session.snapshot.state, action)
    let attention = previous.attention
    const now = Date.now()
    if (action.type === 'user-submit') {
      session.result = undefined
      attention = { ...attention, phase: 'working', startedAt: now, endedAt: null, lastActivityAt: now, unread: false }
    } else if (action.type === 'engine-message' || action.type === 'notice' || action.type === 'turn-end') {
      attention = { ...attention, lastActivityAt: now }
    }
    if (action.type === 'engine-message' && action.message.type === 'result') {
      session.result = action.message.is_error === false && action.message.subtype === 'success'
    }
    if (state.pending && state.pending.requestId !== previous.state.pending?.requestId) {
      attention = { ...attention, phase: 'waiting', eventId: attention.eventId + 1, unread: this.viewed !== previous.id }
    } else if (previous.state.pending && !state.pending && action.type !== 'turn-end') {
      attention = { ...attention, phase: state.status.busy ? 'working' : 'idle', unread: false }
    }
    session.snapshot = { ...session.snapshot, revision: session.snapshot.revision + 1,
      attention,
      updatedAt: action.type === 'user-submit' ? Date.now() : session.snapshot.updatedAt,
      state: session.engine.isBusy ? { ...state, status: { ...state.status, busy: true } } : state }
    const transcriptId = state.status.sessionId
    if (this.origins && session.snapshot.origin && transcriptId && session.originSavedFor !== transcriptId
      && (previous.state.status.sessionId !== transcriptId || action.type === 'turn-end')) {
      try {
        this.origins.write(session.snapshot.cwd, transcriptId, session.snapshot.origin)
        session.originSavedFor = transcriptId
      } catch (error) {
        this.emit('origin-error', error)
      }
    }
    // Coalesce token bursts. Snapshots also recover all live state after a renderer reload.
    session.timer ??= setTimeout(() => this.publish(session), 30)
  }

  private publish(session: ManagedSession): void {
    clearTimeout(session.timer)
    session.timer = undefined
    this.emit('session', session.snapshot)
  }

  /** Subscribe before sending so even a synchronous launch failure is recorded. */
  waitForTurnEnd(id: string): Promise<{cancelled:boolean;failed:boolean;sessionId?:string}> {
    const session = this.require(id)
    return new Promise(resolve => session.engine.once('turn-end', () => resolve({
      cancelled: session.snapshot.attention.phase === 'interrupted',
      failed: session.snapshot.attention.phase === 'failed',
      sessionId: session.snapshot.state.status.sessionId ?? undefined,
    })))
  }

  send(id: string, text: string, content: string | unknown[]): Promise<void> {
    if (this.workspaceMutation) throw new Error(`Une opération ${this.workspaceMutation} est en cours. Renvoyez votre message après sa fin.`)
    const session = this.require(id)
    if (session.engine.isBusy || session.snapshot.state.status.busy) throw new Error('Un tour est déjà en cours dans cette session.')
    this.reduce(session, { type: 'user-submit', text })
    this.publish(session)
    return session.engine.send(content)
  }


  interrupt(id: string): void {
    const session = this.require(id)
    if (!session.engine.isBusy) return
    this.reduce(session, { type: 'interrupt-requested' })
    session.engine.interrupt()
  }

  permission(id: string, requestId: string, decision: PermissionDecision): void {
    const session = this.require(id)
    if (session.snapshot.state.cancelling || session.snapshot.state.pending?.requestId !== requestId) return
    session.engine.respondToPermission(requestId, decision)
    this.reduce(session, { type: 'permission-resolved', decision: decision.behavior })
  }

  updateSettings(id: string, settings: SessionSettings): SessionSnapshot {
    const session = this.require(id)
    const savedSettings = structuredClone(settings)
    session.engine.updateSettings(savedSettings)
    session.snapshot = { ...session.snapshot, settings: savedSettings, revision: session.snapshot.revision + 1 }
    this.publish(session)
    return session.snapshot
  }

  fork(id: string, chat = false): SessionSnapshot {
    const source = this.require(id)
    if (source.engine.isBusy) throw new Error('Attendez la fin du tour avant de forker cette session.')
    const sessionId = source.engine.currentSessionId
    if (!sessionId) throw new Error('Cette session n’a pas encore de transcript à forker.')
    const isolated = (source.snapshot.chat || chat) && this.chats
    const cwd = isolated ? isolated.create() : source.snapshot.cwd
    const settings = isolated ? { ...source.snapshot.settings, extraDirs: [], projectInstructions: undefined } : source.snapshot.settings
    const snapshot = this.add(cwd, settings, sessionId, [], isolated ? undefined : source.snapshot.worktree)
    const fork = this.require(snapshot.id)
    fork.engine.forkOnNextTurn(isolated ? source.snapshot.cwd : undefined)
    fork.snapshot = { ...snapshot, state: { ...structuredClone(source.snapshot.state),
      pending: null, cancelling: false, status: { ...source.snapshot.state.status, sessionId: null, busy: false } } }
    return fork.snapshot
  }

  /** A provider failure stops work without discarding the open conversations. */
  stopTurns(): void {
    for (const session of this.sessions.values()) {
      if (session.engine.isBusy) this.reduce(session, { type: 'interrupt-requested' })
      session.engine.stop()
    }
  }

  stopAll(): void {
    for (const session of this.sessions.values()) {
      session.engine.stop()
      clearTimeout(session.timer)
      session.engine.removeAllListeners()
    }
    this.sessions.clear()
    this.viewed = null
  }
}
