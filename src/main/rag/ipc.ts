/**
 * Canaux des corpus documentaires.
 */

import { dialog, type IpcMain } from 'electron'
import type { MainContext } from '../ipcContext.js'
import type { IndexProgress, RagStore } from './index.js'

export function registerRagIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: { rags: RagStore },
): void {
  ipcMain.handle('rag:list', () => deps.rags.list())
  ipcMain.handle('rag:ready', () => deps.rags.check())

  ipcMain.handle(
    'rag:create',
    (_event, payload: { name: string; source: string; embedding: string }) =>
      deps.rags.create(payload.name, payload.source, payload.embedding),
  )

  ipcMain.handle('rag:remove', (_event, id: string) => deps.rags.remove(id))

  ipcMain.handle(
    'rag:enable',
    (_event, payload: { id: string; enabled: boolean }) =>
      deps.rags.update(payload.id, { enabled: payload.enabled }),
  )

  /** Relaie la progression : indexer un corpus prend des minutes. */
  const relayProgress = (id: string) => (progress: IndexProgress) =>
    ctx.toRenderer('rag:progress', { id, progress })

  ipcMain.handle('rag:index', (_event, id: string) =>
    deps.rags.index(id, relayProgress(id)),
  )

  ipcMain.handle('rag:prepare', () => deps.rags.prepare(relayProgress('')))

  ipcMain.handle('rag:choose-source', async () => {
    const window = ctx.window()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Dossier à indexer',
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
