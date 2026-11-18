import { testConfig } from '../engine/testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { Engine } from '../engine/engine.js'
import { Extensions } from './plugins.js'
import { DEFAULT_SESSION_SETTINGS, type EngineMessage } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

test('catalogue standalone skill reaches the real CLI and disappears after deactivation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fixture-skill-engine-')), repository = join(root, 'source')
  await mkdir(join(repository, 'sample'), { recursive: true })
  await writeFile(join(repository, 'sample/SKILL.md'), '---\nname: sample\ndescription: Catalogue integration skill\n---\nReturn CATALOGUE_SKILL_LOADED.\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe', windowsHide: true })
  git('init', '--template='); git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture')
  const extensions = new Extensions(join(root, 'profile'), TEST_ROOTS)
  await extensions.addSource(repository)
  const entry = (await extensions.sources())[0]!.entries[0]!
  expect(await extensions.install(entry.id, () => {})).toBe(true)
  await extensions.setEnabled(entry.id, true)
  const manifest = JSON.parse(await readFile(join((await extensions.pluginDirs())[0]!, '.claude-plugin/plugin.json'), 'utf8'))
  const requests: unknown[] = [], messages: EngineMessage[] = []
  const server = createServer(async (req, res) => {
    if (!req.url?.startsWith('/v1/messages')) { res.writeHead(404).end(); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    requests.push(JSON.parse(raw))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const event = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
    event('message_start', { type: 'message_start', message: { id: `message-${requests.length}`, type: 'message', role: 'assistant', model: 'fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } })
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Skill received.' } })
    event('content_block_stop', { type: 'content_block_stop', index: 0 })
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
    event('message_stop', { type: 'message_stop' }); res.end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const engine = new Engine({ cwd: root, configDir: testConfig(join(root, 'engine')), ...TEST_ROOTS,
    settings: { ...DEFAULT_SESSION_SETTINGS, tools: [], permissionMode: 'dontAsk' },
    pluginDirs: () => extensions.pluginDirs(),
    extraEnv: async () => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'fixture', ANTHROPIC_AUTH_TOKEN: 'local-fixture' }),
  })
  engine.on('message', message => messages.push(message))
  const turn = async (prompt: string) => {
    const end = once(engine, 'turn-end')
    let timer: ReturnType<typeof setTimeout> | undefined
    await engine.send(prompt)
    await Promise.race([end, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Skill engine timeout')), 20000) })]).finally(() => clearTimeout(timer))
  }
  try {
    await turn(`/${manifest.name}:sample`)
    expect(JSON.stringify(requests)).toContain('CATALOGUE_SKILL_LOADED')
    const initialized = messages.filter(message => message.type === 'system' && message.subtype === 'init')
    expect(JSON.stringify(initialized)).toContain(`${manifest.name}:sample`)
    await extensions.setEnabled(entry.id, false)
    messages.length = 0
    await turn('Reply briefly.')
    expect(JSON.stringify(messages.filter(message => message.type === 'system' && message.subtype === 'init'))).not.toContain(`${manifest.name}:sample`)
    expect(messages.some(message => message.type === 'result' && !message.is_error)).toBe(true)
  } finally { engine.stop(); server.closeAllConnections(); server.close() }
}, 75000)
