/** Host MCP connections in Electron; credentials never enter WhiteCode's environment. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { createHash } from 'node:crypto'
import { validMcpServerId } from './mcpNames.js'

export class McpSession {
  readonly servers: { name: string; tools: any[]; timeoutMs?: number }[] = []
  private readonly clients = new Map<string, Client>()
  private qualifiedTools(): Map<string, { server: string; name: string }> {
    const names = new Map<string, { server: string; name: string }>()
    for (const server of this.servers) for (const tool of server.tools) {
      const prefix = `cnx_${server.name}_`, normal = tool.name.replace(/[^a-zA-Z0-9_-]/g, '_')
      let name = prefix + normal
      if (name.length > 64 || names.has(name)) {
        const suffix = '_' + createHash('sha256').update(tool.name).digest('hex').slice(0, 8)
        name = prefix + normal.slice(0, 64 - prefix.length - suffix.length) + suffix
      }
      if (names.has(name)) throw new Error('Collision entre noms d’outils MCP.')
      names.set(name, { server: server.name, name: tool.name })
    }
    return names
  }
  get toolNames(): string[] { return [...this.qualifiedTools().keys()] }
  toolForName(name: string): { server: string; name: string } | undefined { return this.qualifiedTools().get(name) }
  /** `writeTools` : outils d'écriture déclarés par les connecteurs de plugin, confirmés comme ceux du produit. */
  constructor(private readonly confirm: (server: string, tool: string, args: Record<string, unknown>) => Promise<boolean>,
    private readonly writeTools: Record<string, string[]> = {}, private readonly product = 'desktop') {}

  async open(config: string | null | undefined, environment: Record<string, string>, signal: AbortSignal, notice: (text: string) => void): Promise<void> {
    if (!config) return
    const entries = Object.entries(JSON.parse(config).mcpServers ?? {})
    if (entries.length > 16) throw new Error(`Le canal ${this.product} accepte au plus 16 serveurs MCP par session.`)
    for (const [name] of entries) if (!validMcpServerId(name)) throw new Error(`Nom de serveur incompatible avec ${this.product} : ${name}`)
    const expand = (value: string): string => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key) => { if (!(key in environment)) throw new Error(`Variable MCP absente : ${key}`); return environment[key]! })
    signal.addEventListener('abort', () => { void this.close() }, { once: true })
    await Promise.all(entries.map(async ([name, raw]) => {
      const config: any = raw
      const client = new Client({ name: this.product, version: '1.0.0' }); this.clients.set(name, client)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        const headers = Object.fromEntries(Object.entries(config.headers ?? {}).map(([key, value]) => [key, expand(String(value))]))
        const allowed = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'ProgramData', 'APPDATA', 'LOCALAPPDATA', 'SSH_AUTH_SOCK', 'OFFICE_NODE', 'OFFICE_RUNTIME']
        const env = { ...Object.fromEntries(allowed.flatMap(key => environment[key] ? [[key, environment[key]!]] : [])), ...Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, expand(String(value))])) }
        const requestInit = { headers, redirect: 'error' as const }
        const transport = config.type === 'stdio' || config.command
          ? new StdioClientTransport({ command: config.command, args: (config.args ?? []).map(expand), env, stderr: 'ignore' })
          : config.type === 'sse' ? new SSEClientTransport(new URL(config.url), { requestInit }) : new StreamableHTTPClientTransport(new URL(config.url), { requestInit })
        const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => { void client.close(); reject(new Error('Délai de connexion dépassé.')) }, 15000) })
        await Promise.race([client.connect(transport), deadline])
        signal.throwIfAborted()
        const listed = []
        let cursor: string | undefined
        const cursors = new Set<string>()
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, { signal, timeout: 15000 })
          listed.push(...page.tools)
          if (listed.length > 64) throw new Error('Plus de 64 outils MCP ; sélectionnez un catalogue plus restreint.')
          cursor = page.nextCursor
          if (cursor && cursors.has(cursor)) throw new Error('Pagination MCP répétée.')
          if (cursor) cursors.add(cursor)
        } while (cursor)
        const tools = listed.map(tool => ({ name: tool.name, description: tool.description?.slice(0, 4000), inputSchema: tool.inputSchema,
          ...(tool.annotations ? { annotations: Object.fromEntries(Object.entries(tool.annotations).filter(([key, value]) => ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'].includes(key) && typeof value === 'boolean')) } : {}) }))
        if (tools.some(tool => !/^[a-zA-Z0-9_.-]{1,128}$/.test(tool.name))) throw new Error('Nom d’outil MCP invalide : 1 à 128 lettres, chiffres, points, tirets ou soulignements attendus.')
        this.servers.push({ name, tools })
      } catch (error) { this.clients.delete(name); await client.close().catch(() => {}); signal.throwIfAborted(); notice(`Serveur MCP ${name} indisponible : ${String(error)}`) }
      finally { clearTimeout(timeout) }
    }))
    this.servers.sort((a, b) => a.name.localeCompare(b.name))
    if (this.servers.reduce((count, server) => count + server.tools.length, 0) > 64 || JSON.stringify(this.servers).length > 131072) {
      await this.close(); throw new Error(`Le canal ${this.product} accepte 64 outils MCP et 128 Kio de catalogue. Réduisez les serveurs sélectionnés pour cette conversation.`)
    }
  }

  async call(params: any, signal: AbortSignal): Promise<unknown> {
    if (params?.method !== 'tools/call' || typeof params.server !== 'string' || typeof params.params?.name !== 'string') throw new Error('Requête MCP inconnue.')
    const client = this.clients.get(params.server)
    const server = this.servers.find(server => server.name === params.server)
    if (!client || !server?.tools.some(tool => tool.name === params.params.name)) throw new Error('Outil MCP non déclaré pour cette conversation.')
    const args = params.params.arguments ?? {}
    const write = Boolean(Object.hasOwn(this.writeTools, params.server) && this.writeTools[params.server]?.includes(params.params.name))
    if (write && !await this.confirm(params.server, params.params.name, args)) return { isError: true, content: [{ type: 'text', text: 'Action métier refusée par l’utilisateur.' }] }
    signal.throwIfAborted()
    return client.callTool({ name: params.params.name, arguments: args }, undefined, { signal, timeout: server.timeoutMs ?? 600_000 })
  }

  async close(): Promise<void> { const clients = [...this.clients.values()]; this.clients.clear(); await Promise.allSettled(clients.map(client => client.close())) }
}
