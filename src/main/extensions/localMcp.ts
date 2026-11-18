import { createServer, type Server } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { once } from 'node:events'
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
/** Result of a tool served by the application itself. */
export type LocalToolResult = { ok: true; data: unknown; text: string } | { ok: false; error: string }

export interface LocalMcpTools {
  catalogue(): Promise<{ name: string; description: string; inputSchema: { type: 'object'; [key: string]: unknown }; annotations: { readOnlyHint: boolean; openWorldHint: boolean } }[]>
  call(tool: string, args: unknown, conversation: string, signal?: AbortSignal): Promise<LocalToolResult>
  closeConversation?(conversation: string): void
}

export class LocalMcpService {
  private server?: Server
  private address?: Promise<string>
  private secret = randomBytes(32).toString('base64url')
  private contexts = new Map<string, string>()
  private pending = new Map<string, Set<AbortController>>()
  constructor(private name: string, readonly handlers: LocalMcpTools, private enabled: () => Promise<boolean> = async () => true, onSecret: (secret: string) => void = () => {}, private readonly timeoutMs = 60000) { onSecret(this.secret) }
  cancel(conversation: string): void { for (const c of this.pending.get(conversation) ?? []) c.abort() }
  closeConversation(conversation: string): void {
    this.cancel(conversation); this.handlers.closeConversation?.(conversation)
    for (const [key, value] of this.contexts) if (value === conversation) this.contexts.delete(key)
  }
  async call(tool: string, args: unknown, conversation: string) {
    const controller = new AbortController(), pending = this.pending.get(conversation) ?? new Set<AbortController>()
    pending.add(controller); this.pending.set(conversation, pending)
    try { return await this.handlers.call(tool, args, conversation, controller.signal) }
    finally { pending.delete(controller); if (!pending.size) this.pending.delete(conversation) }
  }
  private listen(): Promise<string> {
    return this.address ??= (async () => {
      const server = this.server = createServer(async (req, res) => {
        const route = /^\/mcp\/([a-f0-9]{32})$/.exec(req.url ?? '')
        const host = `127.0.0.1:${(server.address() as { port: number }).port}`
        if (req.socket.localAddress !== '127.0.0.1' || req.socket.remoteAddress !== '127.0.0.1' || req.headers.host !== host || req.headers.origin && req.headers.origin !== `http://${host}` || req.headers.authorization !== `Bearer ${this.secret}` || !route || !this.contexts.has(route[1]!)) { res.writeHead(403).end(); return }
        if (req.method !== 'POST') { res.writeHead(405).end(); return }
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
        const conversation = this.contexts.get(route[1]!)!
        const controller = new AbortController(), pending = this.pending.get(conversation) ?? new Set<AbortController>()
        pending.add(controller); this.pending.set(conversation, pending)
        const mcp = new McpServer({ name: this.name, version: '0.1.0' }, { capabilities: { tools: {} } })
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
        const timeout = setTimeout(() => { controller.abort(); req.destroy(); res.destroy() }, this.timeoutMs)
        res.once('close', () => { controller.abort(); void mcp.close() })
        try {
          const chunks: Buffer[] = []; let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 128 * 1024) { res.writeHead(413).end(); return }
            chunks.push(Buffer.from(chunk))
          }
          let body: unknown
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { res.writeHead(400).end(); return }
          mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await this.handlers.catalogue() }))
          mcp.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
            const result = await this.handlers.call(request.params.name, request.params.arguments ?? {}, conversation, AbortSignal.any([extra.signal, controller.signal]))
            return { isError: !result.ok, content: [{ type: 'text' as const, text: result.ok ? result.text : result.error }] }
          })
          await mcp.connect(transport)
          await transport.handleRequest(req, res, body)
        } catch { if (!res.headersSent) res.writeHead(400); if (!res.writableEnded) res.end() }
        finally { clearTimeout(timeout); pending.delete(controller); if (!pending.size) this.pending.delete(conversation); await mcp.close() }
      })
      server.requestTimeout = 65000; server.headersTimeout = 10000
      server.listen(0, '127.0.0.1'); await once(server, 'listening'); server.unref()
      return `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`
    })()
  }
  async configuration(conversation = 'diagnostic'): Promise<{ type: 'http'; url: string; headers: Record<string, string> } | null> {
    if (!await this.enabled()) return null
    const id = createHash('sha256').update(conversation).digest('hex').slice(0, 32)
    this.contexts.set(id, conversation)
    return { type: 'http', url: `${await this.listen()}/${id}`, headers: { Authorization: `Bearer ${this.secret}` } }
  }
  close(): void { for (const id of this.pending.keys()) this.cancel(id); this.contexts.clear(); this.server?.closeAllConnections(); this.server?.close() }
}
