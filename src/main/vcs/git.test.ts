import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, rm, mkdir, rename, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { gitSummary, gitFileDiff, gitAction } from './git.js'
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim()
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'l06-git-'))
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false'); git(root, 'config', 'core.autocrlf', 'false')
  return root
}
// These scenarios launch dozens of real Git processes (not a 5 s unit test on Windows).
test('new repository, partial staging, literal unusual paths, rename, commit and subdirectory', async () => {
  const root = await fixture(), name = process.platform === 'win32' ? 'é space & [literal].txt' : 'é space -> tab\tline\n.txt'
  try {
    await writeFile(join(root, name), 'one\n')
    expect((await gitSummary(root)).available).toBe(true)
    await gitAction(root, { kind: 'stage', path: name })
    await gitAction(root, { kind: 'unstage', path: name })
    expect(git(root, 'ls-files')).toBe('')
    await gitAction(root, { kind: 'stage', path: name }); await gitAction(root, { kind: 'commit', message: 'initial' })
    await writeFile(join(root, name), 'two\n'); await gitAction(root, { kind: 'stage', path: name }); await writeFile(join(root, name), 'three\n')
    const summary = await gitSummary(root)
    expect(summary.available && summary.files.filter(f => f.path === name).map(f => f.staged)).toEqual([true, false])
    expect(await gitFileDiff(root, name, true, false)).toContain('+two')
    expect(await gitFileDiff(root, name, false, false)).toContain('+three')
    await gitAction(root, { kind: 'unstage', path: name }); await gitAction(root, { kind: 'stage', path: name }); await gitAction(root, { kind: 'commit', message: 'second' })
    await rename(join(root, name), join(root, 'renamed.txt')); git(root, 'add', '-A')
    const renamed = await gitSummary(root)
    expect(renamed.available && renamed.files[0]?.originalPath).toBe(name)
    await gitAction(root, { kind: 'unstage', path: 'renamed.txt' })
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('')
    await mkdir(join(root, 'subdir')); const sub = await gitSummary(join(root, 'subdir'))
    expect(sub.available && sub.files.some(f => f.path === 'renamed.txt')).toBe(true)
    await expect(gitAction(root, { kind: 'stage', path: '../outside' })).rejects.toThrow()
    await expect(gitAction(root, { kind: 'commit', message: '' })).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)
test('conflict is explicit and blocks commit; binary and escaping symlinks never masquerade as text', async () => {
  const root = await fixture()
  const outside = await mkdtemp(join(tmpdir(), 'l06-outside-'))
  try {
    await writeFile(join(root, 'a'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'base')
    git(root, 'checkout', '-b', 'other'); await writeFile(join(root, 'a'), 'other\n'); git(root, 'commit', '-am', 'other')
    git(root, 'checkout', 'main'); await writeFile(join(root, 'a'), 'main\n'); git(root, 'commit', '-am', 'main')
    try { git(root, 'merge', 'other') } catch {}
    const summary = await gitSummary(root)
    expect(summary.available && summary.files[0]?.status).toBe('U')
    await expect(gitAction(root, { kind: 'commit', message: 'bad' })).rejects.toThrow('conflits')
    await writeFile(join(root, 'binary'), 'x\0y')
    await expect(gitFileDiff(root, 'binary', false, true)).rejects.toThrow('binaire')
    await writeFile(join(outside, 'secret'), 'external content')
    await symlink(outside, join(root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    const escaped = process.platform === 'win32' ? 'outside/secret' : 'outside'
    await expect(gitFileDiff(root, escaped, false, true)).rejects.toThrow('hors du dépôt')
    await writeFile(join(root, 'a'), 'resolved\n'); await gitAction(root, { kind: 'stage', path: 'a' }); await gitAction(root, { kind: 'commit', message: 'resolve' })
    expect(git(root, 'log', '-1', '--format=%s')).toBe('resolve')
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
}, 30000)
test('not a repository is unavailable, never a clean working tree', async () => {
  expect(await gitSummary(tmpdir())).toMatchObject({ available: false })
  expect(await gitSummary('/missing/l06')).toMatchObject({ available: false })
}, 30000)

test('GitHub dependency absence and PR/CI responses are explicit, without network access', async () => {
  const { pullRequest } = await import('./git.js')
  const root = await fixture()
  try {
    expect(await pullRequest(root, async () => { throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) })).toMatchObject({ available: false, reason: expect.stringContaining('GitHub CLI') })
    expect(await pullRequest(root, async (file, args, options) => {
      expect(file).toBe('gh')
      expect(args).toEqual(['pr', 'view', '--json', 'title,url,state,statusCheckRollup'])
      expect(options.env?.GH_PROMPT_DISABLED).toBe('1')
      return { stdout: JSON.stringify({ title: 'Review', url: 'https://github.com/example/repo/pull/1', state: 'OPEN', statusCheckRollup: [{ name: 'tests', conclusion: 'SUCCESS' }, { name: 'lint', status: 'IN_PROGRESS' }] }) }
    })).toMatchObject({ available: true, checks: [{ name: 'tests', state: 'SUCCESS' }, { name: 'lint', state: 'IN_PROGRESS' }] })
    expect(await pullRequest(root, async () => { throw Object.assign(new Error('exit 1'), { stderr: 'no pull requests found' }) })).toMatchObject({ available: false, reason: expect.stringContaining('no pull requests found') })
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)
