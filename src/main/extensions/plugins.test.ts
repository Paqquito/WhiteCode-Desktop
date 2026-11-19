import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Extensions, CATALOG } from './plugins.js'
import { gitReference, repositoryAddress, snapshot } from './pluginRepository.js'
import { discover, pluginPath } from './extensionSources.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { stdio: 'pipe', windowsHide: true }).toString().trim()
async function put(path: string, file: string, value: string | object) {
  const destination = join(path, file)
  await mkdir(join(destination, '..'), { recursive: true })
  await writeFile(destination, typeof value === 'string' ? value : JSON.stringify(value))
}
function commit(path: string) {
  git(path, 'add', '.'); git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture')
  return git(path, 'rev-parse', 'HEAD')
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'fixture-catalogue-'))
  const repository = join(root, 'source'), profile = join(root, 'profile')
  await mkdir(repository); git(repository, 'init', '--template=')
  return { root, repository, profile, extensions: new Extensions(profile, TEST_ROOTS) }
}
const skill = '---\nname: sample\ndescription: Fixture skill\n---\nReturn CATALOGUE_SKILL_LOADED.\n'
const silence = () => {}

test('an installed plugin supplies validated connectors and panels only while enabled', async () => {
  const { root, repository, profile, extensions } = await fixture()
  const runningDesktop = new Extensions(profile, TEST_ROOTS)
  expect(await runningDesktop.pluginDirs()).toEqual([])
  try {
    await cp(new URL('./fixtures/tickets/', import.meta.url), repository, { recursive: true })
    commit(repository)
    await extensions.addSource(repository)
    const entry = (await extensions.sources())[0]!.entries[0]!
    expect(await extensions.install(entry.id, silence)).toBe(true)
    expect(await extensions.connectors()).toEqual([])
    await extensions.setEnabled(entry.id, true)
    expect(await runningDesktop.pluginDirs()).toEqual(await extensions.pluginDirs())
    expect(await runningDesktop.pluginDirs()).toHaveLength(1)
    expect((await extensions.connectors()).map(connector => connector.id)).toEqual(['tickets'])
    expect((await extensions.list()).find(item => item.id === entry.id)?.panel?.title).toBe('Tickets')
    await extensions.setEnabled(entry.id, false)
    expect(await extensions.connectors()).toEqual([])
    await put(repository, 'panel.json', { version: 1, id: 'broken', javascript: 'alert(1)' })
    commit(repository)
    await expect(extensions.refreshSource((await extensions.sources())[0]!.id)).rejects.toThrow()
    expect((await extensions.list()).find(item => item.id === entry.id)?.panel?.id).toBe('tickets')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 60000)

test('native WhiteCode extensions install and validate without a legacy manifest', async () => {
  const { root, repository, extensions } = await fixture()
  try {
    await put(repository, 'extension.json', { name: 'native-fixture', version: '1.0.0', description: 'Native extension', components: { skills: 'skills' } })
    await put(repository, 'skills/sample/definition.md', skill)
    commit(repository)
    await extensions.addSource(repository)
    const entry = (await extensions.sources())[0]!.entries[0]!
    expect(entry.name).toBe('native-fixture')
    expect(await extensions.install(entry.id, silence)).toBe(true)
    await extensions.setEnabled(entry.id, true)
    const installed = (await extensions.pluginDirs())[0]!
    expect(existsSync(join(installed, '.claude-plugin', 'plugin.json'))).toBe(false)
    expect(await extensions.diagnose(entry.id)).toContain('native-fixture:sample')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)

test('versioned install, explicit activation, update rollback and legacy preferences survive restart', async () => {
  const { root, repository, profile, extensions } = await fixture()
  const entry = CATALOG[0]!, original = entry.repository
  try {
    await put(repository, '.claude-plugin/plugin.json', { name: 'fixture', version: '1.0.0' })
    await put(repository, 'skills/sample/SKILL.md', skill)
    const first = commit(repository); git(repository, 'tag', 'v1')
    entry.repository = repository
    expect(await extensions.install(entry.id, silence, 'v1')).toBe(true)
    expect(await extensions.pluginDirs()).toEqual([])
    await extensions.setEnabled(entry.id, true)
    const installed = (await extensions.pluginDirs())[0]!
    expect((await new Extensions(profile, TEST_ROOTS).list()).find(e => e.id === entry.id)?.revision).toBe(first)
    expect(await extensions.diagnose(entry.id)).toContain('Validation réussie')
    await put(repository, '.claude-plugin/plugin.json', { name: 'fixture', version: '2.0.0' }); const second = commit(repository)
    // A pinned tag stays pinned until explicitly changed.
    expect(await extensions.update(entry.id, silence)).toBe(true)
    expect((await extensions.list()).find(e => e.id === entry.id)?.revision).toBe(first)
    let updateFinished = false
    const updating = extensions.update(entry.id, silence, 'HEAD').then(value => { updateFinished = true; return value })
    // Starting a new turn can still read the old immutable version during a download.
    expect(await extensions.pluginDirs()).toHaveLength(1)
    expect(updateFinished).toBe(false)
    expect(await updating).toBe(true)
    const current = (await extensions.pluginDirs())[0]!
    expect(current).not.toBe(installed)
    expect(existsSync(installed)).toBe(true)
    expect((await extensions.list()).find(e => e.id === entry.id)?.revision).toBe(second)
    await put(repository, '.claude-plugin/plugin.json', { name: 'fixture', skills: '../../outside' }); commit(repository)
    const messages: string[] = []
    expect(await extensions.update(entry.id, p => messages.push(p.message))).toBe(false)
    expect(messages.at(-1)).toContain('version précédente est conservée')
    expect(await extensions.pluginDirs()).toEqual([current])
    // A damaged active installation must remain visible and can still be disabled.
    await put(current, '.claude-plugin/plugin.json', { name: 'fixture', version: { invalid: true } })
    const damaged = (await extensions.list()).find(e => e.id === entry.id)!
    expect(damaged.problem).toContain('Version du plugin invalide')
    expect(damaged.enabled).toBe(true)
    expect(await extensions.pluginDirs()).toEqual([])
    await extensions.setEnabled(entry.id, false)
    expect((await extensions.list()).find(e => e.id === entry.id)?.enabled).toBe(false)
    expect(await new Extensions(profile, TEST_ROOTS).pluginDirs()).toEqual([])
    await extensions.remove(entry.id)
    expect(existsSync(installed)).toBe(false)
    expect((await extensions.list()).find(e => e.id === entry.id)?.installed).toBe(false)
    await expect(extensions.remove('../source')).rejects.toThrow()
    await expect(extensions.setEnabled(entry.id, true)).rejects.toThrow()
  } finally { entry.repository = original; await rm(root, { recursive: true, force: true }) }
}, 120000)

test('marketplace discovery, strict:false, refresh, orphaned installs and removal', async () => {
  const { root, repository, profile, extensions } = await fixture()
  try {
    await put(repository, '.claude-plugin/marketplace.json', { name: 'fixture-market', owner: { name: 'Fixture' }, plugins: [
      { name: 'local-plugin', source: './plugins/local' },
      { name: 'inline-plugin', source: './plugins/inline', strict: false, skills: './skills' },
      { name: 'unsupported', source: { source: 'npm', package: 'fixture' } },
    ] })
    await put(repository, 'plugins/local/.claude-plugin/plugin.json', { name: 'local-plugin' })
    await put(repository, 'plugins/inline/skills/sample/SKILL.md', skill)
    const first = commit(repository)
    await extensions.addSource(repository)
    await expect(extensions.addSource(repository)).rejects.toThrow('existe déjà')
    const source = (await extensions.sources())[0]!
    expect(source.commit).toBe(first); expect(source.entries).toHaveLength(3)
    const local = source.entries.find(e => e.name === 'local-plugin')!, inline = source.entries.find(e => e.name === 'inline-plugin')!
    expect(source.entries.find(e => e.name === 'unsupported')?.problem).toContain('non prise en charge')
    expect(await extensions.install(inline.id, silence)).toBe(true)
    await extensions.setEnabled(inline.id, true)
    expect(await extensions.install(local.id, silence)).toBe(true)
    await extensions.setEnabled(local.id, true)
    await expect(extensions.removeSource(source.id)).rejects.toThrow('Désinstallez')
    await put(repository, '.claude-plugin/marketplace.json', { name: 'fixture-market', owner: { name: 'Fixture' }, plugins: [{ name: 'local-plugin', source: './missing' }] }); commit(repository)
    await extensions.refreshSource(source.id)
    expect((await extensions.list()).find(e => e.id === local.id)?.catalogProblem).toContain('introuvable')
    // A broken new catalogue entry must not disable the already validated installation.
    expect(await extensions.pluginDirs()).toHaveLength(2)
    expect((await new Extensions(profile, TEST_ROOTS).list()).find(e => e.id === inline.id)?.installed).toBe(true)
    const saved = await readFile(join(profile, 'extensions.json'), 'utf8')
    await put(repository, '.claude-plugin/marketplace.json', '{}'); commit(repository)
    await expect(extensions.refreshSource(source.id)).rejects.toThrow('Catalogue invalide')
    expect(await readFile(join(profile, 'extensions.json'), 'utf8')).toBe(saved)
    await extensions.remove(local.id); await extensions.remove(inline.id); await extensions.removeSource(source.id)
    expect(await extensions.sources()).toEqual([])
  } finally { await rm(root, { recursive: true, force: true }) }
}, 120000)

test('standalone skills are packaged in the engine format and duplicate plugin names cannot be enabled', async () => {
  const { root, repository, extensions } = await fixture()
  try {
    await put(repository, 'skills/sample/SKILL.md', skill); commit(repository)
    await extensions.addSource(repository)
    const entry = (await extensions.sources())[0]!.entries[0]!
    expect(entry.content).toBe('skill')
    expect(await extensions.install(entry.id, silence)).toBe(true)
    await extensions.setEnabled(entry.id, true)
    const path = (await extensions.pluginDirs())[0]!
    const manifest = JSON.parse(await readFile(join(path, '.claude-plugin/plugin.json'), 'utf8'))
    expect(manifest.skills).toBe('./')
    expect(await extensions.diagnose(entry.id)).toContain('Validation réussie')
    const other = join(root, 'duplicate'); await mkdir(other); git(other, 'init', '--template=')
    await put(other, '.claude-plugin/plugin.json', manifest); await put(other, 'SKILL.md', skill); commit(other)
    await extensions.addSource(other)
    const duplicate = (await extensions.sources())[1]!.entries[0]!
    expect(await extensions.install(duplicate.id, silence)).toBe(true)
    await expect(extensions.setEnabled(duplicate.id, true)).rejects.toThrow('déjà activé')
    // The canonical content validator must include the direct skill path in the wrapper.
    await put(repository, 'skills/sample/SKILL.md', '---\nname: [\n---\nInvalid YAML\n'); commit(repository)
    await extensions.refreshSource((await extensions.sources())[0]!.id)
    const errors: string[] = []
    expect(await extensions.update(entry.id, progress => errors.push(progress.message))).toBe(false)
    expect(errors.at(-1)).toContain('Validation moteur refusée')
    expect(await extensions.pluginDirs()).toEqual([path])
  } finally { await rm(root, { recursive: true, force: true }) }
}, 120000)

test('legacy enabled IDs and clones migrate without changing their files', async () => {
  const { root, repository, profile } = await fixture()
  try {
    await put(repository, '.claude-plugin/plugin.json', { name: 'legacy' }); commit(repository)
    await mkdir(join(profile, 'extensions'), { recursive: true })
    execFileSync('git', ['clone', '--', repository, join(profile, 'extensions/ponytail')], { stdio: 'pipe', windowsHide: true })
    await put(profile, 'extensions.json', ['ponytail'])
    const extensions = new Extensions(profile, TEST_ROOTS)
    expect(await extensions.pluginDirs()).toEqual([join(profile, 'extensions/ponytail')])
    await extensions.setEnabled('ponytail', false)
    expect(await new Extensions(profile, TEST_ROOTS).pluginDirs()).toEqual([])
    expect(existsSync(join(profile, 'extensions/ponytail/.claude-plugin/plugin.json'))).toBe(true)
    expect(JSON.parse(await readFile(join(profile, 'extensions.json'), 'utf8')).version).toBe(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('repository references and paths reject unsafe transports, traversal and symlink trees', async () => {
  expect(repositoryAddress('owner/repo')).toBe('https://github.com/owner/repo.git')
  for (const address of ['ext::run', 'file:///tmp/a', 'https://user:secret@example.test/repo', 'http://example.test/repo']) expect(() => repositoryAddress(address, false)).toThrow()
  for (const ref of ['--upload-pack=evil', 'HEAD~1', '../main', 'main:other']) expect(() => gitReference(ref)).toThrow()
  expect(() => pluginPath(tmpdir(), '../escape')).toThrow()
  const { root, repository } = await fixture()
  try {
    await put(repository, '.claude-plugin/marketplace.json', { name: 'escaping', plugins: [{ name: 'outside', version: '1.0.0', source: './../../outside' }] })
    let validated = false
    await expect(discover(repository, { id: 'source-test', repository, ref: 'HEAD', commit: 'a'.repeat(40) }, async () => { validated = true; return '' })).rejects.toThrow('hors du dépôt')
    expect(validated).toBe(false)
    await put(repository, 'safe', 'fixture'); commit(repository)
    const object = git(repository, 'hash-object', '-w', 'safe')
    git(repository, 'update-index', '--add', '--cacheinfo', `120000,${object},unsafe-link`)
    git(repository, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'symlink')
    await expect(snapshot(join(root, 'store'), repository, 'HEAD')).rejects.toThrow('liens symboliques')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)

test('installation and diagnosis do not run plugin hooks or global Git checkout hooks', async () => {
  const { root, repository, extensions } = await fixture()
  const originalConfig = process.env.GIT_CONFIG_GLOBAL
  try {
    const pluginMarker = join(root, 'plugin-ran'), gitMarker = join(root, 'git-ran')
    await put(repository, '.claude-plugin/plugin.json', { name: 'inert', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `node -e "require('fs').writeFileSync(${JSON.stringify(pluginMarker.replaceAll('\\', '/')).replaceAll('"', "'")},'ran')"` }] }] } })
    commit(repository)
    const hooks = join(root, 'hooks').replaceAll('\\', '/')
    await put(root, 'hooks/post-checkout', `#!/bin/sh\nprintf ran > '${gitMarker.replaceAll('\\', '/')}'\n`)
    await chmod(join(root, 'hooks/post-checkout'), 0o755)
    const config = join(root, 'gitconfig')
    await writeFile(config, `[core]\n  hooksPath = ${hooks}\n`)
    process.env.GIT_CONFIG_GLOBAL = config
    await expect(extensions.addSource(repository)).rejects.toThrow('doivent être adaptés')
    expect(existsSync(pluginMarker)).toBe(false)
    expect(existsSync(gitMarker)).toBe(false)
  } finally {
    if (originalConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = originalConfig
    await rm(root, { recursive: true, force: true })
  }
}, 60000)

test('first launch adds the official catalogue and reinstalls Office only for existing profiles that used it', async () => {
  const { root, repository } = await fixture()
  // Un catalogue au format de WhiteCode-Extensions, avec la Bureautique recommandée.
  await put(repository, '.claude-plugin/marketplace.json', { name: 'whitecode-extensions', owner: { name: 'WhiteCode' }, plugins: [
    { name: 'whitecode-office', displayName: 'Bureautique', source: './plugins/office', version: '1.0.0', description: 'Bureautique', category: 'Bureautique', tags: ['recommended'] },
  ] })
  await put(repository, 'plugins/office/.claude-plugin/plugin.json', { name: 'whitecode-office', version: '1.0.0', skills: './skills/' })
  await put(repository, 'plugins/office/skills/word/SKILL.md', skill)
  await put(repository, 'plugins/office/office.cjs', 'module.exports = {}')
  commit(repository)
  const official = { repository, ref: 'HEAD' }

  // Mise à jour d'un profil qui utilisait la Bureautique incluse : réinstallée et activée.
  const upgraded = new Extensions(join(root, 'upgraded'), TEST_ROOTS)
  await upgraded.bootstrap(silence, true, official)
  const office = (await upgraded.list()).find(entry => entry.name === 'whitecode-office')!
  expect(office).toMatchObject({ displayName: 'Bureautique', recommended: true, category: 'Bureautique', installed: true, enabled: true })
  expect(await upgraded.officeRuntime()).toBe(join(office.path!, 'office.cjs'))
  expect(await upgraded.catalogueStatus()).toEqual({ added: true, error: undefined })
  // Le lancement suivant ne refait rien, même si l'utilisateur a désactivé la Bureautique.
  await upgraded.setEnabled(office.id, false)
  await upgraded.bootstrap(silence, true, official)
  expect((await upgraded.list()).find(entry => entry.id === office.id)?.enabled).toBe(false)
  expect(await upgraded.officeRuntime()).toBeUndefined()

  // Première installation : le catalogue est ajouté, rien n'est installé d'office.
  const fresh = new Extensions(join(root, 'fresh'), TEST_ROOTS)
  await fresh.bootstrap(silence, false, official)
  expect((await fresh.list()).find(entry => entry.name === 'whitecode-office')).toMatchObject({ installed: false, notice: undefined })

  // Catalogue injoignable : l'échec est conservé et affiché, puis l'essai suivant réussit.
  const offline = new Extensions(join(root, 'offline'), TEST_ROOTS)
  await offline.bootstrap(silence, true, { repository: join(root, 'absent'), ref: 'HEAD' })
  const status = await offline.catalogueStatus()
  expect(status.added).toBe(false)
  expect(status.error).toBeTruthy()
  await offline.bootstrap(silence, true, official)
  expect((await offline.list()).find(entry => entry.name === 'whitecode-office')?.enabled).toBe(true)
}, 60000)
