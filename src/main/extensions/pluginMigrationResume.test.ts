import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Extensions } from './plugins.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

const requests = async () => [{ name: 'fixture-tickets', enabled: true }]

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'plugin-migration-resume-'))
  const repository = join(root, 'catalogue')
  await mkdir(repository)
  const git = (...args: string[]) => execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe', windowsHide: true })
  git('init', '--template=')
  await cp(new URL('./fixtures/tickets/', import.meta.url), join(repository, 'plugins/tickets'), { recursive: true })
  await mkdir(join(repository, '.claude-plugin'))
  await writeFile(join(repository, '.claude-plugin/marketplace.json'), JSON.stringify({
    name: 'resume-fixture', owner: { name: 'Fixture' }, plugins: [{ name: 'fixture-tickets', source: './plugins/tickets' }],
  }))
  git('add', '.')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture')
  return { root, profile: join(root, 'profile'), official: { repository, ref: 'HEAD' } }
}

test('a migration resumes its own installation after interruption before activation', async () => {
  const f = await fixture()
  try {
    const extensions = new Extensions(f.profile, TEST_ROOTS, requests)
    const install = extensions.install.bind(extensions)
    let interrupted = false
    extensions.install = async (...args) => {
      const installed = await install(...args)
      if (installed && !interrupted) { interrupted = true; throw new Error('Interruption simulée après installation, avant activation.') }
      return installed
    }
    await extensions.bootstrap(() => {}, false, f.official)
    expect((await extensions.catalogueStatus()).error).toContain('Interruption simulée')
    expect((await extensions.list()).find(entry => entry.name === 'fixture-tickets')).toMatchObject({ installed: true, enabled: false })

    const resumed = new Extensions(f.profile, TEST_ROOTS, requests)
    await resumed.bootstrap(() => {}, false, f.official)
    expect((await resumed.list()).find(entry => entry.name === 'fixture-tickets')).toMatchObject({ installed: true, enabled: true })
    expect((await resumed.catalogueStatus()).error).toBeUndefined()
  } finally { await rm(f.root, { recursive: true, force: true }) }
}, 120000)

test('a migration preserves an earlier manual installation that the user left disabled', async () => {
  const f = await fixture()
  try {
    const manual = new Extensions(f.profile, TEST_ROOTS)
    await manual.bootstrap(() => {}, false, f.official)
    const entry = (await manual.list()).find(item => item.name === 'fixture-tickets')!
    expect(await manual.install(entry.id, () => {})).toBe(true)
    await manual.setEnabled(entry.id, false)

    const migrated = new Extensions(f.profile, TEST_ROOTS, requests)
    await migrated.bootstrap(() => {}, false, f.official)
    expect((await migrated.list()).find(item => item.id === entry.id)).toMatchObject({ installed: true, enabled: false })
    expect((await migrated.catalogueStatus()).error).toBeUndefined()
    await new Extensions(f.profile, TEST_ROOTS, requests).bootstrap(() => {}, false, f.official)
    expect((await new Extensions(f.profile, TEST_ROOTS).list()).find(item => item.id === entry.id)?.enabled).toBe(false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
}, 120000)
