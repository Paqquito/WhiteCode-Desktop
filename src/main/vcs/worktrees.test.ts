import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Worktrees } from './worktrees.js'

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()
}
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'sample-worktrees-'))
  const repo = join(dir, 'projet accentué'); await mkdir(repo)
  git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.email', 'test@example.invalid'); git(repo, 'config', 'user.name', 'Test')
  await writeFile(join(repo, 'note.txt'), 'original'); await writeFile(join(repo, '.gitignore'), 'ignored.txt\n')
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'initial')
  const store = join(dir, 'registry'); const service = new Worktrees(store)
  return { dir, repo, store, service, request: { path: join(dir, 'arbre séparé'), branch: 'test/session', base: 'HEAD', existingBranch: false } }
}

test('worktree isolation, persisted discovery, existing branch and safe cleanup preserve commits', async () => {
  const { repo, store, service, request } = await fixture()
  await writeFile(join(repo, 'note.txt'), 'original dirty')
  const tree = await service.create(repo, request)
  expect(await readFile(join(tree.path, 'note.txt'), 'utf8')).toBe('original')
  await writeFile(join(tree.path, 'note.txt'), 'isolated')
  expect(await readFile(join(repo, 'note.txt'), 'utf8')).toBe('original dirty')
  expect((await new Worktrees(store).list()).map(t => t.path)).toEqual([tree.path])
  await expect(service.remove(tree.id, [])).rejects.toThrow('fichiers')
  git(tree.path, 'add', '.'); git(tree.path, 'commit', '-m', 'session work')
  const commit = git(tree.path, 'rev-parse', 'HEAD')
  await expect(service.remove(tree.id, [tree.path])).rejects.toThrow('utilisé')
  await service.remove(tree.id, [])
  expect(git(repo, 'rev-parse', request.branch)).toBe(commit)
  await expect(access(tree.path)).rejects.toThrow()
  expect(await service.list()).toEqual([])
  const resumed = await service.create(repo, { ...request, existingBranch: true })
  expect(await readFile(join(resumed.path, 'note.txt'), 'utf8')).toBe('isolated')
  const fromTree = await service.create(resumed.path, { ...request, path: join(repo, '..', 'from-tree'), branch: 'from-tree' })
  expect(git(fromTree.path, 'rev-parse', 'HEAD')).toBe(commit)
}, 30000)

test('restart ignores partial temporary records and safely forgets creation interrupted before Git add', async () => {
  const { repo, store, service, request } = await fixture()
  await mkdir(store)
  await writeFile(join(store, 'partial.json.tmp'), '{')
  const id = '00000000-0000-0000-0000-000000000000'
  await writeFile(join(store, `${id}.json`), JSON.stringify({ id, root: repo, path: request.path, branch: request.branch }))
  expect((await service.list()).length).toBe(1)
  await service.remove(id, [])
  expect(await service.list()).toEqual([])
  expect(await readFile(join(repo, 'note.txt'), 'utf8')).toBe('original')
})

test('cleanup refuses untracked, ignored, nested active paths, changed branch and foreign worktrees', async () => {
  const { repo, service, request } = await fixture()
  const tree = await service.create(repo, request)
  for (const name of ['untracked.txt', 'ignored.txt']) {
    await writeFile(join(tree.path, name), 'keep me')
    await expect(service.remove(tree.id, [])).rejects.toThrow('fichiers')
    expect(await readFile(join(tree.path, name), 'utf8')).toBe('keep me')
    await rm(join(tree.path, name))
  }
  await expect(service.remove(tree.id, [join(tree.path, 'subdir')])).rejects.toThrow('utilisé')
  git(tree.path, 'checkout', '-b', 'changed')
  await expect(service.remove(tree.id, [])).rejects.toThrow('branche')
  await expect(service.remove('../foreign', [])).rejects.toThrow()
  expect(await readFile(join(repo, 'note.txt'), 'utf8')).toBe('original')
}, 30000)

test('creation validates branches, paths, missing Git and refuses reuse or overwritten directories', async () => {
  const { dir, repo, service, request } = await fixture()
  await expect(service.create(dir, request)).rejects.toThrow()
  await expect(service.create(repo, { ...request, branch: '--force' })).rejects.toThrow()
  await expect(service.create(repo, { ...request, base: '--help' })).rejects.toThrow()
  await expect(service.create(repo, { ...request, path: join(repo, 'nested') })).rejects.toThrow()
  await expect(service.create(repo, { ...request, path: repo })).rejects.toThrow()
  await expect(service.create(repo, { ...request, branch: 'main', existingBranch: true })).rejects.toThrow()
  expect(git(repo, 'branch', '--show-current')).toBe('main')
  const tree = await service.create(repo, request)
  await expect(service.create(repo, request)).rejects.toThrow()
  expect((await service.repository(tree.path)).root).toBe(repo)
  expect((await service.repository(tree.path)).branch).toBe(request.branch)
}, 30000)
