/**
 * Canaux des serveurs MCP et des extensions.
 */

import type { IpcMain } from 'electron'
import type { MainContext } from '#desktop/workbench-context'
import type { McpEntry, McpRegistry } from '#desktop/connector-registry'
import { pick, place } from '#desktop/connector-manifest'
import type { Extensions, ExtensionProgress } from '#desktop/plugin-registry'

export function registerMcpIpc(
  ipcMain: IpcMain,
  deps: { mcpRegistry: McpRegistry; confirmWrite: (tool: string, args: unknown) => Promise<boolean>; openExternal: (url: string) => Promise<void> },
): void {
  ipcMain.handle('panel:open-url', async (_event, value: unknown) => {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Lien de panneau invalide.')
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Seuls les liens HTTPS sans identifiants peuvent être ouverts.')
    await deps.openExternal(url.href)
  })
  ipcMain.handle('mcp:list', () => deps.mcpRegistry.list())
  ipcMain.handle('mcp:get', (_event, id: string) => deps.mcpRegistry.get(id))
  ipcMain.handle('mcp:save', (_event, entry: McpEntry) => deps.mcpRegistry.save(entry))
  ipcMain.handle('mcp:enabled', (_event, payload: { id: string; enabled: boolean }) => deps.mcpRegistry.setEnabled(payload.id, payload.enabled))
  ipcMain.handle('mcp:remove', (_event, id: string) => deps.mcpRegistry.remove(id))
  ipcMain.handle('mcp:probe', (_event, id: string) => deps.mcpRegistry.probe(id))
  // Connecteurs déclarés par les plugins : compte, secrets, appels et liens.
  ipcMain.handle('connector:list', () => deps.mcpRegistry.connectorViews())
  ipcMain.handle('connector:status', (_event, id: string) => deps.mcpRegistry.connectorStatus(String(id)))
  ipcMain.handle('connector:secret', (_event, payload: { id: string; name: string; value: string | null }) =>
    deps.mcpRegistry.setSecret(String(payload?.id), String(payload?.name), payload?.value ?? null))
  ipcMain.handle('connector:call', async (_event, payload: { id: string; tool: string; args: unknown; cwd?: string }) => {
    const id = String(payload?.id), tool = String(payload?.tool), cwd = payload?.cwd
    const manifest = (await deps.mcpRegistry.connectors()).find(item => item.id === id)
    if (!manifest) return { ok: false, error: 'Connecteur inconnu ou plugin désactivé.' }
    let args = payload?.args
    let warnings: unknown
    // Étape de préparation déclarée : son résultat complète la demande et
    // ses avertissements accompagnent la confirmation.
    const step = manifest.prepare && Object.hasOwn(manifest.prepare, tool) ? manifest.prepare[tool] : undefined
    if (step) {
      if (manifest.writeTools?.includes(step.tool)) return { ok: false, error: 'La préparation doit être un outil de lecture.' }
      const prepared = await deps.mcpRegistry.callTool(id, step.tool, args, 45000)
      if (!prepared.ok) return { ok: false, error: `Préparation impossible : ${prepared.error}` }
      if (prepared.ok) {
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          let merged = structuredClone(args) as Record<string, unknown>
          for (const [from, to] of Object.entries(step.merge ?? {})) {
            const value = pick(prepared.data, from)
            if (value !== undefined && value !== null) merged = place(merged, to, value)
          }
          args = merged
        }
        warnings = pick(prepared.data, step.warnings)
      }
    }
    if (manifest.writeTools?.includes(tool) &&
        !await deps.confirmWrite(tool, { modifications: args, ...(Array.isArray(warnings) && warnings.length ? { avertissements: warnings } : {}) })) {
      return { ok: false, error: 'Écriture annulée.' }
    }
    return deps.mcpRegistry.callTool(id, tool, args, 45000)
  })
  ipcMain.handle('connector:open', async (_event, payload: { id: string; link: string; params: Record<string, string | number> }) => {
    const url = await deps.mcpRegistry.connectorLink(String(payload?.id), String(payload?.link), payload?.params ?? {})
    if (!url) throw new Error('Adresse du service inconnue : vérifiez le compte dans Paramètres → Connecteurs.')
    await deps.openExternal(url)
  })
}

export function registerExtensionsIpc(
  ipcMain: IpcMain,
  ctx: MainContext,
  deps: { extensions: Extensions },
): void {
  ipcMain.handle('ext:list', () => deps.extensions.list())
  ipcMain.handle('ext:sources', () => deps.extensions.sources())
  ipcMain.handle('ext:source-add', (_event, payload: { repository: string; ref?: string }) => deps.extensions.addSource(payload.repository, payload.ref))
  ipcMain.handle('ext:source-refresh', (_event, payload: { id: string; ref?: string }) => deps.extensions.refreshSource(payload.id, payload.ref))
  ipcMain.handle('ext:source-remove', (_event, id: string) => deps.extensions.removeSource(id))
  ipcMain.handle('ext:diagnose', (_event, id: string) => deps.extensions.diagnose(id))
  ipcMain.handle('ext:catalogue-status', () => deps.extensions.catalogueStatus())

  const relayExtension = (progress: ExtensionProgress) =>
    ctx.toRenderer('ext:progress', progress)

  // « Réessayer » depuis l'écran Plugins quand le catalogue officiel n'a pas pu être ajouté.
  ipcMain.handle('ext:bootstrap', () => deps.extensions.bootstrap(relayExtension, false))

  ipcMain.handle('ext:install', (_event, payload: { id: string; ref?: string }) =>
    deps.extensions.install(payload.id, relayExtension, payload.ref),
  )

  ipcMain.handle('ext:update', (_event, payload: { id: string; ref?: string }) =>
    deps.extensions.update(payload.id, relayExtension, payload.ref),
  )

  ipcMain.handle('ext:remove', (_event, id: string) => ctx.workspaceAction(() => ctx.engines().withIdleWorkspace(() => deps.extensions.remove(id), 'de désinstallation')))

  ipcMain.handle(
    'ext:enable',
    (_event, payload: { id: string; enabled: boolean }) =>
      deps.extensions.setEnabled(payload.id, payload.enabled),
  )
}
