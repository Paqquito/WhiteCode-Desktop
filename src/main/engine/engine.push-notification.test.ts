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
  tools?: Array<{ name: string; description?: string }>
  messages?: Array<{
    content:
      | string
      | Array<{
          type: string
          tool_use_id?: string
          is_error?: boolean
          content?: unknown
        }>
  }>
}

// PushNotification est reconstruit dans WhiteCode (T40). Le moteur tournant en
// `-p` sous l'application desktop, aucun terminal interactif ne peut recevoir
// l'écho : l'outil doit donc répondre `disabled` **sans échouer**, et le
// dire au modèle. C'est cette limite que le test fige — la lever demande de
// relayer la notification jusqu'aux notifications natives du desktop (T10).
test('PushNotification is offered and reports honestly when no channel exists', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-push-notification-'))
  const requests: InferenceRequest[] = []
  const messages: EngineMessage[] = []
  const notices: string[] = []

  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (!req.url?.split('?')[0]?.endsWith('/messages')) {
      res.writeHead(404).end()
      return
    }
    requests.push(JSON.parse(raw) as InferenceRequest)
    const first = requests.length === 1
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', {
      type: 'message_start',
      message: {
        id: `msg_${requests.length}`,
        type: 'message',
        role: 'assistant',
        model: 'local-push-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    })
    sse('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: first
        ? {
            type: 'tool_use',
            id: 'push-1',
            name: 'notify_device',
            input: {},
          }
        : { type: 'text', text: '' },
    })
    sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: first
        ? {
            type: 'input_json_delta',
            partial_json: JSON.stringify({
              message: 'build failed: 2 auth tests',
            }),
          }
        : { type: 'text_delta', text: 'Notification traitée.' },
    })
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: first ? 'tool_use' : 'end_turn',
        stop_sequence: null,
      },
      usage: { output_tokens: 5 },
    })
    sse('message_stop', { type: 'message_stop' })
    res.end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port

  const engine = new Engine({
    cwd: directory,
    configDir: testConfig(join(directory, 'configuration')),
    ...TEST_ROOTS,
    settings: {
      ...DEFAULT_SESSION_SETTINGS,
      tools: null,
      permissionMode: 'bypassPermissions',
    },
    extraEnv: async () => ({
      ...ISOLATION_ENV,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_MODEL: 'local-push-test',
      ANTHROPIC_AUTH_TOKEN: 'local-test',
    }),
  })
  engine.on('message', message => messages.push(message))
  engine.on('notice', notice => notices.push(notice.text))

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const end = once(engine, 'turn-end')
    await engine.send('Préviens-moi quand la compilation échoue.')
    await Promise.race([
      end,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                'No turn end: ' +
                  JSON.stringify({ notices, types: messages.map(m => m.type) }),
              ),
            ),
          12000,
        )
      }),
    ])

    // 1. L'outil est proposé au modèle.
    const offered = requests[0]?.tools?.find(t => t.name === 'notify_device')
    expect(offered).toBeDefined()
    expect(offered?.description).toContain('notification')
    const init = messages.find(m => m.type === 'system' && m.subtype === 'init')
    expect(init && 'tools' in init ? init.tools : []).toContain(
      'notify_device',
    )

    // 2. L'appel aboutit sans erreur et annonce l'absence de canal.
    const blocks = requests
      .flatMap(r => r.messages ?? [])
      .flatMap(m => (Array.isArray(m.content) ? m.content : []))
    const result = blocks.find(
      b => b.type === 'tool_result' && b.tool_use_id === 'push-1',
    )
    expect(result).toBeDefined()
    expect(result?.is_error).toBeFalsy()
    expect(JSON.stringify(result?.content)).toContain('disabled')
    expect(messages.some(m => m.type === 'result' && !m.is_error)).toBe(true)
  } finally {
    clearTimeout(timer)
    engine.stop()
    server.closeAllConnections()
    server.close()
  }
}, 20000)
