import { testConfig } from '../engine/testConfig.js'
import { test, expect } from 'bun:test'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpRegistry } from './mcpRegistry.js'
import { Engine } from '../engine/engine.js'
import { DEFAULT_SESSION_SETTINGS, type EngineMessage } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

const vault = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s).reverse(), decryptString: (s: Buffer) => Buffer.from(s).reverse().toString() }
for (const transport of ['http', 'sse'] as const) test(`real CLI discovers an authenticated MCP catalogue over ${transport}, cites sources and continues after an error`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-mcp-integration-'))
  let calls = 0, inferences = 0, authorization = '', toolError = false
  let events: ServerResponse | undefined, redirectMcp = false, redirected = false
  const requests: any[] = [], messages: EngineMessage[] = []
  const sourceTool = transport === 'http' ? 'FindDocs' : 'WebSearch'
  const catalogue = transport === 'http' ? [sourceTool, 'FindCode', 'admin.tools.list', 'admin_tools_list', 'x'.repeat(128)] : [sourceTool]
  const invoked: string[] = []
  const server = createServer(async (req, res) => {
    if (req.url === '/target') { redirected = true; res.writeHead(401).end(); return }
    if (req.method === 'GET') {
      if (transport === 'sse' && req.url === '/mcp' && req.headers['x-api-key'] === 'mcp-fixture-secret') {
        events = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: endpoint\ndata: /mcp\n\n')
      } else res.writeHead(405).end()
      return
    }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    if (req.url === '/mcp') {
      if (redirectMcp) { res.writeHead(307, { location: '/target' }).end(); return }
      authorization = String(req.headers.authorization)
      if (authorization !== 'Bearer mcp-fixture-secret' || req.headers['x-api-key'] !== 'mcp-fixture-secret') { res.writeHead(401).end(); return }
      if (!('id' in body)) { res.writeHead(202).end(); return }
      let result: unknown
      if (body.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'search-fixture', version: '1' } }
      else if (body.method === 'tools/list') result = { tools: catalogue.map(name => ({ name, description: 'Search the web and cite source URLs.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, target: { type: 'string', format: 'uuid' } }, required: ['query'] } })) }
      else if (body.method === 'tools/call') { calls++; invoked.push(body.params.name); result = { content: [{ type: 'text', text: toolError ? 'Search unavailable' : JSON.stringify({ sources: [{ title: 'Git worktree', url: 'https://git-scm.com/docs/git-worktree', snippet: 'Multiple working trees.' }] }) }], isError: toolError } }
      else result = {}
      const reply = JSON.stringify({ jsonrpc: '2.0', id: body.id, result })
      if (transport === 'sse') { events!.write(`event: message\ndata: ${reply}\n\n`); res.writeHead(202).end() }
      else res.writeHead(200, { 'content-type': 'application/json' }).end(reply)
      return
    }
    if (!req.url?.startsWith('/v1/messages')) { res.writeHead(404).end(); return }
    requests.push(body); inferences++
    const useTool = !redirectMcp && inferences % 2 === 1
    const toolName = 'cnx_search_' + (transport === 'http' && toolError ? 'admin_tools_list' : sourceTool)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', { type: 'message_start', message: { id: `m-${inferences}`, type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } })
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: useTool ? { type: 'tool_use', id: `tool-${inferences}`, name: toolName, input: {} } : { type: 'text', text: '' } })
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: useTool ? { type: 'input_json_delta', partial_json: JSON.stringify({ query: 'git worktree documentation', target: '10000000-0000-4000-8000-000000000001' }) } : { type: 'text_delta', text: toolError ? 'Search unavailable; the conversation continues.' : 'Source: https://git-scm.com/docs/git-worktree' } })
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } })
    sse('message_stop', { type: 'message_stop' }); res.end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const registry = new McpRegistry(directory, vault, async () => null, async () => null)
  await registry.save({ id: 'search', label: 'Search fixture', enabled: true, config: { type: transport, url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Bearer mcp-fixture-secret', 'X-Api-Key': 'mcp-fixture-secret' } } })
  const logFile = join(directory, 'protocol.log')
  const engine = new Engine({ cwd: directory, configDir: testConfig(join(directory, 'engine')), logFile, ...TEST_ROOTS,
    settings: { ...DEFAULT_SESSION_SETTINGS, tools: [], mcpServers: ['search'], permissionMode: 'bypassPermissions' },
    mcpConfig: settings => registry.configuration(settings),
    extraEnv: async () => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'fixture', ANTHROPIC_AUTH_TOKEN: 'local-inference' }),
  })
  engine.on('message', message => messages.push(message))
  let timer: ReturnType<typeof setTimeout> | undefined
  const turn = async () => {
    const ended = once(engine, 'turn-end')
    await engine.send('Search for git worktree documentation, cite the returned URL.')
    await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('MCP integration timeout')), 18000) })]).finally(() => clearTimeout(timer))
  }
  try {
    expect((await registry.probe('search')).ok).toBe(true)
    await turn()
    expect(calls).toBe(1)
    expect(requests[0].tools.some((tool: { name: string }) => tool.name === 'cnx_search_' + sourceTool)).toBe(true)
    expect(requests[0].tools.some((tool: { name: string }) => tool.name === sourceTool)).toBe(false)
    expect(requests[0].tools.filter((tool: { name: string }) => tool.name.startsWith('cnx_search_'))).toHaveLength(catalogue.length)
    expect(JSON.stringify(requests[1].messages)).toContain('https://git-scm.com/docs/git-worktree')
    expect(authorization).toBe('Bearer mcp-fixture-secret')
    expect(await readFile(logFile, 'utf8')).not.toContain('mcp-fixture-secret')
    expect(await readFile(logFile, 'utf8')).not.toContain('unknown format')
    toolError = true; await turn()
    expect(calls).toBe(2)
    expect(invoked).toEqual([sourceTool, transport === 'http' ? 'admin.tools.list' : sourceTool])
    expect(JSON.stringify(requests[3].messages)).toContain('Search unavailable')
    expect(messages.filter(message => message.type === 'result' && !message.is_error)).toHaveLength(2)
    expect(engine.isBusy).toBe(false)
    if (transport === 'http') {
      redirectMcp = true; await turn()
      expect(redirected).toBe(false)
      expect((requests.at(-1).tools ?? []).some((tool: { name: string }) => tool.name === 'cnx_search_' + sourceTool)).toBe(false)
      expect(messages.filter(message => message.type === 'result' && !message.is_error)).toHaveLength(3)
      expect(await readFile(logFile, 'utf8')).toContain('desktop_notice')
    }
  } finally { engine.stop(); server.closeAllConnections(); server.close() }
}, 45000)

test('MCP discovery reports authentication refusal and bounded timeout without leaking the response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-mcp-errors-'))
  let mode = 'auth'
  let redirected = false
  const server = createServer((req, res) => {
    if (req.url === '/target') { redirected = true; res.writeHead(401).end(); return }
    if (mode === 'auth') res.writeHead(401).end('private-secret')
    if (mode === 'redirect') res.writeHead(307, { location: '/target' }).end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const registry = new McpRegistry(directory, vault, async () => null, async () => null)
  await registry.save({ id: 'server', label: 'Server', enabled: true, config: { type: 'http', url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp` } })
  try {
    const denied = await registry.probe('server', 2000)
    expect(denied.ok).toBe(false); expect(denied.error).toContain('Authentification'); expect(JSON.stringify(denied)).not.toContain('private-secret')
    mode = 'timeout'; const timeout = await registry.probe('server', 200)
    expect(timeout.ok).toBe(false); expect(timeout.elapsedMs).toBeLessThan(1500)
    mode = 'redirect'; expect((await registry.probe('server', 2000)).ok).toBe(false)
    expect(redirected).toBe(false)
  } finally { server.closeAllConnections(); server.close() }
})

test('legacy SSE discovery carries authentication and receives tool responses', async () => {
  let events: ServerResponse | undefined
  const server = createServer(async (req, res) => {
    if (req.headers['x-api-key'] !== 'sse-fixture') { res.writeHead(401).end(); return }
    if (req.method === 'GET') { events = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('event: endpoint\ndata: /messages\n\n'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    if ('id' in body) {
      const result = body.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'sse', version: '1' } } : { tools: [{ name: 'Search', inputSchema: { type: 'object' } }] }
      events!.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`)
    }
    res.writeHead(202).end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const registry = new McpRegistry(await mkdtemp(join(tmpdir(), 'sample-mcp-sse-')), vault, async () => null, async () => null)
  await registry.save({ id: 'sse', label: 'SSE', enabled: true, config: { type: 'sse', url: `http://127.0.0.1:${(server.address() as { port: number }).port}/sse`, headers: { 'X-Api-Key': 'sse-fixture' } } })
  try { const result = await registry.probe('sse', 2000); expect(result.ok).toBe(true); expect(result.tools.map(t => t.name)).toEqual(['Search']) }
  finally { server.closeAllConnections(); server.close() }
})

test('stdio discovery supplies the Windows system path required by OpenSSH without inheriting inference secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-mcp-stdio-'))
  const script = join(directory, 'mcp.cjs')
  await writeFile(script, `
    const {createInterface}=require('node:readline');
    createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(!('id' in m))return;
      const result=m.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'stdio',version:'1'}}:
        {tools:[{name:'Environment',description:JSON.stringify({systemPath:process.env.ProgramData,secret:process.env.ANTHROPIC_AUTH_TOKEN}),inputSchema:{type:'object'}}]};
      console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
    });
  `)
  const previous = process.env.ANTHROPIC_AUTH_TOKEN
  process.env.ANTHROPIC_AUTH_TOKEN = 'must-not-inherit'
  const registry = new McpRegistry(directory, vault, async () => null, async () => null)
  await registry.save({ id: 'stdio', label: 'Stdio', enabled: true, config: { type: 'stdio', command: process.execPath, args: [script] } })
  try {
    const result = await registry.probe('stdio', 2000)
    expect(result.ok).toBe(true)
    const environment = JSON.parse(result.tools[0]!.description)
    expect(environment.secret).toBeUndefined()
    if (process.platform === 'win32') expect(environment.systemPath).toBe(process.env.ProgramData)
  } finally { if (previous === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN; else process.env.ANTHROPIC_AUTH_TOKEN = previous }
})
