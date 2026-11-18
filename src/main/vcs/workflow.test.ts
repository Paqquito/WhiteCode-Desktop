import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { gitWorkflowAction, gitWorkflowState, workflowPR, type WorkflowAction } from './workflow.js'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'fixture-t19-'))
  const root = join(directory, 'repo'), remote = join(directory, 'remote.git')
  await mkdir(root); await mkdir(remote)
  git(root, 'init', '-b', 'main'); git(remote, 'init', '--bare', '-b', 'main')
  git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false'); git(root, 'config', 'core.autocrlf', 'false')
  await writeFile(join(root, 'note.txt'), 'initial\n'); git(root, 'add', '.'); git(root, 'commit', '-m', 'initial')
  git(root, 'remote', 'add', 'origin', remote)
  return { root, remote, directory }
}
async function request(root: string, action: WorkflowAction) {
  const state = await gitWorkflowState(root)
  return { expectedBranch: state.branch, expectedHead: state.head, action }
}
test('branches and publication use real Git, protect dirty files and reject stale confirmations', async () => {
  const { root, remote, directory } = await fixture()
  try {
    const state = await gitWorkflowState(root)
    expect(state).toMatchObject({ branch: 'main', branches: ['main'], dirty: false, upstream: null })
    const target = state.remotes[0]!
    const push = { kind: 'push' as const, remote: target.name, fingerprint: target.fingerprint }
    const old = await request(root, push)
    await gitWorkflowAction(root, await request(root, { kind: 'branch', branch: 'feature/é-test' }))
    await expect(gitWorkflowAction(root, old)).rejects.toThrow('changé')
    await writeFile(join(root, 'note.txt'), 'changed\n')
    await expect(gitWorkflowAction(root, await request(root, { kind: 'switch', branch: 'main' }))).rejects.toThrow('Commitez')
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('changed\n')
    const staleHead = await request(root, push)
    git(root, 'commit', '-am', 'feature')
    await expect(gitWorkflowAction(root, staleHead)).rejects.toThrow('changé')
    await gitWorkflowAction(root, await request(root, push))
    expect(git(remote, 'rev-parse', 'refs/heads/feature/é-test')).toBe(git(root, 'rev-parse', 'HEAD'))
    expect(git(remote, 'for-each-ref', '--format=%(refname)')).toBe('refs/heads/feature/é-test')
    await gitWorkflowAction(root, await request(root, { kind: 'switch', branch: 'main' }))
    expect(await readFile(join(root, 'note.txt'), 'utf8')).toBe('initial\n')
    await expect(gitWorkflowAction(root, await request(root, { kind: 'branch', branch: '--orphan' }))).rejects.toThrow('invalide')
    await writeFile(join(root, '.git', 'info', 'exclude'), 'ignored.txt\n')
    git(root, 'switch', 'feature/é-test')
    await writeFile(join(root, 'ignored.txt'), 'tracked elsewhere')
    git(root, 'add', '-f', 'ignored.txt'); git(root, 'commit', '-m', 'tracked on feature')
    git(root, 'switch', 'main')
    await writeFile(join(root, 'ignored.txt'), 'private local content')
    expect((await gitWorkflowState(root)).dirty).toBe(false)
    await expect(gitWorkflowAction(root, await request(root, { kind: 'switch', branch: 'feature/é-test' }))).rejects.toThrow()
    expect(await readFile(join(root, 'ignored.txt'), 'utf8')).toBe('private local content')
    git(root, 'remote', 'set-url', 'origin', join(directory, 'different.git'))
    await expect(gitWorkflowAction(root, await request(root, push))).rejects.toThrow('distant a changé')
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60000)

test('push refuses non-fast-forward and publishes no tags even with followTags enabled', async () => {
  const { root, remote, directory } = await fixture()
  try {
    git(root, 'push', 'origin', 'main')
    const original = git(root, 'rev-parse', 'HEAD')
    git(root, 'tag', '-a', 'private-tag', '-m', 'not for publication')
    git(root, 'config', 'push.followTags', 'true')
    const target = (await gitWorkflowState(root)).remotes[0]!
    const action = { kind: 'push' as const, remote: target.name, fingerprint: target.fingerprint }
    await writeFile(join(root, 'note.txt'), 'remote future\n'); git(root, 'commit', '-am', 'future')
    await gitWorkflowAction(root, await request(root, action))
    expect(git(remote, 'tag')).toBe('')
    const remoteHead = git(remote, 'rev-parse', 'main')
    git(root, 'reset', '--hard', original)
    await writeFile(join(root, 'note.txt'), 'divergent\n'); git(root, 'commit', '-am', 'divergent')
    await expect(gitWorkflowAction(root, await request(root, action))).rejects.toThrow()
    expect(git(remote, 'rev-parse', 'main')).toBe(remoteHead)
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60000)

test('PR creation preserves multiline body; merge pins reviewed head/base, never bypasses protection', async () => {
  const { root, remote, directory } = await fixture()
  try {
    git(root, 'switch', '-c', 'feature')
    git(root, 'push', 'origin', 'feature')
    git(root, 'remote', 'set-url', 'origin', 'https://github.com/example/repo.git')
    const target = (await gitWorkflowState(root)).remotes[0]!
    expect(target.repository).toBe('github.com/example/repo')
    const head = git(root, 'rev-parse', 'HEAD')
    const pr = { number: 12, title: 'Title', url: 'https://github.com/example/repo/pull/12', state: 'OPEN', headRefOid: head, headRefName: 'feature', baseRefName: 'main', isDraft: false, statusCheckRollup: [{ name: 'CI', conclusion: 'SUCCESS' }] }
    let calls: string[][] = []
    const command = async (file: string, args: string[]) => {
      calls.push(args)
      if (file === 'git') {
        expect(args).toEqual(['ls-remote', '--heads', '--', 'https://github.com/example/repo.git', 'refs/heads/feature'])
        return { stdout: git(root, 'ls-remote', '--heads', remote, 'refs/heads/feature') }
      }
      expect(file).toBe('gh')
      if (args[1] === 'create') {
        expect(args).toContain('--draft'); expect(args).toContain('--head')
        expect(await readFile(args[args.indexOf('--body-file') + 1]!, 'utf8')).toBe('First line\n\nSecond `literal` $(value)')
        return { stdout: pr.url }
      }
      return { stdout: args[1] === 'view' ? JSON.stringify(pr) : '' }
    }
    const create = { kind: 'create-pr' as const, remote: 'origin', fingerprint: target.fingerprint, base: 'main', title: 'Title', body: 'First line\n\nSecond `literal` $(value)', draft: true }
    expect(await gitWorkflowAction(root, await request(root, create), command)).toContain(pr.url)
    const bodyPath = calls.at(-1)![calls.at(-1)!.indexOf('--body-file') + 1]!
    await expect(readFile(bodyPath)).rejects.toThrow()
    await writeFile(join(root, 'note.txt'), 'unpublished\n'); git(root, 'commit', '-am', 'not pushed')
    await expect(gitWorkflowAction(root, await request(root, create), command)).rejects.toThrow('Publiez')
    expect(await workflowPR(root, 'origin', command)).toMatchObject({ number: 12, checks: [{ name: 'CI', state: 'SUCCESS' }] })
    const action = { kind: 'merge-pr' as const, remote: 'origin', fingerprint: target.fingerprint, number: 12, head, base: 'main', method: 'squash' as const }
    await gitWorkflowAction(root, await request(root, action), command)
    expect(calls.at(-1)).toEqual(['pr', 'merge', '12', '--repo', 'github.com/example/repo', '--squash', '--match-head-commit', head])
    calls = []; pr.headRefOid = 'a'.repeat(40)
    await expect(gitWorkflowAction(root, await request(root, action), command)).rejects.toThrow('PR a changé')
    expect(calls).toHaveLength(1)
    pr.headRefOid = head; pr.baseRefName = 'release'
    await expect(gitWorkflowAction(root, await request(root, action), command)).rejects.toThrow('PR a changé')
    await expect(workflowPR(root, 'origin', async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }) })).rejects.toThrow('GitHub CLI')
    git(root, 'remote', 'set-url', 'origin', 'https://user:secret@github.com/example/repo.git?token=hidden')
    expect(JSON.stringify((await gitWorkflowState(root)).remotes)).not.toMatch(/secret|hidden/)
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 60000)
