/**
 * Canaux des worktrees et de Git.
 *
 * `worktrees:remove` regarde les terminaux avant de nettoyer. Ce n'est pas un
 * mélange de domaines par négligence : un shell vivant dans un dossier empêche
 * de le supprimer, et le message nomme le bouton « Arrêter » parce que, depuis
 * D07, la fermeture du panneau détache au lieu de tuer — un shell peut donc
 * être vivant sans qu'aucun panneau soit ouvert.
 */

import type { IpcMain } from 'electron'
import type { MainContext } from '#desktop/workbench-context'
import type { Worktrees } from './worktrees.js'
import { gitWorkflowState, gitWorkflowAction, workflowPR, type WorkflowRequest } from '#desktop/repository-workflow'
import { gitFileDiff, gitSummary, gitAction, pullRequest, type GitAction } from './git.js'

export function registerVcsIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: {
    worktrees: Worktrees
    /** Les dossiers où un shell est encore vivant. */
    busyTerminals: () => readonly string[]
  },
): void {
  ipcMain.handle('worktrees:repository', (_event, cwd: string) => deps.worktrees.repository(cwd))
  ipcMain.handle('worktrees:list', () => deps.worktrees.list())
  ipcMain.handle('worktrees:remove', (_event, id: string) => ctx.workspaceAction(() => {
    // A shell can cd away from its launch directory; do not guess where it is now.
    if (deps.busyTerminals().length) throw new Error('Arrêter les terminaux intégrés avant le nettoyage d’un worktree : bouton « Arrêter » du panneau Terminal.')
    return deps.worktrees.remove(id, ctx.engines().list().flatMap(s => [s.cwd, ...s.settings.extraDirs]))
  }))

  ipcMain.handle('git:workflow', async (_event, cwd: string) => gitWorkflowState(cwd))
  ipcMain.handle('git:workflow-pr', (_event, payload: { cwd: string; remote: string }) => workflowPR(payload.cwd, payload.remote))
  ipcMain.handle('git:workflow-action', (_event, payload: { cwd: string; request: WorkflowRequest }) => ctx.workspaceAction(() => {
    if (deps.busyTerminals().length && ['switch', 'branch'].includes(payload.request.action.kind)) throw new Error('Arrêtez les terminaux intégrés avant de changer de branche.')
    return ctx.engines().withIdleWorkspace(() => gitWorkflowAction(payload.cwd, payload.request))
  }))

  ipcMain.handle('git:action', (_event, payload: { cwd: string; action: GitAction }) => ctx.workspaceAction(() => {
    return ctx.engines().withIdleWorkspace(() => gitAction(payload.cwd, payload.action))
  }))
  ipcMain.handle('git:pr', (_event, cwd: string) => pullRequest(cwd))

  ipcMain.handle('git:summary', (_event, cwd: string) => gitSummary(cwd))

  ipcMain.handle(
    'git:diff',
    (
      _event,
      payload: { cwd: string; path: string; staged: boolean; untracked: boolean },
    ) => gitFileDiff(payload.cwd, payload.path, payload.staged, payload.untracked),
  )
}
