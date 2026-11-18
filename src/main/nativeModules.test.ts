import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleModules, loadModules } from '../../scripts/nativeModules.js'

test('la distribution sélectionne ses points d’entrée et ses ressources au build', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-modules-'))
  try {
    const source = join(root, 'sources'), sample = join(source, 'sample'), dist = join(root, 'dist')
    await mkdir(sample, { recursive: true })
    await writeFile(join(sample, 'module.json'), JSON.stringify({ apiVersion: 1, main: 'main.ts', assets: ['notice.txt'] }))
    await writeFile(join(sample, 'main.ts'), "export function register(host) { host.registerIpc('label', async () => 'fixture') }")
    await writeFile(join(sample, 'notice.txt'), 'Notice de test')
    const modules = await loadModules(['sample'], [source], dist)
    expect(await readFile(join(dist, 'modules/sample/notice.txt'), 'utf8')).toBe('Notice de test')
    const desktop = join(import.meta.dir, '../..')
    const built = await Bun.build({ entrypoints: [join(desktop, 'src/main/nativeEntries.ts')], target: 'bun', plugins: [bundleModules(modules, 'main', desktop)] })
    expect(built.success).toBe(true)
    const path = join(root, 'bundle.mjs')
    await writeFile(path, await built.outputs[0]!.text())
    const { nativeEntries } = await import(path)
    const handlers = new Map()
    nativeEntries[0].register({ registerIpc: (name: string, handler: unknown) => handlers.set(name, handler) })
    expect(await handlers.get('label')()).toBe('fixture')
    expect(await loadModules([], [source], dist)).toEqual([])
    await expect(loadModules(['sample'], [], dist)).rejects.toThrow('0 manifeste')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('les services actifs appartiennent à un seul module et leurs dépendances sont présentes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'module-services-'))
  const dist = join(root, 'dist')
  async function manifest(id: string, provides: Record<string, string>, requires: string[] = []) {
    const directory = join(root, id)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'service.ts'), 'export const name = "selected"')
    await writeFile(join(directory, 'module.json'), JSON.stringify({ apiVersion: 1, provides, requires }))
  }
  try {
    await manifest('service', { application: 'service.ts' }, ['support'])
    await manifest('support', {})
    await expect(loadModules(['service'], [root], dist)).rejects.toThrow('Dépendance')
    const selected = await loadModules(['service', 'support'], [root], dist)
    const entry = join(root, 'entry.ts')
    await writeFile(entry, "export { name } from '#desktop/application'")
    const build = await Bun.build({ entrypoints: [entry], plugins: [bundleModules(selected, 'main', root)] })
    expect(build.success).toBe(true)
    expect(await build.outputs[0]!.text()).toContain('selected')
    expect((await loadModules(['support'], [root], dist))[0]?.provides).toEqual({})
    await manifest('support', { application: 'service.ts' })
    await expect(loadModules(['support', 'service'], [root], dist)).rejects.toThrow('Deux modules')
    await manifest('support', { unknown: 'service.ts' })
    await expect(loadModules(['support'], [root], dist)).rejects.toThrow('inconnu')
    await manifest('support', { application: '../entry.ts' })
    await expect(loadModules(['support'], [root], dist)).rejects.toThrow('Chemin')
  } finally { await rm(root, { recursive: true, force: true }) }
})
