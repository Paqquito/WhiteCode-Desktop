import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
export type WorktreeRequest = { path: string; branch: string; base: string; existingBranch: boolean }
export type ManagedWorktree = { id: string; root: string; path: string; branch: string }
export type RepositoryInfo = { root: string; branch: string; branches: string[] }

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return stdout.trimEnd()
}

/** Includes descendants: an editor or terminal in a subdirectory still uses the tree. */
export function inside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path))
  return !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

async function inventory(cwd: string) {
  return (await git(cwd, ['worktree', 'list', '--porcelain', '-z'])).split('\0\0').filter(Boolean).map(block => {
    const fields = block.split('\0')
    return {
      path: fields.find(f => f.startsWith('worktree '))?.slice(9) ?? '',
      branch: fields.find(f => f.startsWith('branch '))?.slice(7),
      bare: fields.includes('bare'),
    }
  })
}

/** Desktop-owned inventory; no automatic pruning, forced removal or branch deletion. */
export class Worktrees {
  constructor(private readonly directory: string) {}

  async repository(cwd: string): Promise<RepositoryInfo> {
    const trees = await inventory(cwd)
    if (!trees[0]?.path || trees[0].bare) throw new Error('Un dépôt Git avec un dossier de travail est nécessaire.')
    const root = await realpath(trees[0].path)
    const branch = await git(cwd, ['branch', '--show-current'])
    const branches = (await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).split('\n')
      .filter(name => name && !trees.some(tree => tree.branch === `refs/heads/${name}`))
    return { root, branch, branches }
  }

  async list(): Promise<ManagedWorktree[]> {
    let names: string[]
    try { names = await readdir(this.directory) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    return Promise.all(names.filter(n => /^[0-9a-f-]{36}\.json$/.test(n)).map(async n => {
      const record = JSON.parse(await readFile(join(this.directory, n), 'utf8')) as ManagedWorktree
      if (`${record.id}.json` !== n || !isAbsolute(record.path) || !isAbsolute(record.root) || !record.branch) {
        throw new Error('Inventaire des worktrees invalide ; aucun nettoyage effectué.')
      }
      return record
    }))
  }

  async create(cwd: string, request: WorktreeRequest): Promise<ManagedWorktree> {
    const { root } = await this.repository(cwd)
    if (!request.branch || request.branch.startsWith('-')) throw new Error('Nom de branche invalide.')
    if (await git(root, ['check-ref-format', '--branch', request.branch]) !== request.branch) throw new Error('Indiquer un nom de branche explicite.')
    if (!isAbsolute(request.path)) throw new Error('Choisir un chemin absolu pour le nouveau dossier.')
    // Resolve the existing parent first, including Windows junctions and symlinks.
    const path = join(await realpath(dirname(request.path)), request.path.split(/[\\/]/).pop()!)
    for (const tree of await inventory(root)) {
      if (inside(await realpath(tree.path), path)) throw new Error('Le nouveau dossier doit être extérieur aux worktrees existants.')
    }
    try { await access(path); throw new Error('Le dossier existe déjà. Choisir un nouveau dossier.') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const ref = request.existingBranch ? `refs/heads/${request.branch}` : request.base
    if (!ref || ref.startsWith('-')) throw new Error('Référence de départ invalide.')
    const commit = await git(cwd, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
    await mkdir(this.directory, { recursive: true })
    const record = { id: randomUUID(), root, path, branch: request.branch }
    // Write ahead: a crash after git add must not orphan an otherwise usable checkout.
    const file = join(this.directory, `${record.id}.json`)
    const temporary = `${file}.tmp`
    await writeFile(temporary, JSON.stringify(record), { flag: 'wx' })
    await rename(temporary, file)
    try {
      await git(root, request.existingBranch
        ? ['worktree', 'add', '--', path, request.branch]
        : ['worktree', 'add', '-b', request.branch, '--', path, commit])
    } catch (error) {
      // Keep the record if Git registered a tree before failing; never delete its contents.
      if (!(await inventory(root)).some(t => inside(path, t.path) && inside(t.path, path))) await unlink(file)
      throw error
    }
    return record
  }

  async remove(id: string, usedPaths: string[]): Promise<void> {
    const record = (await this.list()).find(t => t.id === id)
    if (!record) throw new Error('Worktree non géré par cette application.')
    let missing = false
    const path = await realpath(record.path).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing = true
      return resolve(record.path)
    })
    if (!inside(path, record.path) || !inside(record.path, path)) throw new Error('Le chemin du worktree a changé.')
    for (const used of usedPaths) {
      const canonical = await realpath(used).catch(() => resolve(used))
      if (inside(path, canonical) || inside(canonical, path)) throw new Error('Worktree encore utilisé par une session ou un terminal. Redémarrer l’application avant son nettoyage.')
    }
    const trees = await inventory(record.root)
    const tree = trees.find(t => inside(path, t.path) && inside(t.path, path))
    if (!tree && missing) {
      // Interrupted before git add (or removed externally): only forget our inventory entry.
      await unlink(join(this.directory, `${id}.json`))
      return
    }
    if (!tree || tree === trees[0] || tree.branch !== `refs/heads/${record.branch}`) throw new Error('Worktree ou branche modifié ; nettoyage refusé.')
    // Git normally permits deleting ignored files. They may contain irreplaceable local data.
    if (!missing && await git(path, ['status', '--porcelain', '--untracked-files=all', '--ignored'])) {
      throw new Error('Des fichiers modifiés, non suivis ou ignorés sont présents. Les préserver avant le nettoyage.')
    }
    await git(record.root, ['worktree', 'remove', '--', path])
    await unlink(join(this.directory, `${id}.json`))
  }
}
