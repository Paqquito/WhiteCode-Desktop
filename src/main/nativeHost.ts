import type { BrowserWindow, IpcMain } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { nativeEntries } from './nativeEntries.js'

export function registerNativeModules(ipcMain: Pick<IpcMain, 'handle'>, profile: string, getWindow: () => BrowserWindow | null, trustedUrl: string) {
  const moduleMethods = new Map<string, (input: unknown) => Promise<unknown>>()
  for (const { id, register } of nativeEntries) {
    const directory = join(profile, 'modules', id)
    mkdirSync(directory, { recursive: true })
    register({ directory, registerIpc(method, handler) {
      const key = id + ':' + method
      if (!/^[a-z][a-zA-Z0-9-]*$/.test(method) || moduleMethods.has(key)) throw Error('Méthode de module invalide : ' + key)
      moduleMethods.set(key, handler)
    } })
  }
  ipcMain.handle('module:invoke', (event, request) => {
    const window = getWindow()
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
        event.senderFrame?.url !== trustedUrl) throw Error('Origine de module refusée.')
    const handler = moduleMethods.get(request?.id + ':' + request?.method)
    if (!handler) throw Error('Méthode de module inconnue.')
    return handler(request.input)
  })
}
