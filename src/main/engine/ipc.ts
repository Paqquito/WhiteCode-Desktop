/**
 * Canaux du moteur et des sessions.
 *
 * Un seul de ces canaux ne se contente pas de relayer : `engine:create` peut
 * créer un worktree avant d'ouvrir la session, et passe donc par la file des
 * opérations d'arborescence.
 */

import type { IpcMain } from 'electron'
import { realpath } from 'node:fs/promises'
import type { ProjectMetaStore } from '../workspace/projectMeta.js'
import type { MainContext } from '#desktop/workbench-context'
import type { SessionSettings } from '#desktop/session-protocol'
import type { PermissionDecision } from '#desktop/session-protocol'
import type { WorktreeRequest, Worktrees } from '../vcs/worktrees.js'
import { readTranscript, readSessionSummary } from '#desktop/session-history'

export function registerEngineIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: { worktrees: Worktrees; projectMeta?: ProjectMetaStore },
): void {
  ipcMain.handle(
    'engine:send',
    (_event, payload: { id: string; text: string; content: string | unknown[] }) =>
      ctx.engines().send(payload.id, payload.text, payload.content),
  )

  ipcMain.handle(
    'engine:permission',
    (
      _event,
      payload: { id: string; requestId: string; decision: PermissionDecision },
    ) => {
      ctx.engines().permission(payload.id, payload.requestId, payload.decision)
    },
  )

  ipcMain.handle('engine:interrupt', (_event, id: string) => {
    ctx.engines().interrupt(id)
  })

  ipcMain.handle('engine:fork', (_event, id: string, chat?: boolean) => {
    return ctx.engines().fork(id, chat === true)
  })

  ipcMain.handle('engine:create', (_event, payload: { cwd: string; settings: SessionSettings; worktree?: WorktreeRequest; chat?: boolean }) => ctx.workspaceAction(async () => {
    if (payload.chat === true) return ctx.engines().createChat(payload.settings)
    const tree = payload.worktree ? await deps.worktrees.create(payload.cwd, payload.worktree) : undefined
    const cwd = await realpath(tree?.path ?? payload.cwd)
    const managed = tree ?? await ctx.worktreeFor(cwd)
    const project = deps.projectMeta?.read(managed?.root ?? cwd)
    const settings = { ...payload.settings, projectInstructions: project?.instructions, extraDirs: [...new Set([...payload.settings.extraDirs, ...(project?.sources ?? [])])] }
    return ctx.engines().create(cwd, settings, managed)
  }))

  ipcMain.handle('engine:list', () => ctx.engines().list())
  ipcMain.handle('engine:get', (_event, id: string) => ctx.engines().get(id))
  ipcMain.handle('engine:requested-session', () => ctx.requestedSession())

  ipcMain.handle('engine:view', (_event, id: string | null) => {
    if (id) ctx.engines().get(id)
    ctx.selectSession(id)
  })

  ipcMain.handle('engine:settings', (_event, payload: { id: string; settings: SessionSettings }) => {
    return ctx.engines().updateSettings(payload.id, payload.settings)
  })

  /**
   * Rattache la prochaine requête à une session existante.
   *
   * Une session déjà ouverte retrouve son moteur et son état en mémoire.
   * Seule une conversation archivée nécessite de relire le transcript.
   */
  ipcMain.handle(
    'sessions:resume',
    (_event, payload: { sessionId: string; cwd: string; settings: SessionSettings }) => ctx.workspaceAction(async () => {
      const manager = ctx.engines()
      const cwd = await realpath(payload.cwd)
      const existing = manager.find(cwd, payload.sessionId)
      if (existing) return existing
      const [entries, summary] = await Promise.all([readTranscript(cwd, payload.sessionId), readSessionSummary(cwd, payload.sessionId).catch(() => null)])
      const tree = await ctx.worktreeFor(cwd)
      const project = deps.projectMeta?.read(tree?.root ?? cwd)
      return manager.resume(cwd, payload.sessionId, { ...payload.settings, projectInstructions: project?.instructions, extraDirs: project?.sources ?? [] }, entries, tree, summary?.updatedAt ?? 0)
    }),
  )

  ipcMain.handle(
    'sessions:transcript',
    (_event, payload: { cwd: string; sessionId: string }) =>
      readTranscript(payload.cwd, payload.sessionId),
  )
}
