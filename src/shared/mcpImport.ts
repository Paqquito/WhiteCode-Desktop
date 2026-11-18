import type { McpEntry } from '#desktop/connector-registry'
/** Import only one named server into a reviewable form; never activate on import. */
export function importMcp(text: string): McpEntry {
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || !value.mcpServers || typeof value.mcpServers !== 'object' || Array.isArray(value.mcpServers)) throw new Error('Format attendu : { "mcpServers": { "identifiant": { … } } }.')
  const entries = Object.entries(value.mcpServers)
  if (entries.length !== 1) throw new Error('Importez un seul serveur à la fois pour vérifier sa configuration.')
  const [id, raw] = entries[0]!
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id) || ['constructor','prototype'].includes(id)) throw new Error('Identifiant MCP invalide.')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Configuration MCP invalide.')
  const config = { ...raw } as Record<string, unknown>
  config.type ??= config.command ? 'stdio' : 'http'
  if (config.type === 'stdio') config.args ??= []
  if (!['stdio','http','sse'].includes(String(config.type))) throw new Error('Transport MCP non pris en charge.')
  return { id, label: id, enabled: false, config: config as McpEntry['config'] }
}
