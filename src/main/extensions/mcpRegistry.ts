import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { ProviderStorage, type SecretVault } from '../providers/storage.js'
import type { SessionSettings } from '../../shared/protocol.js'
import { pick, type ConnectorManifest } from './connectors.js'
import { boundedJSON } from '../providers/openaiBridge.js'
import { validMcpServerId as validId } from './mcpNames.js'

export type McpConfig = { type: 'stdio'; command: string; args: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }
export type McpEntry = { id: string; label: string; enabled: boolean; config: McpConfig }
export type McpView = { id: string; label: string; enabled: boolean; source: 'internal' | 'user' | 'corpus' | 'plugin'; transport: string; address: string }
export type McpProbe = { ok: boolean; tools: { name: string; description: string }[]; elapsedMs: number; error?: string }
/** `writeTools` : outils d'écriture déclarés par les connecteurs, confirmés par la session MCP. */
export type McpLaunch = { config: string | null; env: Record<string, string>; notices: string[]; writeTools?: Record<string, string[]> }
/** État du compte d'un connecteur : secrets renseignés et compte vérifié. */
export type ConnectorStatus = { configured: boolean; secrets: Record<string, boolean>; account?: { name: string; login: string }; error?: string }
export type ConnectorResult = { ok: true; data: unknown; text: string } | { ok: false; error: string }
/** Ce que le rendu sait d'un connecteur : sa description, jamais ses secrets. */
export type ConnectorView = Pick<ConnectorManifest, 'id' | 'name' | 'label' | 'writeTools' | 'prepare' | 'links'> & {
  secrets: Array<{ name: string; label: string; help?: string; required: boolean; pattern: string }>
}
/** Serveurs intégrés : aucun dans l'application de base ; une distribution peut en déclarer. */
const DEFAULTS: McpEntry[] = []
/** Les propriétaires restent connus après désactivation ; ils ne deviennent jamais des serveurs utilisateur. */
type Stored = { version?: 2; entries: McpEntry[]; secrets?: Record<string, Record<string, string>>; connectorIds?: string[]; [key: string]: unknown }
const internal = (id: string) => DEFAULTS.some(entry => entry.id === id)

function validate(entry: McpEntry): void {
  if (!entry || !validId(entry.id) || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 100 || typeof entry.enabled !== 'boolean') throw new Error('Nom ou identifiant MCP invalide.')
  const config = entry.config
  if (!config || !['stdio', 'http', 'sse'].includes(config.type)) throw new Error('Transport MCP invalide.')
  const fields = config.type === 'stdio' ? ['type', 'command', 'args', 'env'] : ['type', 'url', 'headers']
  if (Object.keys(config).some(key => !fields.includes(key))) throw new Error('Champ de configuration MCP non pris en charge.')
  const strings = (value: unknown) => value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([key, v]) => key.length > 0 && typeof v === 'string' && v.length < 32768 && !/[\r\n\0]/.test(v)))
  if (config.type === 'stdio') {
    if (typeof config.command !== 'string' || !config.command.trim() || /[\r\n\0]/.test(config.command) || !Array.isArray(config.args) || !config.args.every(arg => typeof arg === 'string' && !arg.includes('\0')) || !strings(config.env)) throw new Error('Commande, arguments ou environnement MCP invalides.')
    if (config.env && Object.keys(config.env).some(key => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) throw new Error('Nom de variable MCP invalide.')
  } else {
    const url = new URL(config.url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || !strings(config.headers)) throw new Error('URL ou en-têtes MCP invalides. Les identifiants doivent être placés dans les en-têtes.')
    if (url.protocol === 'http:' && Object.keys(config.headers ?? {}).length && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('HTTPS est requis pour transmettre des identifiants à un serveur distant.')
    if (config.headers && Object.keys(config.headers).some(key => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /^(host|content-length|connection)$/i.test(key))) throw new Error('Nom d’en-tête MCP invalide.')
  }
}

export class McpRegistry {
  private readonly storage: ProviderStorage<Stored>
  private queue: Promise<unknown> = Promise.resolve()
  /** Masquage des secrets dans le diagnostic, et connecteurs déclarés par les plugins activés (`connector.json`). */
  constructor(root: string, vault: SecretVault, private readonly corpora: () => Promise<string | null>,
    private readonly onSecret: (secret: string) => void = () => {}, private readonly declared: () => Promise<ConnectorManifest[]> = async () => []) {
    this.storage = new ProviderStorage(root, vault, { fileName: 'mcp.json', hasSecrets: () => true })
  }
  /** Connecteurs déclarés, sans doublon ni collision avec les serveurs intégrés. */
  async connectors(): Promise<ConnectorManifest[]> {
    const seen = new Set<string>()
    return (await this.declared()).filter(manifest => !internal(manifest.id) && !seen.has(manifest.id) && seen.add(manifest.id))
  }
  private async connector(id: string): Promise<ConnectorManifest> {
    const manifest = (await this.connectors()).find(item => item.id === id)
    if (!manifest) throw new Error('Connecteur inconnu ou plugin désactivé.')
    return manifest
  }
  async connectorViews(): Promise<ConnectorView[]> {
    return (await this.connectors()).map(({ id, name, label, writeTools, prepare, links, auth }) => ({ id, name, label, writeTools, prepare, links,
      secrets: (auth.secrets ?? []).map(({ name, label, help, required, pattern }) => ({ name, label, help, required: Boolean(required), pattern })) }))
  }
  /** Secret d'un connecteur, ou `null` s'il manque ou ne respecte plus son format. */
  async secret(id: string, name: string): Promise<string | null> {
    const manifest = (await this.connectors()).find(item => item.id === id)
    const declaration = manifest?.auth.secrets?.find(secret => secret.name === name)
    if (!declaration) return null
    const stored = await this.storage.read()
    const value = stored?.secrets?.[id]?.[name]
    if (typeof value !== 'string' || !new RegExp(declaration.pattern).test(value)) return null
    this.onSecret(value)
    return value
  }
  private async secretHeaders(manifest: ConnectorManifest): Promise<Record<string, string>> {
    const headers: Record<string, string> = {}
    for (const declaration of manifest.auth.secrets ?? []) {
      const value = await this.secret(manifest.id, declaration.name)
      if (value) headers[declaration.header] = value
    }
    return headers
  }
  private async missingSecret(manifest: ConnectorManifest): Promise<string | null> {
    for (const declaration of manifest.auth.secrets ?? []) if (declaration.required && !await this.secret(manifest.id, declaration.name)) return declaration.label
    return null
  }
  private async entries(): Promise<McpEntry[]> {
    const saved = await this.storage.read()
    const defaults = [
      ...DEFAULTS,
      // Un connecteur déclaré est un serveur comme les autres : activable,
      // jamais modifiable par l'utilisateur, et retiré avec son plugin.
      ...(await this.connectors()).map(manifest => ({ id: manifest.id, label: manifest.label, enabled: true, config: { type: 'http' as const, url: manifest.url } })),
    ]
    const reserved = new Set(defaults.map(entry => entry.id))
    if (!saved) return structuredClone(defaults)
    if (!Array.isArray(saved.entries)) throw new Error('Registre MCP invalide ; fichier conservé.')
    const ids = new Set<string>()
    for (const entry of saved.entries) {
      validate(entry)
      if (ids.has(entry.id) || entry.id.startsWith('rag_')) throw new Error('Identifiant MCP réservé ou dupliqué.')
      ids.add(entry.id)
    }
    // Built-in addresses/commands are trusted constants; stored data only controls activation.
    return [...defaults.map(entry => ({ ...structuredClone(entry), enabled: saved.entries.find(s => s.id === entry.id)?.enabled ?? entry.enabled })), ...saved.entries.filter(entry => !reserved.has(entry.id) && !saved.connectorIds?.includes(entry.id))]
  }
  private async all(): Promise<McpEntry[]> {
    const entries = await this.entries()
    const raw = await this.corpora()
    const servers = raw ? JSON.parse(raw).mcpServers : {}
    for (const [id, value] of Object.entries(servers)) {
      if (!id.startsWith('rag_') || entries.some(e => e.id === id)) throw new Error('Collision de noms dans le registre MCP.')
      const config = { type: 'stdio', ...(value as object) } as McpConfig
      const args = config.type === 'stdio' ? config.args : []
      const entry = { id, label: `Corpus — ${args[args.indexOf('--label') + 1] ?? id}`, enabled: true, config }
      validate(entry); entries.push(entry)
    }
    return entries
  }
  async list(): Promise<McpView[]> {
    const declared = new Set((await this.connectors()).map(manifest => manifest.id))
    return (await this.all()).map(({ id, label, enabled, config }) => ({ id, label, enabled, source: internal(id) ? 'internal' : declared.has(id) ? 'plugin' : id.startsWith('rag_') ? 'corpus' : 'user', transport: config.type, address: config.type === 'stdio' ? config.command : config.url }))
  }
  async get(id: string): Promise<McpEntry> {
    const entry = (await this.all()).find(e => e.id === id)
    if (!entry) throw new Error('Serveur MCP inconnu.')
    return entry
  }
  private mutate(action: (entries: McpEntry[], stored: Stored) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const entries = await this.entries()
      const saved = await this.storage.read()
      const connectorIds = [...new Set([...(saved?.connectorIds ?? []), ...(await this.connectors()).map(connector => connector.id)])]
      const hidden = (saved?.entries ?? []).filter(entry => connectorIds.includes(entry.id) && !entries.some(current => current.id === entry.id))
      const stored: Stored = { ...saved, version: 2, entries, connectorIds }
      action(entries, stored)
      stored.entries = [...entries, ...hidden]
      await this.storage.write(stored)
    })
    this.queue = next.catch(() => {})
    return next
  }
  /** Un secret n'est jamais renvoyé au rendu : seulement sa présence. */
  async setSecret(id: string, name: string, value: string | null): Promise<void> {
    const manifest = await this.connector(id)
    const declaration = manifest.auth.secrets?.find(secret => secret.name === name)
    if (!declaration) throw new Error(`${manifest.name} ne déclare pas ce secret.`)
    if (value !== null && (typeof value !== 'string' || value.length > 4096 || !new RegExp(declaration.pattern).test(value.trim()))) throw new Error(`${declaration.label} invalide : vérifiez le format attendu.`)
    this.sites.delete(id)
    return this.mutate((_entries, stored) => {
      const secrets = { ...stored.secrets, [id]: { ...stored.secrets?.[id] } }
      if (value === null) delete secrets[id]![name]; else secrets[id]![name] = value.trim()
      stored.secrets = secrets
    })
  }
  /** Site annoncé par la vérification du compte : seule destination des liens. */
  private readonly sites = new Map<string, string>()
  /** Vérifie les secrets auprès du service déclaré par le connecteur. */
  async connectorStatus(id: string, timeoutMs = 15000): Promise<ConnectorStatus> {
    const manifest = await this.connector(id)
    this.sites.delete(id)
    const secrets = Object.fromEntries(await Promise.all((manifest.auth.secrets ?? []).map(async secret => [secret.name, Boolean(await this.secret(id, secret.name))] as const)))
    if (await this.missingSecret(manifest)) return { configured: false, secrets }
    if (!manifest.account) return { configured: true, secrets }
    try {
      const response = await fetch(manifest.account.endpoint, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: await this.secretHeaders(manifest) })
      const body = await boundedJSON(response).catch(() => null) as Record<string, unknown> | null
      const site = pick(body, manifest.account.site)
      const login = pick(body, manifest.account.login)
      if (response.ok && typeof login === 'string' && login) {
        if (typeof site === 'string' && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site)) this.sites.set(id, site)
        return { configured: true, secrets, account: { name: String(pick(body, manifest.account.name) ?? ''), login } }
      }
      if (response.status === 404) return { configured: true, secrets, error: `${manifest.name} : service de vérification introuvable (HTTP 404).` }
      const message = pick(body, 'error.message')
      return { configured: true, secrets, error: typeof message === 'string' ? message.slice(0, 300) : `Vérification impossible (HTTP ${response.status}).` }
    } catch { return { configured: true, secrets, error: `${manifest.name} injoignable ou délai dépassé.` } }
  }
  /**
   * Appel direct d'un outil, pour les panneaux. Ce sont les mêmes outils que
   * ceux des modèles : mêmes contrôles côté service, même audit. Les erreurs
   * reviennent en texte lisible plutôt qu'en exception IPC.
   */
  async callTool(id: string, tool: string, args: unknown, timeoutMs = 45000): Promise<ConnectorResult> {
    let manifest: ConnectorManifest
    try { manifest = await this.connector(id) } catch (error) { return { ok: false, error: (error as Error).message } }
    if (!manifest.tools?.names.includes(tool)) return { ok: false, error: `Outil ${manifest.name} inconnu.` }
    if (!(await this.entries()).find(entry => entry.id === id)?.enabled) return { ok: false, error: `Connecteur désactivé dans l’application : Paramètres → Connecteurs → ${manifest.name}.` }
    const missing = await this.missingSecret(manifest)
    if (missing) return { ok: false, error: `${missing} non renseignée : Paramètres → Connecteurs → ${manifest.name}.` }
    let response: Response
    try {
      response = await fetch(manifest.tools.endpoint.replace('{tool}', tool), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { ...await this.secretHeaders(manifest), 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) })
    } catch { return { ok: false, error: `${manifest.name} injoignable ou délai dépassé.${manifest.writeTools?.includes(tool) ? ' Résultat non confirmé. Vérifiez l’état dans le service avant de réessayer.' : ''}` } }
    const body = await boundedJSON(response).catch(() => null) as { data?: unknown; text?: string; error?: { message?: string } } | null
    if (response.ok && body && typeof body === 'object' && !Array.isArray(body) && 'data' in body) return { ok: true, data: body.data, text: String(body.text ?? '') }
    if (response.ok) return { ok: false, error: 'Réponse du service invalide : résultat non confirmé. Vérifiez l’état dans le service avant de réessayer.' }
    if (response.status === 401) return { ok: false, error: `${manifest.name} : authentification refusée. Vérifiez le secret du connecteur.` }
    if (response.status === 404 && !body?.error) return { ok: false, error: `${manifest.name} : outil introuvable (HTTP 404).` }
    return { ok: false, error: typeof body?.error?.message === 'string' ? body.error.message.slice(0, 500) : `Erreur ${manifest.name} (HTTP ${response.status}).` }
  }
  /** Adresse d'un lien déclaré, uniquement sur le site annoncé par la vérification du compte. */
  async connectorLink(id: string, name: string, params: Record<string, string | number>): Promise<string | null> {
    const manifest = (await this.connectors()).find(item => item.id === id)
    const pattern = manifest?.links && Object.hasOwn(manifest.links, name) ? manifest.links[name] : undefined
    if (!pattern) return null
    if (!this.sites.has(id)) await this.connectorStatus(id)
    const site = this.sites.get(id)
    if (!site) return null
    let missing = false
    const path = pattern.replace(/\{(\w+)\}/g, (_match, key: string) => {
      if (key === 'site') return site
      const value = Object.hasOwn(params, key) ? params[key] : undefined
      if (value === undefined || !/^[A-Za-z0-9._-]{1,100}$/.test(String(value))) { missing = true; return '' }
      return encodeURIComponent(String(value))
    })
    return missing ? null : path
  }
  async save(entry: McpEntry): Promise<void> {
    validate(entry)
    if (internal(entry.id) || entry.id.startsWith('rag_')) return Promise.reject(new Error('Identifiant MCP réservé.'))
    if ((await this.storage.read())?.connectorIds?.includes(entry.id)) throw new Error('Identifiant MCP réservé par un plugin.')
    const copy = structuredClone(entry)
    const declared = this.connectors().then(list => { if (list.some(item => item.id === copy.id)) throw new Error('Identifiant MCP réservé par un plugin.') })
    return declared.then(() => this.mutate(entries => { const index = entries.findIndex(e => e.id === copy.id); if (index < 0) entries.push(copy); else entries[index] = copy }))
  }
  setEnabled(id: string, enabled: boolean): Promise<void> {
    if (typeof enabled !== 'boolean') return Promise.reject(new Error('Activation MCP invalide.'))
    return this.mutate(entries => { const entry = entries.find(e => e.id === id); if (!entry) throw new Error('Serveur MCP inconnu.'); entry.enabled = enabled })
  }
  async remove(id: string): Promise<void> {
    if (internal(id) || id.startsWith('rag_')) throw new Error('Ce serveur intégré peut être désactivé, pas supprimé.')
    if ((await this.connectors()).some(item => item.id === id)) throw new Error('Ce connecteur appartient à un plugin : désactivez ou désinstallez le plugin.')
    return this.mutate(entries => { const index = entries.findIndex(e => e.id === id); if (index < 0) throw new Error('Serveur MCP inconnu.'); entries.splice(index, 1) })
  }
  private async authenticated(entry: McpEntry): Promise<McpConfig> {
    const manifest = (await this.connectors()).find(item => item.id === entry.id)
    // Sans secret, le catalogue d'outils reste consultable ; les appels expliquent comment le renseigner.
    if (manifest) return { type: 'http', url: manifest.url, headers: await this.secretHeaders(manifest) }
    return structuredClone(entry.config)
  }
  async configuration(settings: SessionSettings): Promise<McpLaunch> {
    const servers: Record<string, McpConfig> = {}, env: Record<string, string> = {}, notices: string[] = []
    const writeTools: Record<string, string[]> = {}
    const connectors = await this.connectors()
    for (const entry of await this.all()) {
      if (!entry.enabled || (settings.mcpServers != null && !settings.mcpServers.includes(entry.id))) continue
      const manifest = connectors.find(item => item.id === entry.id)
      // Des outils de plus pèsent sur les petits modèles : un connecteur n'est
      // proposé qu'une fois ses secrets obligatoires renseignés.
      const missing = manifest && await this.missingSecret(manifest)
      if (manifest && missing) {
        notices.push(`${manifest.name} : ${missing.charAt(0).toLocaleLowerCase('fr-FR')}${missing.slice(1)} absente. Renseignez-la dans Paramètres → Connecteurs → ${manifest.name} pour activer les outils.`)
        continue
      }
      if (manifest?.writeTools?.length) writeTools[entry.id] = manifest.writeTools
      let config: McpConfig
      try { config = await this.authenticated(entry) } catch { notices.push(`${entry.label} : identifiants indisponibles, serveur omis pour ce tour.`); continue }
      const protect = (value: string) => {
        const name = `DESKTOP_MCP_SECRET_${Object.keys(env).length}`
        env[name] = value
        return '${' + name + '}'
      }
      // CLI supports environment expansion: credentials never enter its command line.
      if (config.type === 'stdio') {
        if (!internal(entry.id) && !entry.id.startsWith('rag_')) config.args = config.args.map(protect)
        if (config.env) config.env = Object.fromEntries(Object.entries(config.env).map(([key, value]) => [key, protect(value)]))
      } else if (config.headers) config.headers = Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, protect(value)]))
      servers[entry.id] = config
    }
    return { config: Object.keys(servers).length ? JSON.stringify({ mcpServers: servers }) : null, env, notices, writeTools }
  }
  async probe(id: string, timeoutMs = 15000): Promise<McpProbe> {
    const started = Date.now()
    const client = new Client({ name: 'desktop', version: '1.0.0' })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const config = await this.authenticated(await this.get(id))
      const safeFetch: FetchLike = (input, init) => {
        const url = new URL(input)
        if (config.type === 'stdio' || url.origin !== new URL(config.url).origin) return Promise.reject(new Error('Redirection MCP refusée.'))
        return fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(timeoutMs)]) })
      }
      // Windows OpenSSH exits 255 without ProgramData, omitted by the SDK defaults.
      // SSH_AUTH_SOCK lets Unix desktops reuse the user's agent without exposing other secrets.
      const stdioEnv = Object.fromEntries(['ProgramData', 'SSH_AUTH_SOCK'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
      const transport = config.type === 'stdio' ? new StdioClientTransport({ command: config.command, args: config.args, env: { ...stdioEnv, ...config.env }, stderr: 'pipe' })
        : config.type === 'http' ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, fetch: safeFetch })
        : new SSEClientTransport(new URL(config.url), { requestInit: { headers: config.headers }, fetch: safeFetch })
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {})
      const operation = async () => {
        await client.connect(transport, { timeout: timeoutMs })
        const tools: McpProbe['tools'] = []; let cursor: string | undefined
        for (let page = 0; page < 10; page++) {
          const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: timeoutMs })
          tools.push(...result.tools.map(tool => ({ name: tool.name, description: (tool.description ?? '').slice(0, 500) })))
          cursor = result.nextCursor
          if (!cursor) return tools
        }
        throw new Error('Catalogue MCP trop volumineux.')
      }
      const tools = await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Timeout')), timeoutMs) })])
      return { ok: true, tools, elapsedMs: Date.now() - started }
    } catch (error) {
      const code = (error as { code?: number }).code
      const auth = code === 401 || code === 403 || (error as Error).name === 'UnauthorizedError'
      return { ok: false, tools: [], elapsedMs: Date.now() - started, error: auth ? 'Authentification refusée (401/403). Vérifier les identifiants MCP.' : 'Connexion MCP impossible ou délai dépassé. Vérifier la configuration, le réseau et les accès SSH/identifiants.' }
    } finally { clearTimeout(timer); await client.close().catch(() => {}) }
  }
}
