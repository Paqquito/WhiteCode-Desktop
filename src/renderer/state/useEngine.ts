import * as React from 'react'
import type { EngineApi, Notice, Project, SessionSnapshot, WorktreeRequest } from '../../main/preload.js'
import type { SessionSettings, ThreadEntry } from '#desktop/session-protocol'
import { initialThreadState } from '#desktop/conversation-state'
import { loadSettings } from './useSettings.js'
import { usePreferences } from './usePreferences.js'
import { mergeSessionProjects, newerSession } from './sessions.js'
import { INITIAL_ATTENTION } from '../../shared/sessionAttention.js'

declare global { interface Window { engine: EngineApi } }
export type EngineController = ReturnType<typeof useEngine>['cells'][number]
type Selection = { ids: string[]; focused: string | null }
const SELECTION_KEY = 'desktop:cells'

export function useEngine(workspace: string, onTurnEnd: () => void, setWorkspace: (cwd: string) => void) {
  const [sessions, setSessions] = React.useState<Record<string, SessionSnapshot>>({})
  const cache = React.useRef(sessions)
  const [selection, setSelection] = React.useState<Selection>({ ids: [], focused: null })
  const selected = React.useRef(selection)
  const defaults = React.useRef(loadSettings())
  const codeWorkspace = React.useRef(workspace)
  const lastSession = React.useRef<{ chat?: string; code?: string }>({})
  if (!codeWorkspace.current && workspace) codeWorkspace.current = workspace
  const newSessionMode = usePreferences().value.newSessionMode
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [notice, setNotice] = React.useState<Notice | null>(null)
  const navigation = React.useRef(0)
  const splitting = React.useRef(false)
  const [splitPending, setSplitPending] = React.useState(false)
  const bootstrap = React.useRef<Promise<SessionSnapshot[]> | null>(null)
  const refresh = React.useRef(onTurnEnd)
  refresh.current = onTurnEnd

  const accept = React.useCallback((snapshot: SessionSnapshot) => {
    cache.current = newerSession(cache.current, snapshot)
    setSessions(cache.current)
  }, [])
  const report = React.useCallback((id: string | null, error: unknown) => {
    setErrors(previous => ({ ...previous, [id ?? 'global']: String(error) }))
  }, [])
  const commit = React.useCallback((next: Selection) => {
    selected.current = next
    setSelection(next)
    const snapshot = next.focused ? cache.current[next.focused] : undefined
    if (snapshot) {
      lastSession.current[snapshot.chat ? 'chat' : 'code'] = snapshot.id
      if (!snapshot.chat) codeWorkspace.current = snapshot.cwd
      setWorkspace(snapshot.cwd)
    }
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify(next)) } catch { /* Window-only layout. */ }
    void window.engine.viewSession(next.focused).catch(error => report(next.focused, error))
  }, [report, setWorkspace])
  const select = React.useCallback((snapshot: SessionSnapshot, slot: number) => {
    accept(snapshot)
    const ids = [...selected.current.ids]
    // A session has only one visible cell. Selecting it again focuses that cell.
    if (!ids.includes(snapshot.id)) ids[Math.min(slot, ids.length)] = snapshot.id
    commit({ ids, focused: snapshot.id })
  }, [accept, commit])
  const focusSession = React.useCallback((id: string) => {
    if (selected.current.focused === id || !selected.current.ids.includes(id)) return
    ++navigation.current
    commit({ ...selected.current, focused: id })
  }, [commit])

  React.useEffect(() => {
    const offSession = window.engine.onSession(accept)
    const offEnd = window.engine.onTurnEnd(() => refresh.current())
    const offNotice = window.engine.onNotice(setNotice)
    const offOpen = window.engine.onOpenSession(id => {
      const version = ++navigation.current
      const slot = Math.max(0, selected.current.ids.indexOf(selected.current.focused ?? ''))
      void window.engine.getSession(id).then(snapshot => {
        if (version === navigation.current) select(snapshot, slot)
      }).catch(error => report(id, error))
    })
    return () => { offSession(); offEnd(); offNotice(); offOpen() }
  }, [accept, report, select])

  React.useEffect(() => {
    if (!workspace || selected.current.focused) return
    let cancelled = false
    bootstrap.current ??= window.engine.liveSessions().then(async list => list.length
      ? list : [await window.engine.createSession(workspace, defaults.current, undefined, true)])
    void bootstrap.current.then(async list => {
      const requested = await window.engine.requestedSession()
      if (cancelled || selected.current.focused) return
      list.forEach(accept)
      let saved: Partial<Selection> = {}
      try { saved = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? '{}') ?? {} } catch { /* Invalid saved layout. */ }
      const ids = Array.isArray(saved.ids) ? [...new Set(saved.ids)].filter(id => list.some(s => s.id === id)).slice(0, 2) : []
      const latest = [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0]
      if (!ids.length && latest) ids.push(latest.id)
      let focused = ids.includes(saved.focused ?? '') ? saved.focused! : ids[0] ?? null
      if (requested && list.some(s => s.id === requested)) {
        if (!ids.includes(requested)) ids[Math.max(0, ids.indexOf(focused ?? ''))] = requested
        focused = requested
      }
      commit({ ids, focused })
    }).catch(error => report(null, error))
    return () => { cancelled = true }
  }, [workspace, accept, commit, report])

  const navigate = React.useCallback(async (operation: Promise<SessionSnapshot>, slot: number, propagate = false) => {
    const version = ++navigation.current
    try {
      const snapshot = await operation
      accept(snapshot)
      if (version === navigation.current) select(snapshot, slot)
      return snapshot
    } catch (error) { if (propagate) throw error; report(selected.current.focused, error) }
  }, [accept, select, report])

  const split = React.useCallback(async () => {
    const current = selected.current
    if (splitting.current || current.ids.length !== 1 || !current.focused) return
    splitting.current = true; setSplitPending(true)
    const source = cache.current[current.focused]!
    try { await navigate(window.engine.createSession(source.cwd, source.settings, undefined, source.chat), 1) }
    finally { splitting.current = false; setSplitPending(false) }
  }, [navigate])
  const closeSplit = React.useCallback(() => {
    ++navigation.current
    const id = selected.current.focused
    if (id) commit({ ids: [id], focused: id })
  }, [commit])

  const switchMode = (chat: boolean) => {
    const { ids, focused } = selected.current
    const current = focused ? cache.current[focused] : undefined
    if (!current || Boolean(current.chat) === chat) return
    const slot = Math.max(0, ids.indexOf(current.id))
    const previous = lastSession.current[chat ? 'chat' : 'code']
    const latest = (previous ? cache.current[previous] : undefined)
      ?? Object.values(cache.current).filter(session => Boolean(session.chat) === chat).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) {
      ++navigation.current
      select(latest, slot)
    } else {
      const permissionMode = newSessionMode === 'inherit' ? current.settings.permissionMode : newSessionMode
      void navigate(window.engine.createSession(codeWorkspace.current, { ...current.settings, permissionMode, extraDirs: [] }, undefined, chat), slot)
    }
  }

  const controller = (id: string | null, slot: number) => {
    const session = id ? sessions[id] : undefined
    const state = session?.state ?? initialThreadState
    const settings = session?.settings ?? defaults.current
    const updateSettings = (update: React.SetStateAction<SessionSettings>) => {
      const current = id ? cache.current[id] : undefined
      const next = typeof update === 'function' ? update(current?.settings ?? defaults.current) : update
      defaults.current = next
      try { localStorage.setItem('desktop:settings', JSON.stringify(next)) } catch { /* Session-only settings. */ }
      if (!current || !id) return
      accept({ ...current, settings: next })
      void window.engine.setSessionSettings(id, next).then(accept).catch(error => report(id, error))
    }
    type SendOptions = Parameters<typeof window.engine.send> extends [string, string, string | unknown[], ...infer Options] ? Options : never
    const send = (text: string, content?: string | unknown[], ...options: SendOptions) => {
      if (!id || !text.trim() || !cache.current[id] || cache.current[id]!.state.status.busy) return
      setErrors(previous => ({ ...previous, [id]: '' }))
      void window.engine.send(id, text.trim(), content ?? text.trim(), ...options).catch(error => report(id, error))
    }
    const interrupt = () => { if (id) void window.engine.interrupt(id).catch(error => report(id, error)) }
      const decidePermission = (allow: boolean, input?: Record<string, unknown>) => {
      if (!id || !state.pending) return
      void window.engine.respondToPermission(id, state.pending.requestId, allow
          ? { behavior: 'allow', updatedInput: input ?? state.pending.input }
        : { behavior: 'deny', message: 'Refusé depuis l’application.' }).catch(error => report(id, error))
    }
    const error = errors[id ?? 'global'] || errors.global
    const entries: ThreadEntry[] = !error && !notice ? state.entries : [...state.entries,
      ...(error ? [{ id: 'desktop-error', kind: 'notice' as const, tone: 'error' as const, text: error }] : []),
      ...(notice ? [{ id: 'desktop-notice', kind: 'notice' as const, ...notice }] : [])]
    return { threadState: state, cancelling: state.cancelling, liveSessionIds: Object.keys(sessions), entries, pending: state.pending, status: state.status, settings, updateSettings,
      origin: session?.origin, attention: session?.attention ?? INITIAL_ATTENTION, workspace: session?.cwd ?? workspace, worktree: session?.worktree, chat: session?.chat,
      activeId: id, ready: Boolean(session), send, interrupt, decidePermission,
      /**
       * Ouvre une session neuve.
       *
       * `sources` vient du projet : les dossiers qu'il déclare sont ajoutés aux
       * dossiers accessibles de la session. Réunis ici plutôt que dans le
       * formulaire — c'est un réglage du projet, il ne doit pas se redemander
       * ni se ressaisir à chaque ouverture.
       */
      startNewSession: (cwd = session?.cwd ?? workspace, worktree?: WorktreeRequest, propagate = false, sources?: readonly string[], chat = false) => {
        const extraDirs = sources?.length
          ? [...new Set([...(cwd === session?.cwd ? settings.extraDirs : []), ...sources])]
          : cwd === session?.cwd ? settings.extraDirs : []
        // « Mode des nouvelles conversations » : hérité de la conversation
        // affichée, sauf si les préférences en fixent un.
        const permissionMode = newSessionMode === 'inherit' ? settings.permissionMode : newSessionMode
        return navigate(window.engine.createSession(cwd, { ...settings, extraDirs, permissionMode }, worktree, chat), slot, propagate)
      },
      openSession: (sessionId: string, cwd: string) => navigate(window.engine.resumeSession(sessionId, cwd, settings), slot),
      forkSession: async (chat?: boolean) => { if (id) return navigate(window.engine.forkSession(id, chat), slot) } }
  }
  const cells = selection.ids.map(controller)
  const active = cells.find(c => c.activeId === selection.focused) ?? controller(null, 0)
  return { ...active, cells, split, closeSplit, splitPending, focusSession, switchMode, codeWorkspace: codeWorkspace.current,
    mergeProjects: (projects: Project[]) => mergeSessionProjects(projects, Object.values(sessions)) }
}
