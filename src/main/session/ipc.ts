/**
 * Canaux des points de restauration.
 *
 * Le rendu ne désigne qu'une conversation, jamais un dossier ni un transcript :
 * c'est le processus principal qui en déduit où porter l'écriture. Une
 * restauration réécrit de vrais fichiers, et cette asymétrie est voulue.
 */

import type { IpcMain } from 'electron'
import type { MainContext } from '#desktop/workbench-context'
import { listRestorePoints } from '#desktop/session-history'
import { rewindFiles } from './rewind.js'

export function registerRewindIpc(ipcMain: IpcMain, ctx: MainContext): void {
  /** Résout la session visée, en refusant les demandes qui n'ont pas de sens. */
  function rewindTarget(id: string): { cwd: string; sessionId: string } {
    const snapshot = ctx.engines().get(id)
    const sessionId = snapshot.state.status.sessionId
    if (!sessionId) throw new Error('Cette conversation n’a pas encore de tour enregistré.')
    return { cwd: snapshot.cwd, sessionId }
  }

  ipcMain.handle('rewind:list', (_event, id: string) => {
    const { cwd, sessionId } = rewindTarget(id)
    return listRestorePoints(cwd, sessionId)
  })

  ipcMain.handle('rewind:run', (_event, payload: { id: string; messageId: string; dryRun: boolean; fingerprint?: string }) => {
    const { cwd, sessionId } = rewindTarget(payload.id)
    // L'aperçu ne fait que lire ; seule l'écriture est refusée pendant un tour,
    // et elle l'est de nouveau ici même si l'aperçu vient de passer : un tour a
    // pu démarrer entre les deux.
    if (!payload.dryRun) {
      const busy = ctx.engines().busyIn(cwd)
      if (busy.length > 0) {
        throw new Error(
          busy.length === 1
            ? 'Un tour est en cours dans ce dossier : attendez sa fin ou interrompez-le avant de restaurer.'
            : `${busy.length} tours sont en cours dans ce dossier : attendez leur fin ou interrompez-les avant de restaurer.`,
        )
      }
    }
    return rewindFiles({
      appRoot: ctx.appRoot,
      engineRoot: ctx.engineRoot,
      cwd,
      configDir: ctx.engineHome,
      sessionId,
      messageId: payload.messageId,
      dryRun: payload.dryRun,
      fingerprint: payload.fingerprint,
    })
  })
}
