import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { EngineManager } from '../engine/engineManager.js'
import type { Engine } from '../engine/engine.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { SessionOrigins } from './sessionOrigins.js'
import type { SessionOrigin } from '../../shared/sessionOrigin.js'
import { listProjects, setProjectsRoot } from '../workspace/projects.js'
import { mergeSessionProjects } from '../../renderer/state/sessions.js'

const origin: SessionOrigin = { kind: 'routine', routineId: 'daily-report', cron: '0 9 * * *', firedAt: 1789372800000 }

class FakeEngine extends EventEmitter {
  isBusy = false
  currentSessionId = 'transcript-1'
  async send() {
    this.emit('message', { type: 'system', subtype: 'init', session_id: this.currentSessionId })
  }
  stop() {}
  forkOnNextTurn() {}
}

test('routine provenance reaches live history, survives restart, and is not inherited by a manual fork', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sample-origins-'))
  const cwd = join(root, 'project')
  const storePath = join(root, 'origins')
  const store = new SessionOrigins(storePath)
  const manager = new EngineManager(() => new FakeEngine() as unknown as Engine, store)
  const publications: unknown[] = []
  manager.on('session', snapshot => publications.push(snapshot.origin))
  let resumed: EngineManager | undefined
  try {
    const session = manager.create(cwd, DEFAULT_SESSION_SETTINGS, undefined, origin)
    await manager.send(session.id, 'Rapport du jour', 'Rapport du jour')
    expect(publications[0]).toEqual(origin)
    expect(manager.get(session.id).state.status.sessionId).toBe('transcript-1')
    expect(mergeSessionProjects([], manager.list())[0]?.sessions[0]?.origin).toEqual(origin)
    expect(manager.fork(session.id).origin).toBeUndefined()
    expect(manager.create(cwd, DEFAULT_SESSION_SETTINGS).origin).toBeUndefined()
    manager.stopAll()

    const reopened = new SessionOrigins(storePath)
    expect(reopened.read(cwd, 'transcript-1')).toEqual(origin)
    expect(reopened.read(join(root, 'other-project'), 'transcript-1')).toBeUndefined()
    resumed = new EngineManager(() => new FakeEngine() as unknown as Engine, reopened)
    expect(resumed.resume(cwd, 'transcript-1', DEFAULT_SESSION_SETTINGS, []).origin).toEqual(origin)
    expect(resumed.resume(cwd, 'manual-transcript', DEFAULT_SESSION_SETTINGS, []).origin).toBeUndefined()

    const projects = join(root, 'projects')
    const dir = join(projects, 'encoded-project')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'transcript-1.jsonl'), JSON.stringify({ type: 'user', cwd, message: { content: 'Rapport du jour' } }) + '\n')
    setProjectsRoot(projects)
    const history = await listProjects(reopened)
    expect(history[0]?.sessions[0]?.origin).toEqual(origin)
    expect(history[0]?.sessions[0]?.title).toBe('Rapport du jour')
  } finally { manager.stopAll(); resumed?.stopAll(); setProjectsRoot(join(homedir(), '.claude', 'projects')); rmSync(root, { recursive: true, force: true }) }
})

test('invalid or missing metadata does not prevent opening older conversations', () => {
  const root = mkdtempSync(join(tmpdir(), 'sample-origins-'))
  try {
    const store = new SessionOrigins(root)
    expect(store.read('/project', 'missing')).toBeUndefined()
    store.write('/project', '../untrusted-id', origin)
    expect(readdirSync(root)).toHaveLength(1)
    const file = join(root, readdirSync(root)[0]!)
    for (const content of ['{bad json', JSON.stringify({ ...origin, firedAt: 'yesterday' }), JSON.stringify({ ...origin, firedAt: 1e20 })]) {
      writeFileSync(file, content)
      expect(store.read('/project', '../untrusted-id')).toBeUndefined()
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('persistence failure is reported while live provenance and the turn remain available', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sample-origins-'))
  const path = join(root, 'not-a-directory')
  writeFileSync(path, 'file')
  const manager = new EngineManager(() => new FakeEngine() as unknown as Engine, new SessionOrigins(path))
  const failures: unknown[] = []
  manager.on('origin-error', error => failures.push(error))
  try {
    const session = manager.create(root, DEFAULT_SESSION_SETTINGS, undefined, origin)
    await manager.send(session.id, 'hello', 'hello')
    expect(failures).toHaveLength(1)
    expect(manager.get(session.id).origin).toEqual(origin)
  } finally { manager.stopAll(); rmSync(root, { recursive: true, force: true }) }
})
