import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Engine, type EngineOptions } from './engine.js'

const environment = {
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000',
  ANTHROPIC_MODEL: 'cancellation-test',
}

// 1500 ms suffisaient a lancer un vrai CLI sur une machine au repos, pas sur
// une machine chargee. Les harnais voisins accordent 6 a 15 s ; s'aligner evite
// des echecs qui ne disent rien du produit.
async function until(predicate: () => boolean, milliseconds = 6000): Promise<void> {
  const deadline = Date.now() + milliseconds
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for engine state')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function fixture(extra: Partial<EngineOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sample-engine-cancel-'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist', 'cli.js'), `
    const fs = require('node:fs');
    const readline = require('node:readline');
    fs.writeFileSync('args.json', JSON.stringify(process.argv));
    fs.appendFileSync('pids.txt', process.pid + '\\n');
    setTimeout(() => process.exit(0), 10000);
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const message = JSON.parse(line);
      if (message.type === 'user') {
        const label = message.content;
        fs.appendFileSync('started.txt', label + '\\n');
        process.stdout.write(JSON.stringify({type:'session', sessionId:label, model:'cancellation-test', tools:[], cwd:process.cwd(), permissionMode:'ask'}) + '\\n');
      }
      if (message.type === 'control_request' && message.request === 'cancel_turn') {
        fs.writeFileSync('interrupted.txt', 'received');
        // Deliberately ignore cancellation: exercise the desktop fallback.
      }
    });
  `)
  const engine = new Engine({ appRoot: root, engineRoot: root, cwd: root, configDir: testConfig(root),
    distribution: { product: 'Fixture', cli: 'fixture', slug: 'fixture', envPrefix: 'FIXTURE_', urlScheme: 'fixture', instructionsFile: 'fixture.instructions.md', bundleId: 'test.fixture' },
    backendCommand: { file: process.execPath, args: [join(root, 'dist', 'cli.js')] },
    extraEnv: async () => environment, ...extra })
  let ends = 0
  engine.on('turn-end', () => { ends++ })
  return {
    root, engine, ends: () => ends,
    async cleanup() {
      engine.stop()
      for (const pid of (await readFile(join(root, 'pids.txt'), 'utf8').catch(() => '')).trim().split('\n')) {
        if (pid) try { process.kill(Number(pid)) } catch { /* Already exited. */ }
      }
    },
  }
}

test('a mode selected during provider startup is the only mode passed to the child', async () => {
  let ready!: (value: Record<string, string>) => void
  let preparing = false
  const gate = new Promise<Record<string, string>>(resolve => { ready = resolve })
  const f = await fixture({ extraEnv: async () => { preparing = true; return gate } })
  const sending = f.engine.send('latest-mode')
  try {
    await until(() => preparing)
    f.engine.updateSettings({ ...f.engine.currentSettings, permissionMode: 'dontAsk' })
    ready(environment)
    await sending
    await until(() => f.engine.currentSessionId === 'latest-mode')
    const args: string[] = JSON.parse(await readFile(join(f.root, 'args.json'), 'utf8'))
    expect(args.filter(arg => arg === '--approval-mode')).toHaveLength(1)
    expect(args[args.indexOf('--approval-mode') + 1]).toBe('no_prompt')
  } finally { ready(environment); await sending; await f.cleanup() }
})

test('interrupt during provider startup releases the turn and prevents a late launch', async () => {
  let resolveEnvironment!: (value: Record<string, string>) => void
  let entered = false
  const pendingEnvironment = new Promise<Record<string, string>>(resolve => { resolveEnvironment = resolve })
  const f = await fixture({ extraEnv: async () => {
    if (!entered) { entered = true; return pendingEnvironment }
    return environment
  } })
  const firstSend = f.engine.send('cancelled-startup')
  try {
    await until(() => entered)
    f.engine.interrupt()
    expect(f.engine.isBusy).toBe(false)
    expect(f.ends()).toBe(1)
    await f.engine.send('replacement')
    await until(() => f.engine.currentSessionId === 'replacement')
    resolveEnvironment(environment)
    await firstSend
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(await readFile(join(f.root, 'started.txt'), 'utf8')).toBe('replacement\n')
    expect(f.engine.isBusy).toBe(true)
    expect(f.engine.currentSessionId).toBe('replacement')
    expect(f.ends()).toBe(1)
  } finally {
    resolveEnvironment(environment)
    await firstSend
    await f.cleanup()
  }
})

test('interrupt terminates an unresponsive child within a bounded delay', async () => {
  const f = await fixture()
  try {
    await f.engine.send('unresponsive')
    await until(() => f.engine.currentSessionId === 'unresponsive')
    f.engine.interrupt()
    await until(() => !f.engine.isBusy, 8000)
    expect(await readFile(join(f.root, 'interrupted.txt'), 'utf8')).toBe('received')
    expect(f.ends()).toBe(1)
    await f.engine.send('after-interruption')
    await until(() => f.engine.currentSessionId === 'after-interruption')
    expect(f.engine.isBusy).toBe(true)
  } finally { await f.cleanup() }
}, 15000)

test('the close event of a stopped child cannot finish or detach its replacement', async () => {
  const f = await fixture()
  try {
    await f.engine.send('old-session')
    await until(() => f.engine.currentSessionId === 'old-session')
    f.engine.stop()
    const endsBeforeReplacement = f.ends()
    await f.engine.send('new-session')
    await until(() => f.engine.currentSessionId === 'new-session')
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(f.engine.isBusy).toBe(true)
    expect(f.ends()).toBe(endsBeforeReplacement)
    f.engine.interrupt()
    await until(() => !f.engine.isBusy, 8000)
  } finally { await f.cleanup() }
}, 15000)
