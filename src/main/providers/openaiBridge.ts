import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http'
import { randomUUID } from 'node:crypto'

export type OpenAIOptions = { baseUrl: string; apiKey?: string; model: string }
type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: string | Block[]; source?: { type: string; media_type?: string; data?: string; url?: string } }
export type MessagesRequest = { messages: { role: 'user' | 'assistant'; content: string | Block[] }[]; system?: string | Block[]; tools?: { name: string; description?: string; input_schema?: unknown }[]; tool_choice?: { type: string; name?: string; disable_parallel_tool_use?: boolean }; stream?: boolean; max_tokens?: number; temperature?: number; stop_sequences?: string[] }
type ToolCall = { id: string; name: string; arguments: string }
type Completion = { choices: { index?: number; message?: { content?: string; refusal?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; delta?: { content?: string; refusal?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[]; usage?: { prompt_tokens: number; completion_tokens: number }; error?: unknown }

export function openAIEndpoint(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Adresse du fournisseur OpenAI invalide.') }
  if (url.username || url.password || url.search || url.hash || !['https:', 'http:'].includes(url.protocol)
    || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Utilisez HTTPS, ou HTTP pour un serveur local, sans identifiants dans l’adresse.')
  return url.href.replace(/\/$/, '') + (url.pathname === '/' ? '/v1' : '')
}

function text(content: string | Block[] | undefined): string {
  if (typeof content === 'string') return content
  return (content ?? []).map(block => {
    if (block.type !== 'text') throw new Error('Ce contenu de résultat d’outil n’est pas pris en charge par le fournisseur OpenAI.')
    return block.text ?? ''
  }).join('\n')
}

export function toOpenAI(request: MessagesRequest, model: string) {
  const messages: Record<string, unknown>[] = []
  if (request.system) messages.push({ role: 'system', content: text(request.system) })
  for (const message of request.messages) {
    if (typeof message.content === 'string') { messages.push(message); continue }
    const content: Record<string, unknown>[] = [], calls: Record<string, unknown>[] = []
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: 'text', text: block.text ?? '' })
      else if (block.type === 'image' && message.role === 'user' && block.source) {
        const source = block.source
        const url = source.type === 'base64' ? `data:${source.media_type};base64,${source.data}` : source.url
        if (!url) throw new Error('Image OpenAI invalide.')
        content.push({ type: 'image_url', image_url: { url } })
      } else if (block.type === 'tool_use') calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } })
      else if (block.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: text(block.content) })
      else if (!['thinking', 'redacted_thinking'].includes(block.type)) throw new Error('Type de contenu non pris en charge par le fournisseur OpenAI.')
    }
    if (content.length || calls.length) messages.push({ role: message.role, content: content.length ? content : null, ...(calls.length ? { tool_calls: calls } : {}) })
  }
  const choice = request.tool_choice
  return { model, messages, stream: request.stream === true,
    ...(request.stream === true ? { stream_options: { include_usage: true } } : {}),
    ...(request.max_tokens ? { max_completion_tokens: request.max_tokens } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.stop_sequences?.length ? { stop: request.stop_sequences } : {}),
    ...(request.tools?.length ? { tools: request.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })),
      ...(choice ? { tool_choice: choice.type === 'tool' ? { type: 'function', function: { name: choice.name } } : choice.type === 'any' ? 'required' : choice.type,
        ...(choice.disable_parallel_tool_use ? { parallel_tool_calls: false } : {}) } : {}) } : {}) }
}

function sse(response: ServerResponse, type: string, data: object) { response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`) }
const usage = (value?: Completion['usage']) => ({ input_tokens: value?.prompt_tokens ?? 0, output_tokens: value?.completion_tokens ?? 0 })
function toolBlocks(calls: ToolCall[]) {
  return calls.map(call => {
    const input: unknown = JSON.parse(call.arguments)
    if (!call.id || !call.name || !input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Appel d’outil OpenAI invalide.')
    return { type: 'tool_use', id: call.id, name: call.name, input }
  })
}
function stopReason(reason: string | null | undefined) {
  if (!reason || !['stop', 'length', 'tool_calls', 'content_filter'].includes(reason)) throw new Error('Réponse OpenAI incomplète ou non prise en charge.')
  return reason === 'length' ? 'max_tokens' : reason === 'tool_calls' ? 'tool_use' : 'end_turn'
}

/** One authenticated loopback adapter per turn. Provider credentials never enter the child environment. */
export class OpenAIBridge {
  readonly token = randomUUID()
  private server: Server | null = null
  private active = new Map<AbortController, ServerResponse>()
  private readonly endpoint: string
  constructor(private readonly options: OpenAIOptions) { this.endpoint = openAIEndpoint(options.baseUrl) }
  async start(): Promise<string> {
    this.server = createServer((request, response) => {
      const controller = new AbortController()
      this.active.set(controller, response)
      const abort = () => controller.abort()
      const close = () => { if (!response.writableEnded) abort() }
      request.once('aborted', abort); response.once('close', close)
      void this.handle(request, response, controller.signal).catch(() => {
        if (response.destroyed || controller.signal.aborted) return
        const error = { type: 'api_error', message: 'Le fournisseur compatible OpenAI a refusé la requête ou envoyé une réponse invalide. Vérifiez son adresse, sa clé et les capacités du modèle.' }
        if (response.headersSent) { sse(response, 'error', { error }); response.end() }
        else { response.writeHead(502, { 'content-type': 'application/json' }); response.end(JSON.stringify({ type: 'error', error })) }
      }).finally(() => { this.active.delete(controller); request.off('aborted', abort); response.off('close', close) })
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(0, '127.0.0.1', resolve) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Pont OpenAI indisponible.')
    return `http://127.0.0.1:${address.port}`
  }
  stop() {
    for (const [controller, response] of this.active) { controller.abort(); response.destroy() }
    this.active.clear(); this.server?.closeAllConnections(); this.server?.close(); this.server = null
  }
  private async handle(request: IncomingMessage, response: ServerResponse, signal: AbortSignal) {
    if (request.headers.origin || request.headers.authorization !== `Bearer ${this.token}`) { response.writeHead(401); response.end(); return }
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (request.method !== 'POST' || !['/v1/messages', '/v1/messages/count_tokens'].includes(path)) { response.writeHead(404); response.end(); return }
    const chunks: Buffer[] = []; let size = 0
    for await (const chunk of request) { size += chunk.length; if (size > 32*1024*1024) throw new Error('Request too large'); chunks.push(Buffer.from(chunk)) }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as MessagesRequest
    if (path.endsWith('/count_tokens')) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ input_tokens: Math.ceil(size/4) })); return }
    const body = toOpenAI(payload, this.options.model)
    const upstream = await fetch(this.endpoint + '/chat/completions', { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
      headers: { 'content-type': 'application/json', ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) }, body: JSON.stringify(body) })
    if (!upstream.ok || !upstream.body) { await upstream.body?.cancel(); throw new Error('Provider failed') }
    const id = 'msg_' + randomUUID()
    if (!body.stream) {
      const data = await boundedJSON(upstream) as Completion
      const choice = data.choices?.[0], message = choice?.message
      if (!message || data.error) throw new Error('Invalid response')
      const calls = (message.tool_calls ?? []).map(t => ({ id: t.id, ...t.function }))
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: this.options.model,
        content: [{ type: 'text', text: message.content ?? message.refusal ?? '' }, ...toolBlocks(calls)], stop_reason: stopReason(choice.finish_reason), stop_sequence: null, usage: usage(data.usage) }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    sse(response, 'message_start', { message: { id, type: 'message', role: 'assistant', model: this.options.model, content: [], stop_reason: null, stop_sequence: null, usage: usage() } })
    sse(response, 'content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
    let buffer = '', total = 0, done = false, finish: string | null | undefined, measured: Completion['usage']
    const calls = new Map<number, ToolCall>(), decoder = new TextDecoder()
    for await (const chunk of readChunks(upstream.body)) {
      total += chunk.length
      if (total > 64*1024*1024) throw new Error('Response too large')
      buffer += decoder.decode(chunk, { stream: true })
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end+1)
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (raw === '[DONE]') { done = true; break }
        const data = JSON.parse(raw) as Completion
        if (data.error || !Array.isArray(data.choices)) throw new Error('Invalid response')
        measured = data.usage ?? measured
        const choice = data.choices.find(c => (c.index ?? 0) === 0)
        if (!choice) continue
        finish = choice.finish_reason ?? finish
        const delta = choice.delta
        if (delta?.content || delta?.refusal) sse(response, 'content_block_delta', { index: 0, delta: { type: 'text_delta', text: delta.content ?? delta.refusal } })
        for (const part of delta?.tool_calls ?? []) {
          if (!Number.isSafeInteger(part.index) || part.index < 0 || part.index > 127) throw new Error('Invalid tool index')
          const call = calls.get(part.index) ?? { id: '', name: '', arguments: '' }
          call.id += part.id ?? ''; call.name += part.function?.name ?? ''; call.arguments += part.function?.arguments ?? ''; calls.set(part.index, call)
        }
      }
      if (buffer.length > 1024*1024) throw new Error('Frame too large')
      if (done) break
    }
    if (!done) throw new Error('Interrupted response')
    const reason = stopReason(finish), blocks = toolBlocks([...calls.entries()].sort(([a], [b]) => a-b).map(([,call]) => call))
    sse(response, 'content_block_stop', { index: 0 })
    blocks.forEach((block, i) => { sse(response, 'content_block_start', { index: i+1, content_block: { ...block, input: {} } }); sse(response, 'content_block_delta', { index: i+1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }); sse(response, 'content_block_stop', { index: i+1 }) })
    sse(response, 'message_delta', { delta: { stop_reason: reason, stop_sequence: null }, usage: usage(measured) })
    sse(response, 'message_stop', {}); response.end()
  }
}

export async function boundedJSON(response: Response): Promise<unknown> {
  if (!response.body) throw new Error('Empty response')
  const chunks: Uint8Array[] = []; let size = 0
  for await (const chunk of readChunks(response.body)) { size += chunk.length; if (size > 8*1024*1024) throw new Error('Response too large'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

async function* readChunks(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  try { while (true) { const { done, value } = await reader.read(); if (done) return; yield value } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}
