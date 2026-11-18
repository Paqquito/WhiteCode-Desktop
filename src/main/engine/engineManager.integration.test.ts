import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { Worktrees } from '../vcs/worktrees.js'
import { readTranscript, setProjectsRoot } from '../session/sessions.js'
import { gitSummary } from '../vcs/git.js'
import { readDirectory, writeFileContent } from '../workspace/files.js'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Engine } from './engine.js'
import { EngineManager } from './engineManager.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

async function until(predicate: () => boolean, manager: EngineManager) {
  const deadline = Date.now() + 12000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timeout: ${JSON.stringify(manager.list().map(s => s.state))}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('two real CLIs stream concurrently: resuming and cancelling A leaves B alive, then A can run again', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-multi-session-'))
  const aCwd = join(directory, 'a'), bCwd = join(directory, 'b')
  await mkdir(aCwd)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: aCwd, windowsHide: true, encoding: 'utf8' })
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
  await writeFile(join(aCwd, 'note.txt'), 'committed')
  git('add', '.'); git('commit', '-m', 'initial')
  const registry = join(directory, 'worktrees')
  const trees = new Worktrees(registry)
  const tree = await trees.create(aCwd, { path: bCwd, branch: 'session-b', base: 'HEAD', existingBranch: false })
  const responses = new Map<string, ServerResponse>()
  const closed = new Set<string>()
  const requests: Array<{ model: string; body: string }> = []
  const sse = (response: ServerResponse, type: string, value: unknown) => response.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
  const delta = (response: ServerResponse, text: string) => sse(response, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  const finish = (response: ServerResponse) => {
    sse(response, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(response, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 6 } })
    sse(response, 'message_stop', { type: 'message_stop' })
    response.end()
  }
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    if (!req.url?.split('?')[0]?.endsWith('/messages')) { res.writeHead(404).end(); return }
    const body = JSON.parse(raw)
    const model = String(body.model)
    requests.push({ model, body: raw })
    responses.set(model, res)
    res.once('close', () => closed.add(model))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    sse(res, 'message_start', { type: 'message_start', message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    delta(res, `Only ${model}. `)
    if (requests.length > 2) finish(res)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const newManager = () => new EngineManager(options => new Engine({ ...options, ...TEST_ROOTS, configDir: testConfig(join(directory, 'config')),
    extraEnv: async (_effort, model) => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: model!, ANTHROPIC_AUTH_TOKEN: 'local-test' }),
  }))
  let manager = newManager()
  try {
    const a = manager.create(aCwd, { ...DEFAULT_SESSION_SETTINGS, model: 'model-a', tools: [] })
    const b = manager.create(bCwd, { ...DEFAULT_SESSION_SETTINGS, model: 'model-b', tools: [] }, tree)
    expect(await writeFileContent(bCwd, join(bCwd, 'note.txt'), 'only worktree')).toMatchObject({ ok: true })
    expect(await readFile(join(aCwd, 'note.txt'), 'utf8')).toBe('committed')
    expect((await readDirectory(bCwd)).some(f => f.name === 'note.txt')).toBe(true)
    expect(await gitSummary(bCwd)).toMatchObject({ available: true, branch: 'session-b', files: [{ path: 'note.txt' }] })
    expect(await gitSummary(aCwd)).toMatchObject({ available: true, files: [] })
    await Promise.all([manager.send(a.id, 'ALPHA_TEST', 'ALPHA_TEST'), manager.send(b.id, 'BETA_TEST', 'BETA_TEST')])
    await until(() => responses.size === 2 && manager.list().every(s => s.state.entries.some(e => e.kind === 'assistant')), manager)
    expect(manager.list().every(s => s.state.status.busy)).toBe(true)
    const persistedA = manager.get(a.id).state.status.sessionId!
    expect(persistedA).toBeTruthy()
    expect(manager.resume(aCwd, persistedA, DEFAULT_SESSION_SETTINGS, []).id).toBe(a.id)
    expect(manager.get(a.id).state.status.sessionId).not.toBe(manager.get(b.id).state.status.sessionId)
    expect(JSON.stringify(manager.get(a.id).state)).not.toContain('Only model-b')
    expect(JSON.stringify(manager.get(b.id).state)).not.toContain('ALPHA_TEST')
    expect(requests.find(r => r.model === 'model-a')!.body).toContain(aCwd.replace(/\\/g, '\\\\'))
    expect(requests.find(r => r.model === 'model-b')!.body).toContain(bCwd.replace(/\\/g, '\\\\'))
    manager.interrupt(a.id)
    await until(() => closed.has('model-a') && !manager.get(a.id).state.status.busy, manager)
    expect(closed.has('model-b')).toBe(false)
    expect(manager.get(b.id).state.status.busy).toBe(true)
    expect(manager.get(a.id).attention.phase).toBe('interrupted')
    expect(manager.get(b.id).attention.phase).toBe('working')
    delta(responses.get('model-b')!, 'Still running after A stopped.')
    finish(responses.get('model-b')!)
    await until(() => !manager.get(b.id).state.status.busy, manager)
    expect(JSON.stringify(manager.get(b.id).state)).toContain('Still running after A stopped.')
    expect(manager.get(b.id).attention.phase).toBe('done')
    expect(manager.get(b.id).attention.unread).toBe(true)
    await manager.send(a.id, 'RESUME_ALPHA', 'RESUME_ALPHA')
    await until(() => requests.length === 3 && !manager.get(a.id).state.status.busy, manager)
    expect(manager.get(a.id).state.status.sessionId).toBe(persistedA)
    expect(requests[2]!.body).toContain('ALPHA_TEST')
    expect(requests[2]!.body).not.toContain('BETA_TEST')
    const persistedB = manager.get(b.id).state.status.sessionId!
    await expect(trees.remove(tree.id, manager.list().map(s => s.cwd))).rejects.toThrow('utilisé')
    manager.stopAll()
    manager = newManager()
    setProjectsRoot(join(directory, 'config', 'sessions'))
    const savedTree = (await new Worktrees(registry).list())[0]!
    const entries = await readTranscript(savedTree.path, persistedB)
    const resumed = manager.resume(savedTree.path, persistedB, b.settings, entries, savedTree)
    expect(resumed.worktree).toEqual(tree)
    expect(JSON.stringify(resumed.state)).toContain('BETA_TEST')
    await manager.send(resumed.id, 'AFTER_RESTART', 'AFTER_RESTART')
    await until(() => requests.length === 4 && !manager.get(resumed.id).state.status.busy, manager)
    expect(requests[3]!.body).toContain('BETA_TEST')
    expect(requests[3]!.body).not.toContain('ALPHA_TEST')
    expect(manager.get(resumed.id).state.status.sessionId).toBe(persistedB)
  } finally {
    manager.stopAll()
    server.closeAllConnections()
    server.close()
  }
}, 35000)
