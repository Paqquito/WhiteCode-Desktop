/** Product-owned credential relay. WhiteCode only receives a short-lived loopback key. */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export async function inferenceRelay(environment: Record<string, string>, signal: AbortSignal) {
  signal.throwIfAborted()
  const upstream = new URL(environment.ANTHROPIC_BASE_URL ?? '')
  if (!['http:', 'https:'].includes(upstream.protocol) || upstream.username || upstream.password || upstream.search || upstream.hash) throw new Error('Adresse du serveur d’inférence invalide.')
  const key = randomBytes(32).toString('base64url')
  const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }
  if (environment.ANTHROPIC_AUTH_TOKEN) headers.authorization = `Bearer ${environment.ANTHROPIC_AUTH_TOKEN}`
  if (environment.ANTHROPIC_API_KEY) headers['x-api-key'] = environment.ANTHROPIC_API_KEY
  for (const line of (environment.ANTHROPIC_CUSTOM_HEADERS ?? '').split('\n').filter(Boolean)) {
    const colon = line.indexOf(':')
    const name = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim()
    if (colon < 1 || !/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || /[\r\n\0]/.test(value) || ['host', 'content-length', 'connection'].includes(name)) throw new Error('En-tête du fournisseur invalide.')
    headers[name] = value
  }
  const controllers = new Set<AbortController>()
  const server = createServer(async (request, response) => {
    if (request.headers['x-api-key'] !== key && request.headers.authorization !== `Bearer ${key}`) { response.writeHead(403).end(); return }
    const path = request.url?.split('?')[0]
    if (!['/v1/messages', '/v1/messages/count_tokens', '/v1/models'].includes(path ?? '') || !['GET', 'POST'].includes(request.method ?? '')) { response.writeHead(404).end(); return }
    const controller = new AbortController(); controllers.add(controller)
    response.once('close', () => controller.abort())
    try {
      const chunks: Buffer[] = []; let length = 0
      for await (const chunk of request) { length += chunk.length; if (length > 32 * 1024 * 1024) { response.writeHead(413).end(); return }; chunks.push(Buffer.from(chunk)) }
      const body = request.method === 'POST' ? Buffer.concat(chunks) : undefined
      const root = upstream.toString().replace(/\/+$/, '').replace(/\/v1$/, '')
      const forwarded = { ...headers, ...(request.headers['user-agent'] ? { 'user-agent': request.headers['user-agent'] } : {}) }
      const result = await fetch(root + path, { method: request.method, headers: forwarded, body, redirect: 'error', signal: AbortSignal.any([signal, controller.signal]) })
      const outputHeaders: Record<string, string> = {}
      for (const name of ['content-type', 'retry-after', 'request-id']) { const value = result.headers.get(name); if (value) outputHeaders[name] = value }
      response.writeHead(result.status, outputHeaders)
      if (result.body) await pipeline(Readable.fromWeb(result.body as any), response)
      else response.end()
    } catch {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' })
      if (!response.writableEnded && !response.destroyed) response.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Serveur d’inférence indisponible ou requête interrompue.' } }))
    } finally { controllers.delete(controller) }
  })
  const close = () => { for (const controller of controllers) controller.abort(); server.closeAllConnections(); server.close() }
  signal.addEventListener('abort', close, { once: true })
  try { server.listen(0, '127.0.0.1'); await once(server, 'listening', { signal }); signal.throwIfAborted(); server.unref() }
  catch (error) { signal.removeEventListener('abort', close); close(); throw error }
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`, key, close: () => { signal.removeEventListener('abort', close); close() } }
}
