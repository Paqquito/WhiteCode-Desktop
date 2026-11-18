import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Engine } from './engine.js'
import { DEFAULT_SESSION_SETTINGS, type EngineMessage, type PermissionMode } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { TICKETS_CONNECTOR } from '../extensions/connectorFixtures.test-support.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

async function until(predicate: () => boolean, diagnostics: () => string, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Permission test timed out: ${diagnostics()}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function fixture(tool: string, input: (directory: string) => unknown, mode: PermissionMode = 'default', disableBypass = false, repeated = false) {
  const directory = await mkdtemp(join(tmpdir(), 'sample-permission-'))
  const connector = /^(?:cnx_([^_]+)_(.+)|mcp__([^_]+)__(.+))$/.exec(tool)
  const serverName = connector?.[1] ?? connector?.[3], toolName = connector?.[2] ?? connector?.[4]
  if (connector) tool = `cnx_${serverName}_${toolName}`
  const bodies: any[] = []
  let calls = 0
  let mcpCalls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const server = createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()
    if (req.url === '/mcp') {
      if (req.method !== 'POST') { res.writeHead(405).end(); return }
      const rpc = JSON.parse(body)
      if (!('id' in rpc)) { res.writeHead(202).end(); return }
      let result: unknown = {}
      if (rpc.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'permission-fixture', version: '1' } }
      if (rpc.method === 'tools/list') result = { tools: [{ name: toolName, description: 'Local test tool', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }] }
      if (rpc.method === 'tools/call') { mcpCalls++; result = { content: [{ type: 'text', text: 'Local search result' }] } }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }))
      return
    }
    if (!req.url?.split('?')[0]?.endsWith('/messages')) { res.writeHead(404).end(); return }
    bodies.push(JSON.parse(body))
    calls++
    if (calls === 1) await gate
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', { type: 'message_start', message: { id: `msg_${calls}`, type: 'message', role: 'assistant', model: 'local-tool-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    const useTool = repeated ? calls <= 5 : calls === 1
    if (useTool) {
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: repeated ? `toolu_repeat_${calls}` : 'toolu_cancel_test', name: tool, input: {} } })
      const args = repeated && calls % 2 === 0 ? { query: `different search ${calls}` } : input(directory)
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } })
    } else {
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Next turn works.' } })
    }
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: useTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
    sse('message_stop', { type: 'message_stop' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const messages: EngineMessage[] = []
  const notices: string[] = []
  const engine = new Engine({ cwd: directory, ...TEST_ROOTS, configDir: testConfig(join(directory, 'configuration')),
    settings: { ...DEFAULT_SESSION_SETTINGS, tools: connector ? [] : [tool], permissionMode: mode },
    mcpConfig: async () => connector ? { config: JSON.stringify({ mcpServers: { [serverName!]: { type: 'http', url: `http://127.0.0.1:${port}/mcp` } } }), env: {}, notices: [], writeTools: { tickets: TICKETS_CONNECTOR.writeTools! } } : null,
    extraEnv: async () => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'local-tool-test', ANTHROPIC_AUTH_TOKEN: 'local-test', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }),
  })
  engine.on('message', message => messages.push(message))
  engine.on('message', message => {
    if (message.type === 'control_request' && message.request?.tool_name === 'permission_escalation') engine.respondToPermission(message.request_id, disableBypass ? { behavior: 'deny', message: 'Refus humain du changement de mode.' } : { behavior: 'allow', updatedInput: message.request.input })
  })
  engine.on('notice', notice => notices.push(notice.text))
  const diagnostics = () => JSON.stringify({ notices, messages })
  return {
    directory, engine, messages, bodies, notices, diagnostics, release, calls: () => calls, mcpCalls: () => mcpCalls,
    cleanup() { release(); engine.stop(); server.closeAllConnections(); server.close() },
  }
}

for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'plan'] as const) {
  for (const tool of ['mcp__tickets__update_issues']) {
    test('connector write ' + tool + ' requires confirmation in ' + mode, async () => {
      const f = await fixture(tool, () => ({ query: 'write request' }), mode)
      let requests = 0
      f.engine.on('message', message => {
        if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
          requests++; f.engine.respondToPermission(message.request_id, { behavior: 'deny', message: 'Not confirmed.' })
        }
      })
      try {
        await f.engine.send('Exercise mandatory connector write approval.'); f.release()
        await until(() => !f.engine.isBusy, f.diagnostics)
        expect(requests).toBe(mode === 'plan' || mode === 'dontAsk' ? 0 : 1); expect(f.mcpCalls()).toBe(0)
      } finally { f.cleanup() }
    }, 30000)
  }
}

test('connector writes ignore allow rules and automatic PreToolUse/PermissionRequest approvals', async () => {
  const tool = 'mcp__tickets__update_issues'
  const f = await fixture(tool, () => ({ query: 'confirmed by person' }), 'bypassPermissions')
  await mkdir(join(f.directory, '.claude'), { recursive: true })
  const pre = join(f.directory, 'pre.cjs'), permission = join(f.directory, 'permission.cjs')
  await writeFile(pre, `require('fs').writeFileSync(${JSON.stringify(join(f.directory, 'pre-ran.txt'))},'ran');process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput:{query:'hook proposed input'}}}))`)
  await writeFile(permission, `require('fs').writeFileSync(${JSON.stringify(join(f.directory, 'hook-ran.txt'))},'ran');process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'PermissionRequest',decision:{behavior:'allow'}}}))`)
  await writeFile(join(f.directory, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: [tool] }, hooks: {
    PreToolUse: [{ matcher: tool, hooks: [{ type: 'command', command: 'node "' + pre.replaceAll('\\', '/') + '"' }] }],
    PermissionRequest: [{ matcher: tool, hooks: [{ type: 'command', command: 'node "' + permission.replaceAll('\\', '/') + '"' }] }],
  } }))
  let requests = 0
  f.engine.on('message', message => { if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
    requests++; f.engine.respondToPermission(message.request_id, { behavior: 'allow', updatedInput: { query: 'confirmed by person' } })
  } })
  try {
    await f.engine.send('Exercise mandatory confirmation despite automatic hook approvals.'); f.release()
    await until(() => !f.engine.isBusy, f.diagnostics)
    expect(requests).toBe(1); expect(f.mcpCalls()).toBe(1)
    expect(existsSync(join(f.directory, 'pre-ran.txt'))).toBe(false)
    expect(existsSync(join(f.directory, 'hook-ran.txt'))).toBe(false)
  } finally { f.cleanup() }
}, 30000)

for (const mode of ['acceptEdits', 'bypassPermissions', 'dontAsk'] as const) {
  test('MCP search respects ' + mode + ' independently of file-edit permissions', async () => {
    const f = await fixture('mcp__search__WebSearch', () => ({ query: 'local test' }), mode)
    let requests = 0
    f.engine.on('message', message => {
      if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
        requests++
        f.engine.respondToPermission(message.request_id, { behavior: 'allow', updatedInput: { query: 'local test' } })
      }
    })
    try {
      await f.engine.send('Exercise MCP permission mode.')
      f.release()
      await until(() => !f.engine.isBusy, f.diagnostics)
      expect(requests).toBe(mode === 'acceptEdits' ? 1 : 0)
      expect(f.mcpCalls()).toBe(mode === 'dontAsk' ? 0 : 1)
      if (mode === 'dontAsk') {
        const results = f.bodies[1].messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((b: any) => b.type === 'tool_result')
        expect(JSON.stringify(results)).toContain('Action refusée en mode sans demande')
        expect(JSON.stringify(results)).not.toContain('Claude Code')
      }
      expect(f.calls()).toBe(2)
    } finally { f.cleanup() }
  }, 30000)
}


for (const mode of ['default', 'acceptEdits', 'bypassPermissions', 'dontAsk', 'plan'] as const) {
  test('permission mode ' + mode + ' governs a real CLI write', async () => {
    const f = await fixture('write_file', directory => ({ path: join(directory, 'output.txt'), content: 'authorized' }), mode)
    const requests: string[] = []
    f.engine.on('message', message => {
      if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
        requests.push(message.request_id)
        f.engine.respondToPermission(message.request_id, { behavior: 'deny', message: 'Denied by test user.' })
      }
    })
    try {
      await f.engine.send('Exercise the write tool.')
      f.release()
      await until(() => !f.engine.isBusy, f.diagnostics)
      const automatic = mode === 'acceptEdits' || mode === 'bypassPermissions'
      expect(existsSync(join(f.directory, 'output.txt'))).toBe(automatic)
      if (automatic) expect(await readFile(join(f.directory, 'output.txt'), 'utf8')).toBe('authorized')
      expect(requests.length).toBe(mode === 'default' ? 1 : 0)
      expect(f.messages.filter(m => m.type === 'result')).toHaveLength(1)
      expect(f.calls()).toBe(2)
      const terminal = f.messages.find(m => m.type === 'result')
      expect(terminal).toMatchObject({ subtype: 'success', is_error: false, stop_reason: 'end_turn' })
      const results = f.bodies[1].messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((c: any) => c.type === 'tool_result')
      expect(results).toHaveLength(1)
      expect(results[0].tool_use_id).toBe('toolu_cancel_test')
      expect(Boolean(results[0].is_error)).toBe(!automatic)
    } finally { f.cleanup() }
  }, 30000)
}

test('a live switch to bypassPermissions is acknowledged and applies before the next tool', async () => {
  const f = await fixture('write_file', directory => ({ path: join(directory, 'live.txt'), content: 'live mode' }))
  try {
    await f.engine.send('Exercise live permission mode.')
    await until(() => f.messages.some(m => m.type === 'system' && m.subtype === 'init'), f.diagnostics)
    f.engine.updateSettings({ ...f.engine.currentSettings, permissionMode: 'bypassPermissions' })
    await until(() => f.messages.some(m => m.type === 'control_response' && String((m as any).id).startsWith('set-mode-')), f.diagnostics)
    const response = f.messages.find(m => m.type === 'control_response' && String((m as any).id).startsWith('set-mode-')) as Record<string, any> | undefined
    expect(response?.ok).toBe(true)
    f.release()
    await until(() => !f.engine.isBusy, f.diagnostics)
    expect(await readFile(join(f.directory, 'live.txt'), 'utf8')).toBe('live mode')
    expect(f.messages.filter(m => m.type === 'control_request' && (m as any).request?.tool_name !== 'permission_escalation')).toHaveLength(0)
  } finally { f.cleanup() }
}, 30000)

for (const mode of ['acceptEdits', 'plan', 'dontAsk'] as const) {
  test('leaving bypass for ' + mode + ' applies to the next tool', async () => {
    const f = await fixture('write_file', directory => ({ path: join(directory, 'output.txt'), content: 'changed' }), 'bypassPermissions')
    let requests = 0
    f.engine.on('message', message => {
      if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
        requests++
        f.engine.respondToPermission(message.request_id, { behavior: 'deny', message: 'Denied' })
      }
    })
    try {
      await f.engine.send('Exercise a more restrictive live mode.')
      await until(() => f.messages.some(m => m.type === 'system' && m.subtype === 'init'), f.diagnostics)
      f.engine.updateSettings({ ...f.engine.currentSettings, permissionMode: mode })
      await until(() => f.messages.some(m => m.type === 'control_response' && String((m as any).id).startsWith('set-mode-')), f.diagnostics)
      f.release()
      await until(() => !f.engine.isBusy, f.diagnostics)
      expect(existsSync(join(f.directory, 'output.txt'))).toBe(mode === 'acceptEdits')
      expect(requests).toBe(0)
      expect(f.engine.currentSettings.permissionMode).toBe(mode)
    } finally { f.cleanup() }
  }, 30000)
}

test('a policy-rejected live mode restores the effective setting and explains the refusal', async () => {
  const f = await fixture('write_file', directory => ({ path: join(directory, 'output.txt'), content: 'forbidden' }), 'default', true)
  const restored: string[] = []
  f.engine.on('settings', settings => restored.push(settings.permissionMode))
  f.engine.on('message', message => {
    if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool') {
      f.engine.respondToPermission(message.request_id, { behavior: 'deny', message: 'Denied' })
    }
  })
  try {
    await f.engine.send('Exercise a policy refusal.')
    await until(() => f.messages.some(m => m.type === 'system' && m.subtype === 'init'), f.diagnostics)
    f.engine.updateSettings({ ...f.engine.currentSettings, permissionMode: 'bypassPermissions' })
    await until(() => restored.length > 0, f.diagnostics)
    expect(restored).toEqual(['default'])
    expect(f.engine.currentSettings.permissionMode).toBe('default')
    expect(f.notices.some(text => text.includes('Changement de mode refusé'))).toBe(true)
    // A failed older choice must not overwrite a newer acknowledged mode.
    for (const mode of ['bypassPermissions', 'plan', 'bypassPermissions'] as const) {
      f.engine.updateSettings({ ...f.engine.currentSettings, permissionMode: mode })
    }
    await until(() => f.messages.filter(m => m.type === 'control_response' && String((m as any).id).startsWith('set-mode-')).length === 4, f.diagnostics)
    expect(f.engine.currentSettings.permissionMode).toBe('plan')
    f.release()
    await until(() => !f.engine.isBusy, f.diagnostics)
    expect(existsSync(join(f.directory, 'output.txt'))).toBe(false)
  } finally { f.cleanup() }
}, 30000)

test('invalid tool input returns a correlated error to the model and the query finishes once', async () => {
  const f = await fixture('write_file', () => ({ content: 'missing required path' }), 'acceptEdits')
  try {
    await f.engine.send('Exercise invalid tool input.')
    f.release()
    await until(() => !f.engine.isBusy, f.diagnostics)
    expect(f.calls()).toBe(2)
    const results = f.bodies[1].messages.flatMap((m: any) => Array.isArray(m.content) ? m.content : []).filter((c: any) => c.type === 'tool_result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ tool_use_id: 'toolu_cancel_test', is_error: true })
    expect(f.messages.filter(m => m.type === 'result')).toHaveLength(1)
    expect(f.messages.find(m => m.type === 'result')).toMatchObject({ subtype: 'success', is_error: false, stop_reason: 'end_turn' })
    expect(f.messages.some(m => m.type === 'control_request')).toBe(false)
  } finally { f.cleanup() }
}, 30000)
