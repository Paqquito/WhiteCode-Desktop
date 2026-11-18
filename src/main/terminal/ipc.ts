/**
 * Canaux des terminaux et catalogue de cibles injecté par la distribution.
 */

import type { IpcMain } from 'electron'
import type { MainContext } from '#desktop/workbench-context'
import type { Terminals } from './terminal.js'
import type { TerminalTargetProvider } from '../../shared/terminal.js'

export function registerTerminalIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: { terminals: Terminals; targets: TerminalTargetProvider },
): void {
  const remote = (id: unknown) => {
    if (id === undefined) return Promise.resolve(undefined)
    if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Cible de terminal invalide.')
    return deps.targets.resolve(id)
  }
  ipcMain.handle(
    'terminal:create',
    (
      _event,
      payload: {
        cwd: string
        cols: number
        rows: number
        remote?: string
      },
    ) =>
      ctx.workspaceAction(async () => deps.terminals.create(payload.cwd, payload.cols, payload.rows, await remote(payload.remote))),
  )

  // Rattachement à un shell laissé en vie. Rend `null` quand il n'y en a pas,
  // auquel cas le panneau en crée un — c'est le rendu qui décide, parce que lui
  // seul connaît les dimensions de sa zone d'affichage.
  ipcMain.handle(
    'terminal:attach',
    (_event, payload: { cwd: string; remote?: string }) =>
      remote(payload.remote).then(target => deps.terminals.find(payload.cwd, target)),
  )

  ipcMain.handle(
    'terminal:write',
    (_event, payload: { id: string; data: string }) =>
      deps.terminals.write(payload.id, payload.data),
  )

  ipcMain.handle(
    'terminal:resize',
    (_event, payload: { id: string; cols: number; rows: number }) =>
      deps.terminals.resize(payload.id, payload.cols, payload.rows),
  )

  ipcMain.handle('terminal:kill', (_event, id: string) => deps.terminals.kill(id))

  ipcMain.handle('terminal:targets', () => deps.targets.list())
}
