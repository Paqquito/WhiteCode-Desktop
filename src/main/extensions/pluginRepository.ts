/** Fetches inert Git snapshots. Validation is delegated to the shipped engine. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, realpath, rm, readFile, readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, dirname, basename } from 'node:path'

const run = promisify(execFile)
const MAX_JSON = 2 * 1024 * 1024
export function repositoryAddress(input: string, local = true): string {
  if (typeof input !== 'string' || !input.trim() || input.length > 2048) throw new Error('Adresse du dépôt invalide.')
  const value = input.trim()
  if (local && isAbsolute(value)) return resolve(value)
  if (/^[\w.-]+\/[\w.-]+$/.test(value)) return `https://github.com/${value.replace(/\.git$/, '')}.git`
  if (/^git@[a-zA-Z0-9.-]+:[\w./-]+$/.test(value) && !value.includes('..')) return value
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return url.toString()
  } catch { /* Report a single actionable error. */ }
  throw new Error('Utilisez un dépôt HTTPS sans identifiants, git@hôte:dépôt, owner/repo ou un dépôt Git local.')
}
export function gitReference(value = 'HEAD'): string {
  if (typeof value !== 'string' || !/^[\w][\w./-]{0,199}$/.test(value) || value.includes('..')) throw new Error('Référence Git invalide : indiquez une branche, un tag ou un commit.')
  return value
}
export async function gitRead(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', `core.hooksPath=${join(cwd, '.git', 'disabled-hooks')}`, '-C', cwd, ...args], {
    timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
  })
  return stdout.trim()
}
export async function contained(root: string, path: string): Promise<string> {
  const base = await realpath(root), target = await realpath(path), rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new Error('Chemin hors du stockage des extensions.')
  return target
}
export async function removeManaged(root: string, path: string) {
  try { await contained(root, path) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  await rm(path, { recursive: true, force: true })
}
export async function jsonFile(path: string): Promise<Record<string, any>> {
  if ((await stat(path)).size > MAX_JSON) throw new Error('Manifeste trop volumineux.')
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manifeste JSON invalide.')
  return value
}
export async function snapshot(store: string, repository: string, ref: string) {
  await mkdir(store, { recursive: true })
  const path = await mkdtemp(join(store, '.download-'))
  try {
    await gitRead(path, ['init', '--template='])
    await gitRead(path, ['remote', 'add', 'origin', repositoryAddress(repository)])
    await gitRead(path, ['fetch', '--depth=1', '--no-tags', 'origin', gitReference(ref)])
    const commit = await gitRead(path, ['rev-parse', 'FETCH_HEAD'])
    const tree = (await gitRead(path, ['ls-tree', '-r', '-l', '-z', 'FETCH_HEAD'])).split('\0').filter(Boolean)
    if (tree.length > 30000) throw new Error('Dépôt trop volumineux : limite de 30 000 fichiers.')
    let size = 0
    for (const entry of tree) {
      const [metadata] = entry.split('\t'), [mode, , , bytes] = metadata!.trim().split(/\s+/)
      if (mode === '120000' || mode === '160000') throw new Error('Les liens symboliques et sous-modules ne sont pas pris en charge dans les extensions installées.')
      size += Number(bytes) || 0
    }
    if (size > 256 * 1024 * 1024) throw new Error('Dépôt trop volumineux : limite de 256 Mo décompressés.')
    await gitRead(path, ['checkout', '--detach', 'FETCH_HEAD'])
    return { path, commit }
  } catch (error) { await removeManaged(store, path); throw error }
}
/** Checks an existing tree too (legacy installs can contain untracked symlinks). */
export async function inventory(root: string): Promise<{ skills: string[]; commands: number; agents: number }> {
  const skills: string[] = []; let files = 0, commands = 0, agents = 0
  const walk = async (directory: string, depth: number) => {
    if (depth > 20) throw new Error('Arborescence d’extension trop profonde.')
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      if (++files > 30000) throw new Error('Extension trop volumineuse.')
      if (entry.isSymbolicLink()) throw new Error('Lien symbolique dans l’extension : diagnostic requis.')
      const path = join(directory, entry.name), rel = relative(root, path).replace(/\\/g, '/')
      if (entry.isDirectory()) await walk(path, depth + 1)
      else if (entry.name === 'SKILL.md' || entry.name === 'definition.md') skills.push(rel)
      else if (entry.name.endsWith('.md') && rel.startsWith('commands/')) commands++
      else if (entry.name.endsWith('.md') && rel.startsWith('agents/')) agents++
    }
  }
  await walk(root, 0)
  return { skills, commands, agents }
}
export function engineValidator(roots: import('../backend/launch.js').RuntimeRoots, configRoot: string) {
  return async (path: string): Promise<string> => {
    try {
      if (basename(path) === 'marketplace.json') {
        const manifest = await jsonFile(path)
        if (!Array.isArray(manifest.plugins) || typeof manifest.name !== 'string') throw new Error('Catalogue invalide.')
        // Discovery validates each entry and confines its paths before invoking this validator.
        return 'Catalogue lu ; chaque extension est validée séparément par WhiteCode.'
      }
      const { backendCommand, backendEnvironment, distribution } = await import('../backend/launch.js')
      const { whiteCodeExtensions } = await import('../backend/extensions.js')
      const id = distribution(roots.appRoot), command = backendCommand(roots.engineRoot, id)
      const root = basename(path) === 'plugin.json' ? dirname(dirname(path)) : basename(path) === 'extension.json' ? dirname(path) : path
      const [extension] = await whiteCodeExtensions([root], configRoot)
      const { stdout } = await run(command.file, [...command.args, 'extension', 'validate', extension!], {
        cwd: roots.engineRoot, timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
        env: { ...process.env, ...backendEnvironment(id, configRoot, 'http://127.0.0.1', 'unused-for-validation') },
      })
      return stdout.replace(/\x1b\[[0-9;]*m/g, '').slice(-12000)
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string }
      throw new Error(`Validation moteur refusée : ${(e.stdout || e.stderr || e.message || String(error)).replace(/\x1b\[[0-9;]*m/g, '').slice(-12000)}`)
    }
  }
}
