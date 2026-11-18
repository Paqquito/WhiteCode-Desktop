import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Engine } from './engine.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

test('interrupting the built CLI closes its inference stream and permits a subsequent turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-cancel-inference-'))
  let count = 0
  let disconnected!: () => void
  let received!: () => void
  const closed = new Promise<void>(resolve => { disconnected = resolve })
  const request = new Promise<void>(resolve => { received = resolve })
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* Drain input before streaming. */ }
    if (!req.url?.split('?')[0]?.endsWith('/messages')) { res.writeHead(404).end(); return }
    count++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', { type: 'message_start', message: { id: `msg_${count}`, type: 'message', role: 'assistant', model: 'local-cancel-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Réponse partielle' } })
    if (count === 1) {
      res.once('close', disconnected)
      received()
    } else {
      sse('content_block_stop', { type: 'content_block_stop', index: 0 })
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
      sse('message_stop', { type: 'message_stop' })
      res.end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const engine = new Engine({ cwd: directory, ...TEST_ROOTS, configDir: testConfig(directory),
    settings: { ...DEFAULT_SESSION_SETTINGS, tools: [] },
    extraEnv: async () => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'local-cancel-test', ANTHROPIC_AUTH_TOKEN: 'local-test' }),
  })
  const notices: string[] = []
  engine.on('notice', notice => notices.push(notice.text))
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Inference cancellation timed out: ${notices.join('; ')}`)), 15000) })
  try {
    await engine.send('Écris une longue réponse sans outils.')
    await Promise.race([request, deadline])
    const ended = once(engine, 'turn-end')
    engine.interrupt()
    await Promise.race([Promise.all([closed, ended]), deadline])
    expect(engine.isBusy).toBe(false)
    expect(notices).toContain('Tour interrompu.')
    const nextEnded = once(engine, 'turn-end')
    await engine.send('Réponds brièvement.')
    await Promise.race([nextEnded, deadline])
    expect(count).toBe(2)
    expect(engine.isBusy).toBe(false)
  } finally {
    clearTimeout(timeout)
    engine.stop()
    server.closeAllConnections()
    server.close()
  }
}, 20000)
