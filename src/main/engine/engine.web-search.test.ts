import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from './engine.js'
import { DEFAULT_SESSION_SETTINGS, type EngineMessage } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

type InferenceRequest = {
  tools?: Array<{ name: string; type?: string }>
  messages?: Array<{ content: string | Array<{ type: string; tool_use_id?: string; is_error?: boolean; content?: unknown }> }>
}

for (const tools of [null, ['WebSearch', 'WebFetch']]) {
test(`unsupported WebSearch returns a recoverable error (${tools ? 'explicit tool selection' : 'full tool set'})`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-web-search-'))
  const requests: InferenceRequest[] = [], messages: EngineMessage[] = [], notices: string[] = []
  const server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    if (!req.url?.split('?')[0]?.endsWith('/messages')) { res.writeHead(404).end(); return }
    const body: InferenceRequest = JSON.parse(raw); requests.push(body)
    if (body.tools?.some(tool => tool.type === 'web_search_20250305')) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Server-side web search is unsupported' } }))
      return
    }
    const first = requests.length === 1
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: 'local-web-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: first ? { type: 'tool_use', id: 'search-stale', name: 'WebSearch', input: {} } : { type: 'text', text: '' } })
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: first ? { type: 'input_json_delta', partial_json: JSON.stringify({ query: 'local test query' }) } : { type: 'text_delta', text: 'Recherche indisponible ; vous pouvez fournir une URL.' } })
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: first ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } })
    sse('message_stop', { type: 'message_stop' }); res.end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const engine = new Engine({ cwd: directory, configDir: testConfig(join(directory, 'configuration')), ...TEST_ROOTS,
    settings: { ...DEFAULT_SESSION_SETTINGS, tools, permissionMode: tools ? 'default' : 'bypassPermissions' },
    extraEnv: async () => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'local-web-test', ANTHROPIC_AUTH_TOKEN: 'local-test' }),
  })
  engine.on('message', message => messages.push(message)); engine.on('notice', notice => notices.push(notice.text))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const end = once(engine, 'turn-end')
    await engine.send('Exercise a stale WebSearch call.')
    await Promise.race([end, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('No turn end: '+JSON.stringify({ notices, types: messages.map(m=>m.type) }))), 12000) })])
    expect(requests[0]?.tools?.some(tool => tool.name === 'WebSearch')).toBe(false)
    expect(requests[0]?.tools?.some(tool => tool.name === 'fetch_url')).toBe(true)
    expect(requests.some(r => r.tools?.some(tool=>tool.type==='web_search_20250305'))).toBe(false)
    expect(requests).toHaveLength(2)
    const init = messages.find(m => m.type === 'system' && m.subtype === 'init')
    expect(init).toBeDefined()
    expect(init && 'tools' in init ? init.tools : []).not.toContain('WebSearch')
    const results = requests.flatMap(r => r.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content : [])
    const error = results.find(b => b.type === 'tool_result' && b.tool_use_id === 'search-stale')
    expect(error?.is_error).toBe(true)
    expect(JSON.stringify(error?.content)).toContain('WebSearch')
    expect(messages.some(m => m.type === 'result' && !m.is_error)).toBe(true)
    expect(engine.isBusy).toBe(false)
    const nextEnd = once(engine, 'turn-end')
    await engine.send('Continue without searching.')
    await Promise.race([nextEnd, new Promise((_, reject) => {
      clearTimeout(timer); timer = setTimeout(() => reject(Error('Next turn did not complete')), 12000)
    })])
    expect(requests).toHaveLength(3)
    expect(messages.filter(m => m.type === 'result' && !m.is_error)).toHaveLength(2)
  } finally { clearTimeout(timer); engine.stop(); server.closeAllConnections(); server.close() }
}, 20000)
}
