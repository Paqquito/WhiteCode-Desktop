/**
 * Canaux des modèles locaux et de Hugging Face.
 */

import { dialog, type IpcMain } from 'electron'
import type { MainContext } from '#desktop/workbench-context'
import {
  type LocalModels,
  type ModelProgress,
  type ModelsConfig,
  type QuantOption,
  resolveRepo,
} from './index.js'

export function registerModelsIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: {
    models: LocalModels
    /** Progression du téléchargement, vers l'écran des réglages. */
    relay: (progress: ModelProgress) => void
  },
): void {
  const { models, relay } = deps

  /**
   * Refuse de toucher au serveur local pendant un tour.
   *
   * `enginesIfAny` et non `engines` : sans gestionnaire, rien n'est occupé, et
   * en construire un pour poser la question serait absurde.
   */
  function requireIdleEngines(): void {
    if (ctx.enginesIfAny()?.isBusy) throw new Error('Attendez la fin des sessions ou arrêtez-les avant de modifier le serveur local.')
  }

  ipcMain.handle('models:config', () => models.load())

  ipcMain.handle('models:set-config', (_event, next: Partial<ModelsConfig>) =>
    models.set(next),
  )

  ipcMain.handle('models:installed', () => models.installed())

  ipcMain.handle('models:download', (_event, id: string) =>
    models.download(id, relay),
  )

  ipcMain.handle('models:cancel', (_event, id: string) => models.cancel(id))

  ipcMain.handle('models:remove', (_event, id: string) => { requireIdleEngines(); return models.remove(id) })

  ipcMain.handle('models:start', (_event, id: string) => {
    requireIdleEngines()
    return models.start(id, relay)
  })

  ipcMain.handle('models:stop', () => { requireIdleEngines(); return models.stop() })

  ipcMain.handle('models:status', () => models.status())

  /**
   * Résolution d'un dépôt Hugging Face collé par l'utilisateur.
   *
   * Ici et non dans le rendu : la résolution sort sur le réseau, et le rendu
   * n'a pas de surface pour cela — pas plus qu'il n'a le droit d'écrire les
   * fichiers que l'installation dépose ensuite.
   */
  ipcMain.handle('hf:resolve', (_event, input: string) => resolveRepo(input))

  // La progression passe par le canal des modèles : c'est le même téléchargement
  // vu de l'interface, et l'écran des réglages y est déjà abonné.
  ipcMain.handle(
    'hf:install',
    (_event, payload: { repo: string; option: QuantOption }) =>
      models.installFromRepo(payload.repo, payload.option, relay),
  )

  /**
   * Choisit le dossier des poids.
   *
   * Le dialogue vit ici : le rendu n'a pas accès au système de fichiers, et un
   * champ de saisie libre laisserait passer des chemins inexistants qu'on ne
   * découvrirait qu'au premier téléchargement.
   */
  ipcMain.handle('models:choose-root', async () => {
    const window = ctx.window()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Dossier des modèles',
      defaultPath: models.current.root,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return models.set({ root: result.filePaths[0] })
  })
}
