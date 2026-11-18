import { existsSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import type { CatalogEntry } from './extensionCatalog.js'
import { inventory, jsonFile, repositoryAddress } from './pluginRepository.js'
import { parseConnector } from '#desktop/connector-manifest'
import { parsePanel } from './panels.js'

export type ExtensionSource = { id: string; repository: string; ref: string; commit: string; name: string; checkedAt: string; entries: CatalogEntry[] }
export const sourceId = (value: string) => `source-${createHash('sha256').update(value).digest('hex').slice(0, 20)}`
const entryId = (source: string, name: string) => `plugin-${createHash('sha256').update(`${source}:${name}`).digest('hex').slice(0, 24)}`
export function pluginPath(root: string, value: string): string {
  if (typeof value !== 'string' || isAbsolute(value) || value.includes('\\') || value.includes('\0')) throw new Error('Chemin de plugin invalide.')
  const path = resolve(root, value), rel = relative(root, path)
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('Chemin de plugin hors du dépôt.')
  return path
}
export async function inspectPlugin(path: string) {
  const files = await inventory(path)
  const manifest = await jsonFile(existsSync(join(path, 'extension.json')) ? join(path, 'extension.json') : join(path, '.claude-plugin', 'plugin.json'))
  if (typeof manifest.name !== 'string' || !manifest.name || manifest.name.length > 200) throw new Error('Nom du plugin invalide.')
  if (manifest.version !== undefined && typeof manifest.version !== 'string') throw new Error('Version du plugin invalide.')
  // Component file references must stay inside the installed package; executable command strings are not paths here.
  for (const key of ['skills', 'agents', 'commands', 'hooks', 'mcpServers', 'lspServers', 'outputStyles']) {
    const value = (manifest.components ?? manifest)[key]
    for (const item of Array.isArray(value) ? value : [value]) {
      if (typeof item === 'string') pluginPath(path, item)
      if (key === 'commands' && item && typeof item === 'object') {
        for (const command of Object.values(item) as Array<{ source?: string }>) if (command?.source) pluginPath(path, command.source)
      }
    }
  }
  const connector = existsSync(join(path, 'connector.json')) ? parseConnector(await jsonFile(join(path, 'connector.json'))) : undefined
  if (existsSync(join(path, 'panel.json')) && !connector) throw new Error('Le panneau du plugin doit déclarer son connecteur.')
  const panel = existsSync(join(path, 'panel.json')) ? parsePanel(await jsonFile(join(path, 'panel.json')), connector) : undefined
  return { manifest, ...files, connector, panel }
}
/** Reads the engine marketplace format. Unsupported transports remain visible with a diagnostic. */
export async function discover(path: string, source: Omit<ExtensionSource, 'name' | 'entries' | 'checkedAt'>, validate: (path: string) => Promise<string>): Promise<ExtensionSource> {
  const marketplace = join(path, '.claude-plugin', 'marketplace.json')
  const entries: CatalogEntry[] = []
  let name = basename(source.repository).replace(/\.git$/, '')
  const base = { kind: 'plugin' as const, sourceId: source.id, repository: source.repository, homepage: source.repository, license: 'Non renseignée', ref: source.commit, pluginPath: '.', content: 'plugin' as const }
  if (existsSync(marketplace)) {
    const manifest = await jsonFile(marketplace)
    if (!Array.isArray(manifest.plugins) || manifest.plugins.length > 1000 || typeof manifest.name !== 'string') throw new Error('Catalogue invalide ou trop volumineux (1 000 entrées maximum).')
    // The engine validator reads local plugin versions. Confine those paths
    // before calling it, not only before installation.
    for (const item of manifest.plugins) if (typeof item?.source === 'string') pluginPath(path, item.source)
    await validate(marketplace)
    name = manifest.name
    const names = new Set<string>()
    for (const item of manifest.plugins) {
      if (typeof item.name !== 'string' || names.has(item.name)) throw new Error('Noms de plugins manquants ou dupliqués dans le catalogue.')
      names.add(item.name)
      const entry: CatalogEntry = { ...base, id: entryId(source.id, item.name), name: item.name, summary: String(item.description ?? ''), license: String(item.license ?? base.license), version: typeof item.version === 'string' ? item.version : undefined,
        displayName: typeof item.displayName === 'string' && item.displayName.trim() ? item.displayName.trim().slice(0, 80) : undefined,
        category: typeof item.category === 'string' && item.category.trim() ? item.category.trim().slice(0, 80) : undefined,
        recommended: Array.isArray(item.tags) && item.tags.includes('recommended') }
      try {
        if (typeof item.source === 'string') {
          const local = pluginPath(path, item.source)
          entry.pluginPath = relative(path, local).replace(/\\/g, '/') || '.'
          if (existsSync(join(local, 'extension.json')) || existsSync(join(local, '.claude-plugin', 'plugin.json'))) {
            const info = await inspectPlugin(local)
            entry.skills = info.skills
            if (info.manifest.name !== item.name) throw new Error('Le nom du manifeste diffère de celui du catalogue.')
          } else if (item.strict !== false) throw new Error('Manifeste du plugin introuvable.')
        } else if (item.source?.source === 'github' || item.source?.source === 'url' || item.source?.source === 'git-subdir') {
          entry.repository = repositoryAddress(item.source.repo ?? item.source.url, false)
          entry.homepage = entry.repository
          entry.ref = item.source.sha ?? item.source.ref ?? 'HEAD'
          entry.pluginPath = item.source.path ?? '.'
          pluginPath(path, entry.pluginPath!)
        } else throw new Error('Source non prise en charge : utilisez Git ou un chemin relatif au catalogue (npm/pip ne sont pas installés).')
        if (item.strict === false) {
          const { source: _source, strict: _strict, category: _category, tags: _tags, ...pluginManifest } = item
          entry.manifest = pluginManifest
        }
      } catch (error) { entry.problem = (error as Error).message }
      entries.push(entry)
    }
  } else if (existsSync(join(path, 'extension.json')) || existsSync(join(path, '.claude-plugin', 'plugin.json'))) {
    const info = await inspectPlugin(path)
    await validate(existsSync(join(path, 'extension.json')) ? join(path, 'extension.json') : join(path, '.claude-plugin', 'plugin.json'))
    name = info.manifest.name
    entries.push({ ...base, id: entryId(source.id, name), name, summary: String(info.manifest.description ?? ''), version: info.manifest.version, license: String(info.manifest.license ?? base.license), skills: info.skills })
  } else {
    const { skills } = await inventory(path)
    if (!skills.length) throw new Error('Aucun marketplace.json, plugin.json ou SKILL.md trouvé dans ce dépôt.')
    if (skills.length > 1000) throw new Error('Dépôt trop volumineux : 1 000 compétences maximum.')
    for (const file of skills) {
      const directory = dirname(file), label = directory === '.' ? name : basename(directory)
      const id = entryId(source.id, file), pluginName = `skill-${label.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-${id.slice(-6)}`
      entries.push({ ...base, id, name: label, summary: `Compétence ${file}`, content: 'skill', pluginPath: directory, skills: ['SKILL.md'], manifest: { name: pluginName, skills: './' } })
    }
  }
  return { ...source, name, entries, checkedAt: new Date().toISOString() }
}
