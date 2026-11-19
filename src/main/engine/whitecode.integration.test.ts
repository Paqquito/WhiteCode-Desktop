import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine, type EngineOptions } from './engine.js'
import { DEFAULT_SESSION_SETTINGS, ESSENTIAL_TOOLS } from '../../shared/protocol.js'
import { setProjectsRoot, listSessions, readTranscript, listRestorePoints } from '../session/sessions.js'
import { rewindFiles } from '../session/rewind.js'
import { TICKETS_CONNECTOR } from '../extensions/connectorFixtures.test-support.js'
import { McpRegistry } from '../extensions/mcpRegistry.js'
import { APP_ROOT, TEST_ROOTS } from '../testRoots.test-support.js'

async function fixture(reply: (body: any, round: number, directory: string) => any[] | Promise<any[]>, options: Partial<EngineOptions> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'whitecode-desktop-'))
  const config = join(directory, 'configuration'), project = join(directory, 'project')
  await mkdir(config); await mkdir(project)
  await writeFile(join(config, 'config.json'), JSON.stringify({ thinking: { enabled: false }, memory: { automatic: { enabled: false }, autoExtraction: { enabled: false }, session: { enabled: false }, recall: { enabled: false }, consolidationEnabled: false } }))
  const bodies: any[] = [], notices: string[] = [], messages: any[] = []
  const server = createServer(async (request, response) => {
    if (!request.url?.endsWith('/messages')) { response.writeHead(404).end(); return }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); bodies.push(body)
    const blocks = await reply(body, bodies.length, project)
    if (response.destroyed) return
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = (type: string, value: any) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`)
    event('message_start', { message: { id: 'msg-' + bodies.length, type: 'message', role: 'assistant', model: 'desktop-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } } })
    blocks.forEach((block, index) => {
      event('content_block_start', { index, content_block: block.type === 'text' ? { type: 'text', text: '' } : { ...block, input: {} } })
      event('content_block_delta', { index, delta: block.type === 'text' ? { type: 'text_delta', text: block.text } : { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } })
      event('content_block_stop', { index })
    })
    event('message_delta', { delta: { stop_reason: blocks.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
    event('message_stop', {}); response.end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const engine = new Engine({ ...TEST_ROOTS, cwd: project, configDir: testConfig(config), settings: { ...DEFAULT_SESSION_SETTINGS, tools: ['Read', 'Write'] },
    extraEnv: async () => ({ ANTHROPIC_MODEL: 'desktop-test', ANTHROPIC_BASE_URL: `http://127.0.0.1:${(server.address() as { port: number }).port}`, ANTHROPIC_API_KEY: 'test-provider-key', DESKTOP_MODEL_CONTEXT: '32768' }), ...options })
  engine.on('notice', notice => notices.push(notice.text)); engine.on('message', message => messages.push(message))
  return { directory, project, config, engine, bodies, messages, notices,
    async turn(prompt: string | unknown[]) {
      const done = once(engine, 'turn-end'); await engine.send(prompt)
      const outcome = await Promise.race([done, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error(JSON.stringify({ notices, messages }))), 15000); timer.unref() })])
      return outcome[0]
    },
    close() { engine.stop(); server.closeAllConnections(); server.close() },
  }
}

test('native WhiteCode streams, persists and reopens desktop sessions', async () => {
  const f = await fixture(() => [{ type: 'text', text: 'Bonjour depuis WhiteCode.' }])
  try {
    expect(await f.turn('Premier message')).toMatchObject({ failed: false, cancelled: false })
    const id = f.engine.currentSessionId!
    expect(id).toMatch(/^[a-f0-9-]{36}$/)
    expect(await f.turn('Deuxième message')).toMatchObject({ failed: false })
    expect(f.engine.currentSessionId).toBe(id)
    expect(JSON.stringify(f.bodies[1].messages)).toContain('Premier message')
    setProjectsRoot(join(f.config, 'sessions'))
    expect(await listSessions(f.project)).toMatchObject([{ id, title: 'Premier message' }])
    expect((await readTranscript(f.project, id)).filter(entry => entry.kind === 'assistant')).toHaveLength(2)
  } finally { f.close() }
}, 40000)

test('a real desktop turn with due existing memories does not launch a consolidation worker on process exit', async () => {
  const f=await fixture(()=>[{type:'text',text:'Réponse terminée.'}])
  const memory=join(f.directory,'durable-memory'),fact='---\nname: Convention\ndescription: Existing durable convention\ntype: project\n---\nKeep the existing durable fact.\n'
  try {
    await mkdir(memory)
    await writeFile(join(memory,'fact.md'),fact)
    await writeFile(join(f.config,'config.json'),JSON.stringify({thinking:{enabled:false},memory:{directory:memory,automatic:{enabled:true},recall:{enabled:false},session:{enabled:false},autoExtraction:{enabled:false},consolidationEnabled:true,consolidation:{minSessions:1,minHours:0}}}))
    expect(await f.turn('Question ordinaire.')).toMatchObject({failed:false})
    expect(f.bodies).toHaveLength(1)
    expect(f.notices.join('\n')).not.toContain('Consolidation de la mémoire')
    expect(f.notices.join('\n')).not.toContain('Tâches de fond arrêtées')
    expect(await readFile(join(memory,'fact.md'),'utf8')).toBe(fact)
    expect(JSON.parse(await readFile(join(f.config,'config.json'),'utf8')).memory.consolidationEnabled).toBe(false)
  }finally{f.close()}
},20000)

for (const allow of [false, true]) test('native WhiteCode ' + (allow ? 'executes an approved edit' : 'does not execute a refused edit'), async () => {
  const f = await fixture((_body, round, directory) => round === 1 ? [{ type: 'tool_use', id: 'call-write', name: 'write_file', input: { path: join(directory, 'result.txt'), content: 'approved' } }] : [{ type: 'text', text: 'Terminé.' }])
  let approvals = 0
  f.engine.on('message', message => {
    if (message.type === 'control_request') { approvals++; f.engine.respondToPermission(message.request_id, allow ? { behavior: 'allow', updatedInput: message.request.input } : { behavior: 'deny', message: 'Refus de test' }) }
  })
  try {
    expect(await f.turn('Écris le fichier')).toMatchObject({ failed: false })
    expect(approvals).toBe(1)
    expect(existsSync(join(f.project, 'result.txt'))).toBe(allow)
    if (allow) {
      expect(await readFile(join(f.project, 'result.txt'), 'utf8')).toBe('approved')
      setProjectsRoot(join(f.config, 'sessions'))
      const points = await listRestorePoints(f.project, f.engine.currentSessionId!)
      expect(points).toHaveLength(1)
      const options = { ...TEST_ROOTS, cwd: f.project, configDir: f.config, sessionId: f.engine.currentSessionId!, messageId: points[0]!.messageId }
      expect(await rewindFiles({ ...options, dryRun: true })).toMatchObject({ canRewind: true, filesChanged: [join(f.project, 'result.txt')] })
      expect(existsSync(join(f.project, 'result.txt'))).toBe(true)
      expect(await rewindFiles({ ...options, dryRun: false })).toMatchObject({ canRewind: true })
      expect(existsSync(join(f.project, 'result.txt'))).toBe(false)
      expect(f.bodies).toHaveLength(2)
    }
  } finally { f.close() }
}, 25000)

test('interrupting native inference releases the desktop and preserves a resumable session', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const f = await fixture(async (_body, round) => { if (round === 1) await gate; return [{ type: 'text', text: 'Après interruption.' }] })
  try {
    const ended = once(f.engine, 'turn-end'); await f.engine.send('Longue requête')
    const deadline = Date.now() + 10000
    while (!f.bodies.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    expect(f.bodies).toHaveLength(1)
    f.engine.interrupt(); expect((await ended)[0]).toMatchObject({ cancelled: true })
    release()
    expect(await f.turn('Reprendre')).toMatchObject({ failed: false })
  } finally { release(); f.close() }
}, 30000)

for (const allow of [false, true]) test('Connector MCP writes remain human-confirmed with unrestricted WhiteCode: ' + allow, async () => {
  let writes = 0, catalogue = 0
  const secret = 'private-connector-test-key'
  const mcp = createServer(async (request, response) => {
    if (request.method !== 'POST') { response.writeHead(405).end(); return }
    expect(request.headers.authorization).toBe('Bearer ' + secret)
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const rpc = JSON.parse(Buffer.concat(chunks).toString())
    if (!('id' in rpc)) { response.writeHead(202).end(); return }
    let result: any = {}
    if (rpc.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'tickets', version: '1' } }
    if (rpc.method === 'tools/list') { catalogue++; result = { tools: [{ name: 'create_issue', description: 'Create a test issue', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }] } }
    if (rpc.method === 'tools/call') { writes++; result = { content: [{ type: 'text', text: 'Issue created; echoed credential: ' + secret }] } }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
  })
  mcp.listen(0, '127.0.0.1'); await once(mcp, 'listening')
  const f = await fixture((_body, round) => round === 1 ? [{ type: 'tool_use', id: 'tickets-1', name: 'cnx_tickets_create_issue', input: { title: 'Test issue' } }] : [{ type: 'text', text: 'Terminé.' }], {
    settings: { ...DEFAULT_SESSION_SETTINGS, permissionMode: 'bypassPermissions', tools: [] },
    mcpConfig: async () => ({ config: JSON.stringify({ mcpServers: { tickets: { type: 'http', url: `http://127.0.0.1:${(mcp.address() as { port: number }).port}/mcp`, headers: { Authorization: 'Bearer ${DESKTOP_MCP_SECRET_0}' } } } }), env: { DESKTOP_MCP_SECRET_0: secret }, notices: [], writeTools: { tickets: TICKETS_CONNECTOR.writeTools! } }),
  })
  let confirmations = 0
  f.engine.on('message', message => { if (message.type === 'control_request') { confirmations++; f.engine.respondToPermission(message.request_id, allow ? { behavior: 'allow', updatedInput: message.request.input } : { behavior: 'deny', message: 'Refus utilisateur' }) } })
  try {
    expect(await f.turn('Créer un ticket')).toMatchObject({ failed: false })
    expect(catalogue).toBe(1); expect(confirmations).toBe(1); expect(writes).toBe(allow ? 1 : 0)
    expect(f.bodies[0].tools.some((tool: any) => tool.name === 'cnx_tickets_create_issue')).toBe(true)
    expect(JSON.stringify(f.messages)).not.toContain(secret)
    expect(JSON.stringify(f.bodies)).not.toContain(secret)
  } finally { f.close(); mcp.closeAllConnections(); mcp.close() }
}, 30000)

test('WhiteCode questions return the human answer through the desktop control channel', async () => {
  const f = await fixture((_body, round) => round === 1 ? [{ type: 'tool_use', id: 'choice-1', name: 'request_user_choice', input: { questions: [{ question: 'Quelle option ?', options: [{ label: 'A' }, { label: 'B' }] }] } }] : [{ type: 'text', text: 'Choix reçu.' }], { settings: { ...DEFAULT_SESSION_SETTINGS, tools: ESSENTIAL_TOOLS } })
  f.engine.on('message', message => { if (message.type === 'control_request') f.engine.respondToPermission(message.request_id, { behavior: 'allow', updatedInput: { answers: [{ labels: ['B'] }] } }) })
  try { expect(await f.turn('Pose une question')).toMatchObject({ failed: false }); expect(JSON.stringify(f.bodies[1].messages)).toContain('B') }
  finally { f.close() }
}, 25000)

test('a chat with saved essential tools exposes native web search and returns a source to the model', async () => {
  const settings = { ...DEFAULT_SESSION_SETTINGS, tools: [...ESSENTIAL_TOOLS] }
  const f = await fixture((_body, round) => round === 1
    ? [{ type: 'tool_use', id: 'release-search', name: 'search_web', input: { query: 'Latest public release of Ollama' } }]
    : [{ type: 'text', text: 'Source reçue.' }], { settings, chat: true })
  const source = 'https://example.org/releases/latest'
  const queries: string[] = []
  const search = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    queries.push((await request.json()).query)
    return Response.json({ results: [{ url: source, title: 'Latest release', excerpt: 'Release notes' }] })
  } })
  try {
    const path = join(f.config, 'config.json')
    const config = JSON.parse(await readFile(path, 'utf8'))
    await writeFile(path, JSON.stringify({ ...config, tools: { webSearch: { endpoint: search.url.href } } }))
    expect(await f.turn('Quelle est la dernière version d’Ollama ?')).toMatchObject({ failed: false })
    expect(f.bodies[0].tools.map((tool: { name: string }) => tool.name)).toContain('search_web')
    expect(queries).toEqual(['Latest public release of Ollama'])
    expect(JSON.stringify(f.bodies[1].messages)).toContain(source)
  } finally { f.close(); await search.stop(true) }
}, 25000)

test('a distributed plugin skill loads through the real desktop engine without connector credentials', async () => {
  const f = await fixture((_body, round) => round === 1
    ? [{ type: 'tool_use', id: 'tickets-skill', name: 'use_skill', input: { name: 'fixture-tickets:tickets' } }]
    : [{ type: 'text', text: 'Guide chargé.' }], {
    settings: { ...DEFAULT_SESSION_SETTINGS, tools: ['use_skill'] },
    pluginDirs: async () => [join(APP_ROOT, 'src/main/extensions/fixtures/tickets')],
  })
  try {
    expect(await f.turn('Charge le guide des tickets pour préparer une investigation.')).toMatchObject({ failed: false })
    expect(f.bodies[0].tools.some((tool: any) => tool.name === 'use_skill')).toBe(true)
    expect(JSON.stringify(f.bodies[1].messages)).toContain('show its subject')
    expect(JSON.stringify(f.bodies[1].messages)).toContain('fixture-tickets:tickets')
  } finally { f.close() }
}, 25000)
