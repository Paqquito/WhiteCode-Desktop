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
          text?: string
          tool_use_id?: string
          is_error?: boolean
          content?: unknown
        }>
  }>
}

// Monitor est reconstruit dans WhiteCode (T40) : le drapeau `MONITOR_TOOL`
// existait partout, le module nulle part. Ce contrôle éprouve les trois
// moitiés du parcours qu'aucun typage ne garantit — l'outil est proposé au
// modèle, la commande part vraiment en tâche de fond, et ce qu'elle écrit
// revient au modèle sous forme de notification, dans le même tour.
//
// Le modèle simulé enchaîne quelques appels triviaux après le Monitor : c'est
// ce qui laisse à la commande surveillée le temps de finir et à la boucle de
// requête l'occasion de vider la file de notifications.
test('Monitor is offered, runs in the background and reports back within the turn', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-monitor-'))
  const marker = 'monitor-tick-1'

  const requests: InferenceRequest[] = []
  const messages: EngineMessage[] = []
  const notices: string[] = []
  const FILLER_TURNS = 8

  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (!req.url?.split('?')[0]?.endsWith('/messages')) {
      res.writeHead(404).end()
      return
    }
    requests.push(JSON.parse(raw) as InferenceRequest)
    const nth = requests.length
    const seen = JSON.stringify(requests.map(r => r.messages ?? []))
    // On s'arrête dès que les deux notifications sont arrivées — celle du flux
    // et celle de la fin — sans attendre les tours de remplissage restants.
    const done =
      nth > 1 &&
      ((seen.includes(marker) && seen.includes('ended with exit code 0')) ||
        nth > FILLER_TURNS)
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', {
      type: 'message_start',
      message: {
        id: `msg_${nth}`,
        type: 'message',
        role: 'assistant',
        model: 'local-monitor-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    })
    const block =
      nth === 1
        ? { type: 'tool_use', id: 'monitor-1', name: 'monitor_process', input: {} }
        : done
          ? { type: 'text', text: '' }
          : { type: 'tool_use', id: `echo-${nth}`, name: 'run_powershell', input: {} }
    sse('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: block,
    })
    const input =
      nth === 1
        ? {
            description: 'test tick',
            // Émet pendant ~5 s : plus long que le tic de relevé (2 s), sinon
            // seule la notification de fin serait éprouvée.
            command: `for i in 1 2 3 4 5 6 7 8; do echo ${marker}; sleep 0.6; done`,
            timeout_ms: 30000,
            persistent: false,
          }
        : // `sleep 1` reste sous le seuil que BashTool refuse (2 s) : il faut
          // bien laisser passer du temps pour que la surveillance émette.
          { command: `Start-Sleep -Seconds 1; Write-Output 'attente ${nth}'`, description: 'attendre' }
    sse('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: done
        ? { type: 'text_delta', text: 'Surveillance lancée.' }
        : { type: 'input_json_delta', partial_json: JSON.stringify(input) },
    })
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: done ? 'end_turn' : 'tool_use',
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
      ANTHROPIC_MODEL: 'local-monitor-test',
      ANTHROPIC_AUTH_TOKEN: 'local-test',
    }),
  })
  engine.on('message', message => messages.push(message))
  engine.on('notice', notice => notices.push(notice.text))

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const end = once(engine, 'turn-end')
    await engine.send('Surveille la commande de test.')
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
          25000,
        )
      }),
    ])

    // 1. L'outil est proposé au modèle, avec sa description.
    const offered = requests[0]?.tools?.find(t => t.name === 'monitor_process')
    expect(offered).toBeDefined()
    expect(offered?.description).toContain('Runs a command in the background')
    const init = messages.find(m => m.type === 'system' && m.subtype === 'init')
    expect(init && 'tools' in init ? init.tools : []).toContain('monitor_process')

    // 2. L'appel aboutit : la tâche de fond est créée, sans erreur.
    const blocks = requests
      .flatMap(r => r.messages ?? [])
      .flatMap(m => (Array.isArray(m.content) ? m.content : []))
    const result = blocks.find(
      b => b.type === 'tool_result' && b.tool_use_id === 'monitor-1',
    )
    expect(result).toBeDefined()
    expect(result?.is_error).toBeFalsy()
    expect(JSON.stringify(result?.content)).toContain('started')

    // 3. Ce que la commande a écrit revient au modèle dans le même tour. Une
    //    notification qui n'arriverait pas ferait de Monitor un Bash en tâche
    //    de fond sous un autre nom.
    const conversation = blocks
      .map(b => (typeof b.content === 'string' ? b.content : (b.text ?? '')))
      .join('\n')
    expect(conversation).toContain('test tick')
    expect(conversation).toContain(marker)
    expect(messages.some(m => m.type === 'result' && !m.is_error)).toBe(true)
  } finally {
    clearTimeout(timer)
    engine.stop()
    server.closeAllConnections()
    server.close()
  }
}, 40000)
