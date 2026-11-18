/**
 * Canaux du fournisseur de modèles.
 */

import { app, type IpcMain } from 'electron'
import type { MainContext } from '../ipcContext.js'
import {
  listGatewayModels,
  listOpenAIModels,
  listOllamaModels,
  type ProviderConfig,
  type Providers,
  pullOllamaModel,
} from './index.js'

export function registerProviderIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: {
    providers: Providers
    /** Relit la configuration et enregistre ses secrets auprès du caviardeur. */
    loadProvider: () => Promise<ProviderConfig>
  },
): void {
  // Relu du disque : la première interrogation vient du rendu au démarrage.
  ipcMain.handle('provider:get', () => deps.loadProvider())

  ipcMain.handle('provider:set', async (_event, config: ProviderConfig) => {
    await app.whenReady()
    // Secrets are registered on load/use, not on each keystroke of a draft.
    await deps.providers.set(config)
  })

  ipcMain.handle('provider:openai-models', (_event, payload: { baseUrl: string; apiKey: string }) => listOpenAIModels(payload.baseUrl, payload.apiKey))

  ipcMain.handle('provider:ollama-models', (_event, host: string) =>
    listOllamaModels(host),
  )

  ipcMain.handle(
    'provider:gateway-models',
    (_event, payload: { baseUrl: string; token: string }) =>
      listGatewayModels(payload.baseUrl, payload.token),
  )

  ipcMain.handle(
    'provider:pull',
    (_event, payload: { host: string; name: string }) =>
      pullOllamaModel(payload.host, payload.name, progress =>
        ctx.toRenderer('provider:pull-progress', progress),
      ),
  )
}
