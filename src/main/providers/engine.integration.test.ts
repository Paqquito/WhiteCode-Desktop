import { expect, test } from 'bun:test'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Engine } from '../engine/engine.js'
import { testConfig } from '../engine/testConfig.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { OpenAIBridge } from './openaiBridge.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

test('native WhiteCode completes a turn through the desktop OpenAI bridge', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'white-openai-'))
  let requested = ''
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requested = (await request.json()).model
    return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'OPENAI_BRIDGE_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  const bridge = new OpenAIBridge({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'fixture-model' })
  const baseUrl = await bridge.start(), messages: any[] = []
  const engine = new Engine({ ...TEST_ROOTS, cwd: directory, configDir: testConfig(join(directory, 'configuration')),
    settings: { ...DEFAULT_SESSION_SETTINGS, tools: [] }, extraEnv: async () => ({ ANTHROPIC_MODEL: 'fixture-model', ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: bridge.token }) })
  engine.on('message', message => messages.push(message))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const ended = once(engine, 'turn-end'); await engine.send('Reply with the marker.')
    const [outcome] = await Promise.race([ended, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error(JSON.stringify(messages))), 15000) })])
    expect(outcome).toMatchObject({ failed: false }); expect(requested).toBe('fixture-model'); expect(JSON.stringify(messages)).toContain('OPENAI_BRIDGE_OK')
  } finally { clearTimeout(timer); engine.stop(); bridge.stop(); server.stop(true) }
}, 20000)
