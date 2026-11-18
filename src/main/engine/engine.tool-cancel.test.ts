import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Engine } from './engine.js'
import { DEFAULT_SESSION_SETTINGS, type EngineMessage } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

async function until(predicate: () => boolean, diagnostics: () => string, milliseconds = 15000) {
  const deadline = Date.now() + milliseconds
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Tool cancellation timed out: ${diagnostics()}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

async function fixture(tool: string, input: (directory: string) => unknown, automatic = false) {
  const directory = await mkdtemp(join(tmpdir(), 'sample-cancel-tool-'))
  let calls = 0
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* The fixture never sends input outside loopback. */ }
    if (!req.url?.split('?')[0]?.endsWith('/messages')) { res.writeHead(404).end(); return }
    calls++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', { type: 'message_start', message: { id: `msg_${calls}`, type: 'message', role: 'assistant', model: 'local-tool-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    if (calls === 1) {
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_cancel_test', name: tool, input: {} } })
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input(directory)) } })
    } else {
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Next turn works.' } })
    }
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: calls === 1 ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
    sse('message_stop', { type: 'message_stop' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const messages: EngineMessage[] = []
  const notices: string[] = []
  const engine = new Engine({ cwd: directory, ...TEST_ROOTS, configDir: testConfig(join(directory, 'configuration')),
    settings: { ...DEFAULT_SESSION_SETTINGS, tools: [tool], permissionMode: automatic ? 'bypassPermissions' : 'default' },
    extraEnv: async () => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'local-tool-test', ANTHROPIC_AUTH_TOKEN: 'local-test', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }),
  })
  engine.on('message', message => messages.push(message))
  engine.on('message', message => { if (automatic && message.type === 'control_request') engine.respondToPermission(message.request_id, { behavior: 'allow', updatedInput: message.request.input }) })
  engine.on('notice', notice => notices.push(notice.text))
  const diagnostics = () => JSON.stringify({ notices, messages })
  return {
    directory, engine, messages, diagnostics, calls: () => calls,
    async cancelAndContinue() {
      engine.interrupt()
      await until(() => !engine.isBusy, diagnostics, 6000)
      const countAfterCancel = messages.length
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(messages.length).toBe(countAfterCancel)
      await engine.send('Answer briefly without tools.')
      await until(() => !engine.isBusy, diagnostics)
      expect(messages.some(message => message.type === 'result' && message.result === 'Next turn works.')).toBe(true)
      expect(calls).toBe(2)
    },
    cleanup() { engine.stop(); server.closeAllConnections(); server.close() },
  }
}

test('cancelling a real CLI permission prompt prevents the write and ignores a stale approval', async () => {
  const f = await fixture('write_file', directory => ({ path: join(directory, 'must-not-exist.txt'), content: 'not authorized' }))
  try {
    await f.engine.send('Exercise the test write tool.')
    const isPermission = (message: EngineMessage) => message.type === 'control_request' && (message.request as { subtype?: string })?.subtype === 'can_use_tool'
    await until(() => f.messages.some(isPermission), f.diagnostics)
    const permission = f.messages.find(isPermission) as { request_id: string; request: { input: Record<string, unknown> } }
    await f.cancelAndContinue()
    f.engine.respondToPermission(permission.request_id, { behavior: 'allow', updatedInput: permission.request.input })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(existsSync(join(f.directory, 'must-not-exist.txt'))).toBe(false)
  } finally { f.cleanup() }
}, 30000)

test('cancelling a real CLI foreground shell stops its process before its delayed write', async () => {
  const windows = process.platform === 'win32'
  const f = await fixture(windows ? 'run_powershell' : 'run_shell', directory => {
    const pid = join(directory, 'started.pid').replace(/\\/g, '/')
    const done = join(directory, 'must-not-exist.txt').replace(/\\/g, '/')
    // Publish the startup signal atomically: existence must mean a complete PID.
    return { command: windows
      ? `Set-Content -LiteralPath '${pid}.pending' -Value $PID; Move-Item -LiteralPath '${pid}.pending' -Destination '${pid}'; Start-Sleep -Seconds 6; Set-Content -LiteralPath '${done}' -Value 'late'`
      : `printf '%s' "$$" > '${pid}.pending'; mv '${pid}.pending' '${pid}'; sleep 6; printf late > '${done}'`, timeout: 20000 }
  }, true)
  let pid: number | undefined
  try {
    await f.engine.send('Exercise the test shell command.')
    await until(() => existsSync(join(f.directory, 'started.pid')), f.diagnostics)
    pid = Number((await readFile(join(f.directory, 'started.pid'), 'utf8')).trim())
    expect(pid).toBeGreaterThan(0)
    await f.cancelAndContinue()
    await until(() => {
      try { process.kill(pid!, 0); return false } catch { return true }
    }, f.diagnostics, 4000)
    // Le petit-fils aussi : le shell est chef de son groupe de processus, donc
    // `kill(-pid, 0)` interroge le groupe entier. C'est ce que T39 avait pris
    // en défaut — le `sleep` survivait, réattaché à init, pendant que son bash
    // parent mourait. Sans objet sous Windows, qui n'a pas de groupes.
    if (!windows) {
      expect(() => process.kill(-pid!, 0)).toThrow()
    }
    expect(existsSync(join(f.directory, 'must-not-exist.txt'))).toBe(false)
  } finally {
    f.cleanup()
    if (pid) try { process.kill(pid) } catch { /* Already stopped by cancellation. */ }
  }
}, 30000)
