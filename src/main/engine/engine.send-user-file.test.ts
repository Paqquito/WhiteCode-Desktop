import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
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

// SendUserFile est reconstruit dans WhiteCode (T40) : son module manquait de
// `src/`, seules ses déclarations fantômes subsistaient. Ce contrôle vérifie
// les deux moitiés du parcours — l'outil est bien proposé au modèle, et un
// appel réel aboutit sans erreur.
test('SendUserFile is offered to the model and delivers a real file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-send-user-file-'))
  const delivered = join(directory, 'rapport.md')
  await writeFile(delivered, '# Rapport\n\nContenu de test.\n')

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
        model: 'local-file-test',
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
            id: 'send-file-1',
            name: 'deliver_file',
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
              files: [delivered],
              caption: 'Le rapport demandé.',
              status: 'normal',
            }),
          }
        : { type: 'text_delta', text: 'Fichier envoyé.' },
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
      ANTHROPIC_MODEL: 'local-file-test',
      ANTHROPIC_AUTH_TOKEN: 'local-test',
    }),
  })
  engine.on('message', message => messages.push(message))
  engine.on('notice', notice => notices.push(notice.text))

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const end = once(engine, 'turn-end')
    await engine.send('Envoie-moi le rapport.')
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

    // 1. L'outil est proposé au modèle, avec sa description.
    const offered = requests[0]?.tools?.find(t => t.name === 'deliver_file')
    expect(offered).toBeDefined()
    expect(offered?.description).toContain('Deliver existing local files')
    const init = messages.findLast(m => m.type === 'system' && m.subtype === 'init')
    expect(init && 'tools' in init ? init.tools : []).toContain('deliver_file')

    // 2. L'appel réel aboutit : résultat non erroné, fichier compté.
    const blocks = requests
      .flatMap(r => r.messages ?? [])
      .flatMap(m => (Array.isArray(m.content) ? m.content : []))
    const result = blocks.find(
      b => b.type === 'tool_result' && b.tool_use_id === 'send-file-1',
    )
    expect(result).toBeDefined()
    expect(result?.is_error).toBeFalsy()
    expect(JSON.stringify(result?.content)).toContain('1/1 file(s) delivered')
    expect(messages.some(m => m.type === 'result' && !m.is_error)).toBe(true)
  } finally {
    clearTimeout(timer)
    engine.stop()
    server.closeAllConnections()
    server.close()
  }
}, 20000)
