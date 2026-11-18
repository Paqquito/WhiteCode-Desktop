import { cp, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { BunPlugin } from 'bun'
import hostPackage from '../package.json'

export interface NativeModule {
  provides?: Record<string, string>
  styles?: string[]
  id: string
  main?: string
  renderer?: string
}

async function member(directory: string, name: unknown): Promise<string> {
  if (typeof name !== 'string' || !name || isAbsolute(name) || name.split(/[\\/]/).some(part => !part || part === '..' || part === '.')) {
    throw Error('Chemin de module invalide : ' + String(name))
  }
  const path = await realpath(join(directory, name))
  const rel = relative(directory, path)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error('Chemin hors du module : ' + name)
  return path
}

export async function loadModules(ids: readonly string[], roots: string[], out: string): Promise<NativeModule[]> {
  const modules: NativeModule[] = []
  const owners = new Map<string, string>()
  for (const id of ids) {
    if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) throw Error('Identifiant de module invalide : ' + id)
    const matches = roots.filter(root => existsSync(join(root, id, 'module.json')))
    if (matches.length !== 1) throw Error(`Module ${id} : ${matches.length} manifeste(s) dans les dossiers configurés.`)
    const directory = await member(await realpath(matches[0]!), id)
    const manifest = JSON.parse(await readFile(await member(directory, 'module.json'), 'utf8'))
    if (manifest.apiVersion !== 1 || (manifest.assets !== undefined && !Array.isArray(manifest.assets))) throw Error('Manifeste de module invalide : ' + id)
    const entry: NativeModule = { id }
    if (manifest.requires !== undefined && (!Array.isArray(manifest.requires) || manifest.requires.some((required: unknown) => typeof required !== 'string' || !ids.includes(required)))) throw Error('Dépendance de module absente : ' + id)
    if (manifest.provides !== undefined) {
      if (!manifest.provides || Array.isArray(manifest.provides) || typeof manifest.provides !== 'object') throw Error('Services invalides : ' + id)
      entry.provides = {}
      for (const [service, file] of Object.entries(manifest.provides)) {
        if (!Object.hasOwn(hostPackage.imports, '#desktop/' + service)) throw Error('Service de distribution inconnu : ' + service)
        if (owners.has(service)) throw Error('Deux modules fournissent ' + service + ' : ' + owners.get(service) + ', ' + id)
        const path = await member(directory, file)
        if (!/\.tsx?$/.test(path) || !(await stat(path)).isFile()) throw Error('Source TypeScript attendue : ' + service)
        entry.provides['#desktop/' + service] = path
        owners.set(service, id)
      }
    }
    if (manifest.styles !== undefined) {
      if (!Array.isArray(manifest.styles)) throw Error('Feuilles de style invalides : ' + id)
      entry.styles = []
      for (const name of manifest.styles) {
        const file = await member(directory, name)
        if (!file.endsWith('.css')) throw Error('Feuille de style invalide : ' + name)
        entry.styles.push(file)
      }
    }
    for (const target of ['main', 'renderer'] as const) {
      if (manifest[target] !== undefined) entry[target] = await member(directory, manifest[target])
    }
    for (const name of manifest.assets ?? []) {
      const src = await member(directory, name)
      if (!(await stat(src)).isFile()) throw Error('Fichier de ressource attendu : ' + name)
      const dest = join(out, 'modules', id, name)
      await mkdir(dirname(dest), { recursive: true })
      await cp(src, dest)
    }
    modules.push(entry)
  }
  return modules
}

export function bundleModules(modules: NativeModule[], target: 'main' | 'renderer', desktop: string): BunPlugin {
  return {
    name: 'distribution-' + target,
    setup(builder) {
      const services = new Map(modules.flatMap(module => Object.entries(module.provides ?? {})))
      builder.onResolve({ filter: /^#desktop\// }, args => {
        const implementation = services.get(args.path)
        if (implementation) return { path: implementation }
      })
      // Tests import a regular, empty registry. Only this exact host entry is replaced.
      builder.onLoad({ filter: /[\\/]nativeEntries\.ts$/ }, args => {
        if (resolve(args.path) !== resolve(desktop, 'src', target, 'nativeEntries.ts')) return
        const imports: string[] = [], entries: string[] = []
        for (const [index, module] of modules.entries()) {
          if (!module[target]) continue
          const field = target === 'main' ? 'register' : 'views'
          imports.push(`import { ${field} as entry${index} } from ${JSON.stringify(module[target])}`)
          entries.push(`{ id: ${JSON.stringify(module.id)}, ${field}: entry${index} }`)
        }
        return { contents: [...imports, 'export const nativeEntries = [' + entries.join(',') + ']'].join('\n'), loader: 'ts' }
      })
      if (target === 'renderer') {
        builder.onResolve({ filter: /^react(?:\/jsx(?:-dev)?-runtime)?$/ }, args => ({
          path: require.resolve(args.path, { paths: [desktop] }),
        }))
      }
    },
  }
}
