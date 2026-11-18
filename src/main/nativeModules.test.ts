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
