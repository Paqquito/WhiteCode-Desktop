import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Extensions } from './plugins.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { stdio: 'pipe', windowsHide: true })

test('configured plugins migrate once, keep an existing disabled choice and retry missing catalogue entries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'plugin-migration-'))
  try {
    const repository = join(root, 'catalogue'); await mkdir(repository)
    git(repository, 'init', '--template=')
    await cp(new URL('./fixtures/tickets/', import.meta.url), join(repository, 'plugins/tickets'), { recursive: true })
    await mkdir(join(repository, '.claude-plugin'))
    const catalog = { name: 'fixture', owner: { name: 'Fixture' }, plugins: [{ name: 'fixture-tickets', source: './plugins/tickets' }] }
    const commit = () => { git(repository, 'add', '.'); git(repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture') }
    await writeFile(join(repository, '.claude-plugin/marketplace.json'), JSON.stringify(catalog)); commit()
    const official = { repository, ref: 'HEAD' }, requests = async () => [{ name: 'fixture-tickets', enabled: true }]
    const profile = join(root, 'profile'), extensions = new Extensions(profile, TEST_ROOTS, requests)
    await extensions.bootstrap(() => {}, false, official)
    const installed = (await extensions.list()).find(item => item.name === 'fixture-tickets')!
    expect(installed).toMatchObject({ installed: true, enabled: true })
    await extensions.setEnabled(installed.id, false)
    await new Extensions(profile, TEST_ROOTS, requests).bootstrap(() => {}, false, official)
    expect((await new Extensions(profile, TEST_ROOTS).list()).find(item => item.id === installed.id)?.enabled).toBe(false)
    // Désinstaller reste un choix définitif, même si une ancienne clé existe encore.
    await extensions.remove(installed.id)
    const restarted = new Extensions(profile, TEST_ROOTS, requests)
    await restarted.bootstrap(() => {}, false, official)
    expect((await restarted.list()).find(item => item.id === installed.id)).toMatchObject({ installed: false, enabled: false })
    expect(await restarted.connectors()).toEqual([])

    const fresh = new Extensions(join(root, 'fresh'), TEST_ROOTS)
    await fresh.bootstrap(() => {}, false, official)
    expect((await fresh.list()).find(item => item.name === 'fixture-tickets')?.installed).toBe(false)

    const disabled = new Extensions(join(root, 'disabled'), TEST_ROOTS, async () => [{ name: 'fixture-tickets', enabled: false }])
    await disabled.bootstrap(() => {}, false, official)
    expect((await disabled.list()).find(item => item.name === 'fixture-tickets')).toMatchObject({ installed: true, enabled: false })

    await writeFile(join(repository, '.claude-plugin/marketplace.json'), JSON.stringify({ ...catalog, plugins: [] })); commit()
    const retrying = new Extensions(join(root, 'retry'), TEST_ROOTS, requests)
    await retrying.bootstrap(() => {}, false, official)
    expect((await retrying.catalogueStatus()).error).toContain('fixture-tickets')
    await writeFile(join(repository, '.claude-plugin/marketplace.json'), JSON.stringify(catalog)); commit()
    await retrying.refreshSource((await retrying.sources())[0]!.id)
    await retrying.bootstrap(() => {}, false, official)
    expect((await retrying.list()).find(item => item.name === 'fixture-tickets')?.enabled).toBe(true)
    expect((await retrying.catalogueStatus()).error).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
}, 120000)
