import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Engine } from './engine.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'

test('project instructions reach the engine as a single literal argument', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-instructions-'))
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'dist/cli.js'), `require('fs').writeFileSync('args.json', JSON.stringify(process.argv)); process.stdin.once('data', () => process.exit(0));`)
  const instructions = 'Répondre en français.\nGarder les littéraux `code`, $(command) et "texte".'
  const engine = new Engine({ cwd: root, appRoot: root, engineRoot: root, configDir: testConfig(root),
    distribution: { product: 'Fixture', cli: 'fixture', slug: 'fixture', envPrefix: 'FIXTURE_', urlScheme: 'fixture', instructionsFile: 'fixture.instructions.md', bundleId: 'test.fixture' },
    backendCommand: { file: process.execPath, args: [join(root, 'dist', 'cli.js')] },
    settings: { ...DEFAULT_SESSION_SETTINGS, projectInstructions: instructions }, extraEnv: async () => ({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000', ANTHROPIC_MODEL: 'test-route' }) })
  try {
    const end = once(engine, 'turn-end')
    await engine.send('test'); await end
    const args = JSON.parse(await readFile(join(root, 'args.json'), 'utf8')) as string[]
    expect(args[args.indexOf('--add-system-instructions') + 1]).toBe(instructions)
  } finally { engine.stop(); await rm(root, { recursive: true, force: true }) }
})
