/**
 * Canaux des routines.
 *
 * Le fichier est par projet, pas par session : ces trois canaux prennent donc
 * un `cwd` et non un identifiant de session. La lecture n'est pas mise en
 * cache — le fichier est aussi écrit par la ligne de commande et par
 * l'ordonnanceur, et un cache montrerait un état périmé sans qu'on sache
 * pourquoi.
 */

import { readRoutineHistory } from './routineHistory.js'
import type { IpcMain } from 'electron'
import { addRoutine, readRoutines, removeRoutine, updateRoutine } from './routinesStore.js'

export function registerRoutinesIpc(ipcMain: IpcMain): void {
  ipcMain.handle('routines:history', (_event, cwd: string) => readRoutineHistory(cwd))
  ipcMain.handle('routines:update', (_event, payload: {cwd:string;id:string;patch:Parameters<typeof updateRoutine>[2]}) => updateRoutine(payload.cwd,payload.id,payload.patch))
  ipcMain.handle('routines:list', (_event, cwd: string) => readRoutines(cwd))
  ipcMain.handle(
    'routines:add',
    (_event, payload: { cwd: string; cron: string; prompt: string; recurring?: boolean }) =>
      addRoutine(payload.cwd, payload),
  )
  ipcMain.handle('routines:remove', (_event, payload: { cwd: string; id: string }) =>
    removeRoutine(payload.cwd, payload.id),
  )
}
