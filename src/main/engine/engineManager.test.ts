import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineManager } from './engineManager.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import type { Engine, EngineOptions } from './engine.js'
import { ChatWorkspaces } from '../workspace/chats.js'

class FakeEngine extends EventEmitter {
  isBusy = false
  currentSessionId: string | null
  permissions: unknown[] = []
  forked = false
  forkSource?: string
  constructor(public options: EngineOptions) { super(); this.currentSessionId = options.resumeSessionId ?? null }
  async send() { this.isBusy = true }
  interrupt() { this.stop() }
  stop() { this.isBusy = false; this.emit('turn-end') }
  updateSettings(next: EngineOptions['settings']) { this.options.settings = next }
  respondToPermission(...args: unknown[]) { this.permissions.push(args) }
  forkOnNextTurn(source?: string) { this.forked = true; this.forkSource = source }
}

function fixture(chats?: ChatWorkspaces) {
  const engines: FakeEngine[] = []
  const manager = new EngineManager((options) => {
    const engine = new FakeEngine({ appRoot: '.', engineRoot: '.', configDir: '.', ...options })
    engines.push(engine)
    return engine as unknown as Engine
  }, undefined, chats)
  return { manager, engines }
}

test('standalone chats keep a distinct workspace across creation, resume and fork', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sample-chat-workspaces-'))
  const chats = new ChatWorkspaces(join(directory, 'chats'))
  const { manager, engines } = fixture(chats)
  try {
    const first = manager.createChat({ ...DEFAULT_SESSION_SETTINGS, extraDirs: [directory] })
    const second = manager.createChat(DEFAULT_SESSION_SETTINGS)
    expect(first.cwd).not.toBe(second.cwd)
    expect(first).toMatchObject({ chat: true, settings: { extraDirs: [] } })
    const project = manager.create(directory, DEFAULT_SESSION_SETTINGS)
    expect(project).not.toHaveProperty('chat')
    engines[0]!.currentSessionId = 'native-session'
    const fork = manager.fork(first.id)
    expect(fork).toMatchObject({ chat: true })
    expect(fork.cwd).not.toBe(first.cwd)
    expect(engines.at(-1)?.forkSource).toBe(first.cwd)
    const reopened = fixture(chats).manager
    try { expect(reopened.resume(first.cwd, 'native-session', DEFAULT_SESSION_SETTINGS, [])).toMatchObject({ chat: true, cwd: first.cwd }) }
    finally { reopened.stopAll() }
  } finally { manager.stopAll() }
})

test('sessions retain independent cwd, settings, streams and interruption', async () => {
  const { manager, engines } = fixture()
  try {
    const a = manager.create('C:/project-a', DEFAULT_SESSION_SETTINGS)
    const b = manager.create('C:/project-b', { ...DEFAULT_SESSION_SETTINGS, model: 'model-b' })
    await Promise.all([manager.send(a.id, 'alpha', 'alpha'), manager.send(b.id, 'beta', 'beta')])
    expect(engines.map(e => e.options.cwd)).toEqual(['C:/project-a', 'C:/project-b'])
    expect(engines[1]!.options.settings!.model).toBe('model-b')
    expect(() => manager.send(a.id, 'duplicate', 'duplicate')).toThrow()
    engines[1]!.emit('notice', { tone: 'info', text: 'only beta' })
    expect(JSON.stringify(manager.get(a.id).state)).not.toContain('only beta')
    expect(JSON.stringify(manager.get(b.id).state)).toContain('only beta')
    manager.interrupt(a.id)
    expect(manager.get(a.id).state.status.busy).toBe(false)
    expect(manager.get(b.id).state.status.busy).toBe(true)
    expect(manager.get(b.id).state.entries[0]).toMatchObject({ kind: 'user', text: 'beta' })
    manager.updateSettings(a.id, { ...DEFAULT_SESSION_SETTINGS, effort: 'low' })
    expect(manager.get(b.id).settings.effort).toBe(DEFAULT_SESSION_SETTINGS.effort)
  } finally { manager.stopAll() }
})

test('resuming a managed session preserves live state and does not create a second engine', () => {
  const { manager, engines } = fixture()
  try {
    const a = manager.resume('C:/project', 'saved-id', DEFAULT_SESSION_SETTINGS, [{ kind: 'user', text: 'history' }])
    engines[0]!.emit('notice', { tone: 'info', text: 'live state' })
    const resumed = manager.resume('C:/project', 'saved-id', DEFAULT_SESSION_SETTINGS, [])
    expect(resumed.id).toBe(a.id)
    expect(engines).toHaveLength(1)
    expect(JSON.stringify(resumed.state)).toContain('live state')
    expect(manager.list()).toHaveLength(1)
    expect(() => manager.get('missing')).toThrow()
  } finally { manager.stopAll() }
})

test('reading a saved conversation preserves recency until a new prompt is submitted', async () => {
  const { manager } = fixture()
  try {
    const session = manager.resume('C:/history', 'saved', DEFAULT_SESSION_SETTINGS, [{ kind: 'user', text: 'Old prompt' }], undefined, 1000)
    expect(session.updatedAt).toBe(1000)
    manager.setViewed(session.id)
    manager.updateSettings(session.id, { ...DEFAULT_SESSION_SETTINGS, effort: 'low' })
    expect(manager.get(session.id).updatedAt).toBe(1000)
    await manager.send(session.id, 'New prompt', 'New prompt')
    expect(manager.get(session.id).updatedAt).toBeGreaterThan(1000)
  } finally { manager.stopAll() }
})

test('a rejected mode publishes the effective settings only to its own session', () => {
  const { manager, engines } = fixture()
  try {
    const a = manager.create('C:/a', DEFAULT_SESSION_SETTINGS)
    const b = manager.create('C:/b', DEFAULT_SESSION_SETTINGS)
    manager.updateSettings(a.id, { ...DEFAULT_SESSION_SETTINGS, permissionMode: 'bypassPermissions' })
    const revision = manager.get(a.id).revision
    engines[0]!.emit('settings', { ...DEFAULT_SESSION_SETTINGS, permissionMode: 'default' })
    expect(manager.get(a.id).settings.permissionMode).toBe('default')
    expect(manager.get(a.id).revision).toBeGreaterThan(revision)
    expect(manager.get(b.id).revision).toBe(b.revision)
  } finally { manager.stopAll() }
})

test('permission decisions are checked against their own session, including late decisions', () => {
  const { manager, engines } = fixture()
  try {
    const a = manager.create('C:/a', DEFAULT_SESSION_SETTINGS)
    const b = manager.create('C:/b', DEFAULT_SESSION_SETTINGS)
    void manager.send(a.id, 'a', 'a')
    void manager.send(b.id, 'b', 'b')
    for (const engine of engines) engine.emit('message', {
      type: 'control_request', request_id: 'same-id',
      request: { subtype: 'can_use_tool', tool_name: 'write_file', input: { path: 'file' }, tool_use_id: 'tool' },
    })
    manager.permission(a.id, 'same-id', { behavior: 'deny', message: 'no' })
    expect(engines[0]!.permissions).toHaveLength(1)
    expect(engines[1]!.permissions).toHaveLength(0)
    expect(manager.get(b.id).state.pending?.requestId).toBe('same-id')
    manager.interrupt(b.id)
    manager.permission(b.id, 'same-id', { behavior: 'allow', updatedInput: {} })
    expect(engines[1]!.permissions).toHaveLength(0)
  } finally { manager.stopAll() }
})

test('fork creates an independent engine and does not replace the source transcript mapping', () => {
  const { manager, engines } = fixture()
  try {
    const worktree = { id: 'tree-a', path: 'C:/a', root: 'C:/repo', branch: 'session-a' }
    const source = manager.resume('C:/a', 'saved-a', DEFAULT_SESSION_SETTINGS, [{ kind: 'user', text: 'original history' }], worktree)
    const fork = manager.fork(source.id)
    expect(fork.worktree).toEqual(worktree)
    expect(fork.id).not.toBe(source.id)
    expect(fork.state.status.sessionId).toBeNull()
    expect(fork.state.entries).toEqual(source.state.entries)
    expect(engines[1]!.forked).toBe(true)
    expect(engines[1]!.options.resumeSessionId).toBe('saved-a')
    expect(manager.find('C:/a', 'saved-a')!.id).toBe(source.id)
    void manager.send(fork.id, 'fork input', 'fork input')
    expect(() => manager.fork(fork.id)).toThrow()
    expect(manager.get(source.id).state.entries).toHaveLength(1)
  } finally { manager.stopAll() }
})

test('result does not release a still-running process, and shutdown stops every managed engine', () => {
  const { manager, engines } = fixture()
  const a = manager.create('C:/a', DEFAULT_SESSION_SETTINGS)
  const b = manager.create('C:/b', DEFAULT_SESSION_SETTINGS)
  void manager.send(a.id, 'a', 'a')
  void manager.send(b.id, 'b', 'b')
  engines[0]!.emit('message', { type: 'result', subtype: 'success', is_error: false })
  expect(manager.get(a.id).state.status.busy).toBe(true)
  expect(() => manager.send(a.id, 'too early', 'too early')).toThrow()
  manager.stopAll()
  expect(engines.every(engine => !engine.isBusy)).toBe(true)
  expect(manager.list()).toHaveLength(0)
})

test('late window focus after session cleanup is harmless and does not hide unread activity', async () => {
  const { manager, engines } = fixture()
  const old = manager.create('C:/project', DEFAULT_SESSION_SETTINGS)
  manager.setViewed(old.id)
  manager.stopAll()
  expect(() => manager.setViewed(old.id)).not.toThrow()
  const next = manager.create('C:/project', DEFAULT_SESSION_SETTINGS)
  await manager.send(next.id, 'new turn', 'new turn')
  engines[1]!.emit('message', { type: 'result', subtype: 'success', is_error: false })
  engines[1]!.stop()
  expect(manager.get(next.id).attention.unread).toBe(true)
  expect(() => manager.get(old.id)).toThrow('Session inconnue')
  manager.stopAll()
})

test('stopping provider turns preserves conversation identity, history and listeners for retry', async () => {
  const { manager, engines } = fixture()
  try {
    const session = manager.resume('C:/project', 'saved-history', DEFAULT_SESSION_SETTINGS, [{ kind: 'user', text: 'Previous prompt' }])
    manager.setViewed(session.id)
    await manager.send(session.id, 'interrupted prompt', 'interrupted prompt')
    manager.stopTurns()
    expect(engines[0]!.isBusy).toBe(false)
    expect(manager.get(session.id).state.status.busy).toBe(false)
    expect(manager.get(session.id).attention.phase).toBe('interrupted')
    expect(manager.get(session.id).state.status.sessionId).toBe('saved-history')
    expect(manager.get(session.id).state.entries.filter(entry => entry.kind === 'user')).toHaveLength(2)
    expect(() => manager.setViewed(session.id)).not.toThrow()
    await manager.send(session.id, 'retry after connection', 'retry after connection')
    engines[0]!.emit('notice', { tone: 'info', text: 'Same conversation resumed' })
    expect(JSON.stringify(manager.get(session.id).state.entries)).toContain('Same conversation resumed')
    expect(engines).toHaveLength(1)
  } finally { manager.stopAll() }
})

test('attention retains outcomes, unread status and timing independently of navigation', async () => {
  const { manager, engines } = fixture()
  try {
    const a = manager.create('C:/a', DEFAULT_SESSION_SETTINGS)
    const b = manager.create('C:/b', DEFAULT_SESSION_SETTINGS)
    manager.setViewed(b.id)
    await manager.send(a.id, 'a', 'a')
    expect(manager.get(a.id).attention.phase).toBe('working')
    expect(manager.get(a.id).attention.startedAt).toBeNumber()
    engines[0]!.emit('message', { type: 'control_request', request_id: 'permission-a', request: { subtype: 'can_use_tool', tool_name: 'write_file', input: {}, tool_use_id: 'a' } })
    expect(manager.get(a.id).attention.phase).toBe('waiting')
    expect(manager.get(a.id).attention.unread).toBe(true)
    manager.setViewed(a.id)
    expect(manager.get(a.id).attention.unread).toBe(false)
    manager.permission(a.id, 'permission-a', { behavior: 'deny', message: 'test' })
    expect(manager.get(a.id).attention.phase).toBe('working')
    manager.setViewed(b.id)
    engines[0]!.emit('message', { type: 'result', subtype: 'success', is_error: false })
    engines[0]!.stop()
    expect(manager.get(a.id).attention.phase).toBe('done')
    expect(manager.get(a.id).attention.endedAt).toBeNumber()
    expect(manager.get(a.id).attention.unread).toBe(true)
    manager.setViewed(a.id)
    expect(manager.get(a.id).attention.phase).toBe('done')
    expect(manager.get(a.id).attention.unread).toBe(false)
    await manager.send(a.id, 'again', 'again')
    manager.interrupt(a.id)
    expect(manager.get(a.id).attention.phase).toBe('interrupted')
    await manager.send(b.id, 'failure', 'failure')
    engines[1]!.stop()
    expect(manager.get(b.id).attention.phase).toBe('failed')
  } finally { manager.stopAll() }
})

test('busyIn ne retient que les tours en cours du même dossier', async () => {
  const { manager, engines } = fixture()
  try {
    const a = manager.create('C:/projet-a', DEFAULT_SESSION_SETTINGS)
    const b = manager.create('C:/projet-b', DEFAULT_SESSION_SETTINGS)
    expect(manager.busyIn('C:/projet-a')).toEqual([])

    await manager.send(a.id, 'alpha', 'alpha')
    expect(manager.busyIn('C:/projet-a').map(s => s.id)).toEqual([a.id])
    // Un tour ailleurs ne doit pas bloquer une restauration ici.
    expect(manager.busyIn('C:/projet-b')).toEqual([])

    // Deux sessions ouvertes au même endroit écrivent les mêmes fichiers :
    // celle qui reste au repos ne rend pas la restauration sûre pour autant.
    const jumelle = manager.create('C:/projet-a', DEFAULT_SESSION_SETTINGS)
    expect(manager.busyIn('C:/projet-a').map(s => s.id)).toEqual([a.id])
    await manager.send(jumelle.id, 'gamma', 'gamma')
    expect(manager.busyIn('C:/projet-a').map(s => s.id).sort()).toEqual([a.id, jumelle.id].sort())

    // Le chemin est comparé après normalisation, pas caractère à caractère.
    expect(manager.busyIn('C:/projet-a/').length).toBe(2)
    if (process.platform === 'win32') expect(manager.busyIn('c:/PROJET-A').length).toBe(2)

    manager.interrupt(a.id)
    manager.interrupt(jumelle.id)
    expect(manager.busyIn('C:/projet-a')).toEqual([])
    expect(b.id).toBeTruthy()
  } finally { manager.stopAll() }
})

test('routine completion uses persisted transcript identity and distinguishes interruption', async () => {
  const {manager,engines}=fixture()
  try {
    const session=manager.resume('/project','persisted-session',DEFAULT_SESSION_SETTINGS,[])
    const complete=manager.waitForTurnEnd(session.id)
    await manager.send(session.id,'routine','routine')
    manager.interrupt(session.id)
    expect(await complete).toEqual({cancelled:true,failed:false,sessionId:'persisted-session'})
  } finally {manager.stopAll()}
})


test('Git holds the idle workspace without queuing a prompt that could start after Stop', async () => {
  const { manager } = fixture()
  const session = manager.create('C:/project', DEFAULT_SESSION_SETTINGS)
  try {
    let release!: () => void
    const action = manager.withIdleWorkspace(() => new Promise<void>(resolve => { release = resolve }))
    expect(() => manager.send(session.id, 'not submitted', 'not submitted')).toThrow('opération Git')
    expect(manager.get(session.id).state.entries).toHaveLength(0)
    await expect(manager.withIdleWorkspace(async () => {})).rejects.toThrow('opérations en cours')
    manager.interrupt(session.id)
    release(); await action
    expect(manager.get(session.id).state.entries).toHaveLength(0)
    await expect(manager.withIdleWorkspace(async () => { throw new Error('Git failure') })).rejects.toThrow('Git failure')
    await manager.send(session.id, 'explicit retry', 'explicit retry')
    expect(manager.isBusy).toBe(true)
    await expect(manager.withIdleWorkspace(async () => {})).rejects.toThrow('tours ou opérations')
    manager.interrupt(session.id)
    expect(await manager.withIdleWorkspace(async () => 'released')).toBe('released')
  } finally { manager.stopAll() }
})
