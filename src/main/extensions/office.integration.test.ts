import { testConfig } from '../engine/testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Engine } from '../engine/engine.js'
import { Extensions, OFFICE_PLUGIN } from './plugins.js'
import ExcelJS from 'exceljs'
import { cp } from 'node:fs/promises'
import { DEFAULT_SESSION_SETTINGS, ESSENTIAL_TOOLS, type EngineMessage } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { EXTENSIONS_ROOT, TEST_ROOTS } from '../testRoots.test-support.js'

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

test('shell generation attaches every declared document before the first reply without a model delivery call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wc-send-user-file-'))
  const delivered = join(directory, 'budget.xlsx')
  // Le vrai parcours : le catalogue WhiteCode-Extensions (copie locale du
  // dépôt voisin), l'installation par git, l'activation, puis le runtime
  // désigné au moteur par OFFICE_RUNTIME.
  const customizations = EXTENSIONS_ROOT
  const catalogue = join(directory, 'catalogue')
  await cp(join(customizations, '.claude-plugin'), join(catalogue, '.claude-plugin'), { recursive: true })
  await cp(join(customizations, 'plugins', 'office'), join(catalogue, 'plugins', 'office'), { recursive: true })
  const git = (...args: string[]) => execFileSync('git', ['-C', catalogue, ...args], { stdio: 'pipe', windowsHide: true })
  git('init', '--template='); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'catalogue')
  const extensions = new Extensions(join(directory, 'profile'), TEST_ROOTS)
  await extensions.addSource(catalogue, 'HEAD')
  const listed = (await extensions.list()).find(entry => entry.name === OFFICE_PLUGIN)!
  expect(listed.displayName).toBe('Bureautique')
  expect(listed.recommended).toBe(true)
  expect(await extensions.officeRuntime()).toBeUndefined()
  expect(await extensions.install(listed.id, () => {})).toBe(true)
  await extensions.setEnabled(listed.id, true)
  const runtime = await extensions.officeRuntime()
  expect(runtime).toBeTruthy()
  const office = dirname(runtime!)
  await writeFile(join(directory, 'README.md'), '# Revue\n\n## À confirmer\n\n- Valider le lot A.\n\n| Lot | Essais |\n|---|---|\n| A | 17 |\n')

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
    const first = requests.length <= 2
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
            id: `office-tool-${requests.length}`,
            name: requests.length === 1 ? 'use_skill' : (process.platform === 'win32' ? 'run_powershell' : 'run_shell'),
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
            partial_json: JSON.stringify(requests.length === 1 ? { name: OFFICE_PLUGIN + ':excel' } : { attach_files: ['budget.xlsx', 'revue.pdf'], command: process.platform === 'win32'
              ? "$env:ELECTRON_RUN_AS_NODE='1'; & $env:OFFICE_NODE $env:OFFICE_RUNTIME --convert ./README.md ./budget.xlsx ./revue.pdf; if ($LASTEXITCODE -ne 0) { throw 'office failed' }"
              : 'ELECTRON_RUN_AS_NODE=1 "$OFFICE_NODE" "$OFFICE_RUNTIME" --convert ./README.md ./budget.xlsx ./revue.pdf' }),
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
      tools: ESSENTIAL_TOOLS,
      permissionMode: 'bypassPermissions',
    },
    pluginDirs: () => extensions.pluginDirs(),
    extraEnv: async () => ({
      OFFICE_NODE: process.platform === 'win32' ? fileURLToPath(new URL('../../../node_modules/electron/dist/electron.exe', import.meta.url)) : 'node', OFFICE_RUNTIME: join(office, 'office.cjs'), CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
      ...ISOLATION_ENV,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_MODEL: 'local-file-test',
      ANTHROPIC_AUTH_TOKEN: 'local-test',
    }),
  })
  engine.on('message', message => messages.push(message))
  engine.on('message', message => { if(message.type === 'control_request') engine.respondToPermission(message.request_id, { behavior: 'allow', updatedInput: message.request.input }) })
  engine.on('notice', notice => notices.push(notice.text))

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const end = once(engine, 'turn-end')
    await engine.send('/whitecode-office:excel Crée le budget et envoie le fichier.')
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

    expect(JSON.stringify(requests[0])).toContain('OFFICE_RUNTIME')
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(delivered)
    expect(workbook.getWorksheet('Tableau 1')!.getCell('B2').value).toBe(17)
    expect(notices.filter(n => n.startsWith('Fichier disponible')).map(n => n.split(' : ').at(-1))).toEqual(['budget.xlsx', 'revue.pdf'])

    // L'outil est proposé au modèle, avec sa description.
    const offered = requests[0]?.tools?.find(t => t.name === 'deliver_file')
    expect(offered).toBeDefined()
    expect(offered?.description).toContain('Deliver existing local files')
    const init = messages.findLast(m => m.type === 'system' && m.subtype === 'init')
    expect(init && 'tools' in init ? init.tools : []).toContain('deliver_file')

    // 2. L'appel réel aboutit : résultat non erroné, fichier compté.
    const blocks = requests
      .flatMap(r => r.messages ?? [])
      .flatMap(m => (Array.isArray(m.content) ? m.content : []))
    const loaded = blocks.find(b => b.type === 'tool_result' && b.tool_use_id === 'office-tool-1')
    expect(loaded?.is_error).toBeFalsy()
    expect(JSON.stringify(loaded?.content)).toContain('OFFICE_RUNTIME')
    const deliveryMessage = requests.at(-1)?.messages?.find(m => Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use' && 'name' in b && b.name === 'deliver_file'))
    expect(deliveryMessage?.content).toContainEqual({ type: 'text', text: 'Transmission des fichiers demandés.' })
    const result = blocks.find(
      b => b.type === 'tool_result' && b.tool_use_id?.startsWith('file_'),
    )
    expect(result).toBeDefined()
    expect(result?.is_error).toBeFalsy()
    expect(JSON.stringify(result?.content)).toContain('2/2 file(s) delivered')
    expect(messages.some(m => m.type === 'result' && !m.is_error)).toBe(true)
  } finally {
    clearTimeout(timer)
    engine.stop()
    server.closeAllConnections()
    server.close()
  }
}, 20000)
