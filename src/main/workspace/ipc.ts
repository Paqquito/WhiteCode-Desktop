/**
 * Canaux de l'espace de travail : projets, fichiers, pièces jointes.
 *
 * Deux politiques de chemin coexistent ici, et la différence est délibérée.
 * L'**exploration** reçoit une racine à chaque appel et s'en sert de borne : le
 * processus principal ne fait jamais confiance au chemin envoyé par le rendu.
 * Les **pièces jointes** n'ont pas de borne — elles viennent précisément de
 * l'extérieur, le bureau ou les téléchargements. C'est l'utilisateur qui les a
 * déposées, pas le modèle qui les a demandées.
 */

import { dialog, type IpcMain, shell } from 'electron'
import type { MainContext } from '../ipcContext.js'
import type { SessionOrigins } from '../session/sessionOrigins.js'
import type { SessionMetaStore } from '../session/sessionMeta.js'
import type { SessionMeta } from '../../shared/sessionMeta.js'
import type { ProjectMetaStore } from './projectMeta.js'
import type { ProjectMeta } from '../../shared/projectMeta.js'
import { type Attachment, prepareAttachment } from './attachments.js'
import {
  readDirectory,
  readFileContent,
  searchFiles,
  writeFileContent,
} from './files.js'
import { listProjects } from './projects.js'
import type { ChatWorkspaces } from './chats.js'

export function registerWorkspaceIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: {
    sessionOrigins: SessionOrigins
    sessionMeta: SessionMetaStore
    projectMeta: ProjectMetaStore
    chats?: ChatWorkspaces
  },
): void {
  /** Inventaire complet : tous les projets connus et leurs sessions. */
  ipcMain.handle('projects:list', () =>
    listProjects(deps.sessionOrigins, deps.sessionMeta, deps.projectMeta, deps.chats),
  )

  /** Nom choisi, épingle, dossiers sources et retrait — retouche partielle. */
  ipcMain.handle(
    'projects:meta',
    (_event, payload: { cwd: string; patch: ProjectMeta }) =>
      deps.projectMeta.update(payload.cwd, payload.patch) ?? null,
  )

  /**
   * Épingle, archive et titre choisi.
   *
   * Un seul canal pour les trois : ce sont des retouches partielles du même
   * objet, et trois canaux obligeraient le rendu à relire l'état entre deux
   * décisions pour ne pas écraser la précédente.
   */
  ipcMain.handle(
    'sessions:meta',
    (_event, payload: { cwd: string; sessionId: string; patch: SessionMeta }) =>
      deps.sessionMeta.update(payload.cwd, payload.sessionId, payload.patch) ?? null,
  )

  ipcMain.handle(
    'files:read-dir',
    (_event, payload: { root: string; path?: string }) =>
      readDirectory(payload.root, payload.path),
  )

  ipcMain.handle(
    'files:read-file',
    (_event, payload: { root: string; path: string }) =>
      readFileContent(payload.root, payload.path),
  )

  ipcMain.handle(
    'files:write',
    (_event, payload: { root: string; path: string; text: string; expectedText?: string }) =>
      writeFileContent(payload.root, payload.path, payload.text, payload.expectedText),
  )

  ipcMain.handle(
    'files:search',
    (_event, payload: { root: string; query: string }) =>
      searchFiles(payload.root, payload.query),
  )

  ipcMain.handle(
    'attachments:prepare',
    async (_event, paths: string[]): Promise<Attachment[]> => {
      return Promise.all(paths.map(path => prepareAttachment(path)))
    },
  )

  ipcMain.handle('attachments:choose', async (): Promise<string[]> => {
    const window = ctx.window()
    if (!window) return []
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      title: 'Joindre des fichiers',
    })
    return result.canceled ? [] : result.filePaths
  })

  /**
   * Ouvre un dossier dans l'explorateur du système.
   *
   * `openPath` et non `showItemInFolder` : on désigne le dossier de travail
   * lui-même, pas un fichier à révéler dedans. Le retour d'Electron est une
   * chaîne vide en cas de succès et le message d'erreur sinon — relayé tel
   * quel, l'interface n'a pas à deviner pourquoi rien ne s'est ouvert.
   */
  ipcMain.handle('workspace:reveal', async (_event, path: string): Promise<string> =>
    shell.openPath(path),
  )

  /** Répertoire de travail par défaut : la racine du moteur. */
  ipcMain.handle('workspace:default', () => ctx.engineRoot)

  ipcMain.handle('workspace:choose', async () => {
    const window = ctx.window()
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory'],
      title: 'Choisir un répertoire de travail',
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
}
