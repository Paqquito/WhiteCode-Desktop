/** Convert enabled desktop plugins to WhiteCode extensions without touching the engine. */
import { cp, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join, relative, resolve, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'

const conversions = new Map<string, Promise<string>>()

async function nativeSkillDefinitions(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) await nativeSkillDefinitions(join(directory, entry.name))
    else if (entry.isFile() && entry.name === 'SKILL.md') await rename(join(directory, entry.name), join(directory, 'definition.md'))
  }
}

export async function whiteCodeExtensions(directories: string[], configDir: string): Promise<string[]> {
  return Promise.all(directories.map(async directory => {
    try { await stat(join(directory, 'extension.json')); return directory } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const manifest = JSON.parse(await readFile(join(directory, '.claude-plugin', 'plugin.json'), 'utf8'))
    const sourceStat = await stat(join(directory, '.claude-plugin', 'plugin.json'))
    const name = String(manifest.name ?? basename(directory)).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
    if (!name) throw new Error('Nom de plugin invalide.')
    const key = createHash('sha256').update(directory + ':' + sourceStat.mtimeMs + ':' + JSON.stringify(manifest)).digest('hex').slice(0, 24)
    const target = join(configDir, 'customizations', 'extensions', key)
    const pending = conversions.get(target)
    if (pending) return pending
    const conversion = (async () => {
    if (manifest.hooks) throw new Error(`Les crochets du plugin ${name} doivent être adaptés au format WhiteCode.`)
    await mkdir(target, { recursive: true })
    const components: Record<string, string[]> = {}
    for (const kind of ['skills', 'commands', 'agents']) {
      const paths = manifest[kind] ? Array.isArray(manifest[kind]) ? manifest[kind] : [manifest[kind]] : [kind]
      for (const value of paths) {
        const from = resolve(directory, value), rel = relative(directory, from)
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Composant du plugin hors de son dossier.')
        try { await stat(from) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
        const directSkill = kind === 'skills' && (existsSync(join(from, 'SKILL.md')) || existsSync(join(from, 'definition.md')))
        const destination = directSkill ? join('converted-skills', createHash('sha256').update(rel).digest('hex').slice(0, 12)) : rel
        await cp(from, join(target, destination), { recursive: true, force: true })
        if (kind === 'skills') await nativeSkillDefinitions(join(target, destination))
        const component = directSkill ? 'converted-skills' : rel.replace(/\\/g, '/') || '.'
        if (!(components[kind] ??= []).includes(component)) components[kind]!.push(component)
      }
    }
    // Existing hook formats have different semantics; never silently execute them.
    await writeFile(join(target, 'extension.json'), JSON.stringify({ name, version: manifest.version ?? '1.0.0', description: String(manifest.description ?? name).slice(0, 300), components }, null, 2))
    return target
    })()
    conversions.set(target, conversion)
    try { return await conversion } finally { conversions.delete(target) }
  }))
}
