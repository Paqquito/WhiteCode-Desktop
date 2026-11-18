import { expect, test } from 'bun:test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import Anthropic from '@anthropic-ai/sdk'
import { OpenAIBridge, openAIEndpoint, toOpenAI } from './openaiBridge.js'
import { listOpenAIModels } from './index.js'

async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const base = `http://127.0.0.1:${address.port}/v1`
  const bridge = new OpenAIBridge({ baseUrl: base, apiKey: 'provider-fixture-secret', model: 'fixture-model' })
  const url = await bridge.start()
  return { bridge, url, base, client: new Anthropic({ baseURL: url, apiKey: null, authToken: bridge.token, maxRetries: 0 }), stop() { bridge.stop(); server.closeAllConnections(); server.close() } }
}
async function until(fn: () => boolean) { for (let n = 0; n < 200; n++) { if (fn()) return; await Bun.sleep(10) } throw new Error('Timeout') }

test('OpenAI URL policy and request mapping preserve tools, images and their result IDs', () => {
  expect(openAIEndpoint('https://provider.example')).toBe('https://provider.example/v1')
  expect(openAIEndpoint('https://provider.example/custom/v1/')).toBe('https://provider.example/custom/v1')
  for (const url of ['http://remote.example', 'https://key:secret@example.org', 'https://example.org/?key=secret', 'file:///secret']) expect(() => openAIEndpoint(url)).toThrow()
  const mapped = toOpenAI({ system: 'system', messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'Read', input: { file: 'demo' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: [{ type: 'text', text: 'result' }] }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'fixture' } }] },
  ], tools: [{ name: 'Read', input_schema: { type: 'object' } }], tool_choice: { type: 'any' }, max_tokens: 100 }, 'custom-model')
  expect(mapped.messages[1]).toMatchObject({ tool_calls: [{ id: 'call-1', function: { name: 'Read', arguments: '{"file":"demo"}' } }] })
  expect(mapped.messages[2]).toEqual({ role: 'tool', tool_call_id: 'call-1', content: 'result' })
  expect(mapped.messages[3]).toMatchObject({ content: [{ image_url: { url: 'data:image/png;base64,fixture' } }] })
  expect(mapped.tool_choice).toBe('required'); expect(mapped.max_completion_tokens).toBe(100)
})

test('real SDK reconstructs fragmented OpenAI SSE and tool arguments without exposing upstream key', async () => {
  let received = '', auth = '', path = ''
  const f = await fixture((request, response) => {
    auth = request.headers.authorization ?? ''; path = request.url ?? ''
    request.on('data', chunk => { received += chunk })
    request.on('end', async () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      const frames = [
        { choices: [{ index: 0, delta: { content: 'Vérification' }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'Read', arguments: '{"file":' } }] } }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"demo"}' } }] }, finish_reason: 'tool_calls' }] },
        { choices: [], usage: { prompt_tokens: 19, completion_tokens: 8 } },
      ].map(frame => 'data: ' + JSON.stringify(frame) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n'
      const bytes = Buffer.from(frames)
      for (let i = 0; i < bytes.length; i += 7) response.write(bytes.subarray(i, i+7))
      response.end()
    })
  })
  try {
    expect((await fetch(f.url + '/v1/messages', { method: 'POST' })).status).toBe(401)
    const message = await f.client.messages.stream({ model: 'ignored', max_tokens: 100, messages: [{ role: 'user', content: 'test' }], tools: [{ name: 'Read', input_schema: { type: 'object' } }] }).finalMessage()
    expect(path).toBe('/v1/chat/completions'); expect(auth).toBe('Bearer provider-fixture-secret')
    expect(JSON.parse(received).model).toBe('fixture-model')
    expect(received).not.toContain(f.bridge.token)
    expect<unknown>(message.content).toEqual([{ type: 'text', text: 'Vérification' }, { type: 'tool_use', id: 'call-1', name: 'Read', input: { file: 'demo' } }])
    expect(message.stop_reason).toBe('tool_use'); expect(message.usage.input_tokens).toBe(19); expect(message.usage.output_tokens).toBe(8)
  } finally { f.stop() }
})

test('non-streaming, catalog, redirects and truncated streams fail safely', async () => {
  let mode = 'json'
  const f = await fixture((request, response) => {
    request.resume()
    if (request.url === '/v1/models') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: [{ id: 'custom-model' }, { id: 'claude-provider-model' }] })); return }
    if (mode === 'redirect') { response.writeHead(302, { location: 'https://example.org/secret' }); response.end(); return }
    if (mode === 'broken') { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); return }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } }))
  })
  try {
    const models = await listOpenAIModels(f.base, 'fixture')
    expect(models.ok && models.models.map(m => m.id)).toEqual(['custom-model', 'claude-provider-model'])
    expect<unknown>((await f.client.messages.create({ model: 'ignored', max_tokens: 10, messages: [{ role: 'user', content: 'test' }] })).content).toEqual([{ type: 'text', text: 'done' }])
    mode = 'redirect'
    await expect(Promise.resolve(f.client.messages.create({ model: 'ignored', max_tokens: 10, messages: [{ role: 'user', content: 'test' }] }))).rejects.toThrow('compatible OpenAI')
    mode = 'broken'
    await expect(f.client.messages.stream({ model: 'ignored', max_tokens: 10, messages: [{ role: 'user', content: 'test' }] }).finalMessage()).rejects.toThrow('compatible OpenAI')
  } finally { f.stop() }
})

for (const headers of [false, true]) test(`OpenAI cancellation closes the upstream connection (${headers ? 'streaming' : 'before headers'})`, async () => {
  let connected = false, closed = false
  const f = await fixture((request, response) => {
    connected = true; request.resume(); response.once('close', () => { closed = true })
    if (headers) { response.writeHead(200, { 'content-type': 'text/event-stream' }); response.write('data: {"choices":[{"delta":{"content":"start"}}]}\n\n') }
  })
  const controller = new AbortController()
  const pending = fetch(f.url + '/v1/messages', { method: 'POST', signal: controller.signal, headers: { authorization: `Bearer ${f.bridge.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'test' }] }) }).then(r => r.text()).catch(() => '')
  try { await until(() => connected); controller.abort(); await pending; await until(() => closed); expect(closed).toBe(true) }
  finally { controller.abort(); f.stop(); await pending }
})
