import { expect, test } from 'bun:test'
import { inferenceRelay } from './inferenceRelay.js'
import { DesktopFileDelivery } from './fileDelivery.js'
import { createHash, randomUUID } from 'node:crypto'

test('inference relay isolates credentials, preserves routing and rejects redirects and foreign keys', async () => {
  const requests: { path: string; key: string | null; authorization: string | null; attribution: string | null }[] = []
  let redirected = false
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/redirected') redirected = true
    requests.push({ path, key: request.headers.get('x-api-key'), authorization: request.headers.get('authorization'), attribution: request.headers.get('x-attribution') })
    const payload: any = await request.json()
    return payload.redirect ? new Response('', { status: 307, headers: { location: '/redirected' } }) : Response.json({ model: payload.model })
  } })
  const controller = new AbortController()
  const relay = await inferenceRelay({ ANTHROPIC_BASE_URL: `http://127.0.0.1:${upstream.port}/v1`, ANTHROPIC_API_KEY: 'real-upstream-key', ANTHROPIC_AUTH_TOKEN: 'real-upstream-token', ANTHROPIC_CUSTOM_HEADERS: 'x-attribution: fixture' }, controller.signal)
  const invoke = (value: any, key = relay.key) => fetch(relay.baseUrl + '/v1/messages', { method: 'POST', headers: { 'x-api-key': key, authorization: 'Bearer foreign-key' }, body: JSON.stringify(value) })
  try {
    expect(relay.key).not.toContain('upstream')
    expect((await invoke({}, 'foreign-key')).status).toBe(403)
    expect((await invoke({ model: 'same-model' })).status).toBe(200)
    expect(requests).toEqual([{ path: '/v1/messages', key: 'real-upstream-key', authorization: 'Bearer real-upstream-token', attribution: 'fixture' }])
    expect((await fetch(relay.baseUrl + '/arbitrary', { headers: { 'x-api-key': relay.key } })).status).toBe(404)
    expect((await invoke({ redirect: true })).status).toBe(502)
    expect(redirected).toBe(false)
  } finally { controller.abort(); relay.close(); upstream.stop(true) }
  await expect(fetch(relay.baseUrl + '/v1/models')).rejects.toThrow()
  await expect(inferenceRelay({ ANTHROPIC_BASE_URL: 'http://127.0.0.1' }, controller.signal)).rejects.toThrow()
})

test('desktop attachments require ordered, bounded and hash-verified chunks', () => {
  const presented: string[] = [], receiver = new DesktopFileDelivery(name => presented.push(name))
  const id = randomUUID(), bytes = Buffer.from('rapport vérifié')
  const start = { phase: 'start', id, name: 'rapport.txt', size: bytes.length, digest: createHash('sha256').update(bytes).digest('hex'), mode: 'attach' }
  try {
    expect(receiver.receive({ ...start, name: '../outside' })).toEqual({ accepted: false })
    expect(receiver.receive({ ...start, size: 51 * 1024 * 1024 })).toEqual({ accepted: false })
    expect(receiver.receive(start)).toEqual({ accepted: true })
    expect(receiver.receive({ phase: 'chunk', id, offset: 1, dataBase64: bytes.toString('base64') })).toEqual({ accepted: false })
    expect(receiver.receive({ phase: 'complete', id })).toEqual({ delivered: false })
    expect(receiver.receive(start)).toEqual({ accepted: true })
    expect(receiver.receive({ phase: 'chunk', id, offset: 0, dataBase64: bytes.toString('base64') })).toEqual({ accepted: true, nextOffset: bytes.length })
    expect(receiver.receive({ phase: 'complete', id })).toEqual({ delivered: true, rendered: false })
    expect(presented).toEqual(['rapport.txt'])
    expect(receiver.receive({ phase: 'complete', id })).toEqual({ accepted: false })
  } finally { receiver.close() }
})
