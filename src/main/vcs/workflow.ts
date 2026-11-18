/** Explicit Git publication. No implicit push, stash, force, reset or branch deletion. */
import { execFile, type ExecFileOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, rootOf } from './git.js'

const run = promisify(execFile)
type Command = (file: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string | Buffer }>
export type Remote = { name: string; target: string; fingerprint: string; repository: string | null }
export type GitWorkflowState = {
  branch: string; head: string; branches: string[]; remotes: Remote[]
  upstream: string | null; ahead: number; behind: number; dirty: boolean
}
export type WorkflowAction =
  | { kind: 'switch'; branch: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'push'; remote: string; fingerprint: string }
  | { kind: 'create-pr'; remote: string; fingerprint: string; base: string; title: string; body: string; draft: boolean }
  | { kind: 'merge-pr'; remote: string; fingerprint: string; number: number; head: string; base: string; method: 'merge' | 'squash' | 'rebase' }
export type WorkflowRequest = { expectedBranch: string; expectedHead: string; action: WorkflowAction }
export type WorkflowPR = {
  number: number; title: string; url: string; state: string; headRefOid: string
  headRefName: string; baseRefName: string; isDraft: boolean
  checks: Array<{ name: string; state: string }>
}
const lines = (value: string) => value.trim().split(/\r?\n/).filter(Boolean)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
/** Never send embedded remote credentials to the renderer. */
function remoteInfo(name: string, urls: string): Remote {
  const all = lines(urls)
  const targets = all.map(raw => {
    try {
      const url = new URL(raw)
      url.username = ''; url.password = ''; url.search = ''; url.hash = ''
      return url.toString()
    } catch { return raw.replace(/^[^/@\s]+@/, '') }
  })
  const raw = all.length === 1 ? all[0]! : ''
  const match = /^(?:https?:\/\/|ssh:\/\/(?:[^/@]+@)?|git@)([a-zA-Z0-9.-]+)[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(raw)
  return { name, target: targets.join(', '), fingerprint: hash(urls), repository: match ? `${match[1]}/${match[2]}/${match[3]}` : null }
}
export async function gitWorkflowState(cwd: string): Promise<GitWorkflowState> {
  const root = await rootOf(cwd)
  // Publication only needs the dirty flag, not per-file diff statistics.
  // Keep these fresh reads independent; no cached state may authorize a mutation.
  const [status, branch, head, branches, remoteNames, upstream] = await Promise.all([
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    git(root, ['symbolic-ref', '--short', 'HEAD']).then(v => v.trim(), () => ''),
    git(root, ['rev-parse', '--verify', 'HEAD']).then(v => v.trim(), () => ''),
    git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).then(lines),
    git(root, ['remote']).then(lines),
    git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).then(v => v.trim(), () => null),
  ])
  const [remotes, divergence] = await Promise.all([
    Promise.all(remoteNames.map(async name => remoteInfo(name, await git(root, ['remote', 'get-url', '--push', '--all', name])))),
    upstream ? git(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']).then(v => v.trim().split(/\s+/).map(Number)) : Promise.resolve([0, 0]),
  ])
  return { branch, head, branches, remotes, upstream, ahead: divergence[0]!, behind: divergence[1]!, dirty: status.length > 0 }
}
async function validBranch(root: string, branch: string) {
  if (typeof branch !== 'string' || !branch || branch.startsWith('-') || branch.includes('@{')) throw new Error('Nom de branche invalide.')
  await git(root, ['check-ref-format', `refs/heads/${branch}`])
}
function selectedRemote(state: GitWorkflowState, name: string, fingerprint?: string) {
  const remote = state.remotes.find(remote => remote.name === name)
  if (!remote || (fingerprint !== undefined && remote.fingerprint !== fingerprint)) throw new Error('Le dépôt distant a changé. Actualisez avant de confirmer.')
  return remote
}
async function gh(root: string, args: string[], command: Command) {
  try {
    const result = await command('gh', args, { cwd: root, timeout: 60000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0' } })
    return String(result.stdout)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('GitHub CLI (gh) indisponible. Installez-le et connectez votre compte avec gh auth login.')
    throw new Error(String((error as { stderr?: string }).stderr || error))
  }
}
function repository(remote: Remote) {
  if (!remote.repository) throw new Error('Les PR nécessitent un dépôt GitHub ou GitHub Enterprise configuré en HTTPS ou SSH.')
  return remote.repository
}
async function readPR(root: string, repo: string, selector: string, command: Command): Promise<WorkflowPR> {
  const pr = JSON.parse(await gh(root, ['pr', 'view', selector, '--repo', repo, '--json', 'number,title,url,state,headRefOid,headRefName,baseRefName,isDraft,statusCheckRollup'], command))
  if (!Number.isSafeInteger(pr.number) || !/^[a-f0-9]{40,64}$/.test(pr.headRefOid) || typeof pr.baseRefName !== 'string' || typeof pr.headRefName !== 'string') throw new Error('Réponse GitHub invalide.')
  return { number: pr.number, title: String(pr.title), url: String(pr.url), state: String(pr.state), headRefOid: pr.headRefOid, headRefName: pr.headRefName, baseRefName: pr.baseRefName, isDraft: Boolean(pr.isDraft), checks: (pr.statusCheckRollup ?? []).map((c: { name?: string; context?: string; conclusion?: string; state?: string; status?: string }) => ({ name: String(c.name ?? c.context ?? 'Contrôle'), state: String(c.conclusion || c.state || c.status || 'PENDING') })) }
}
export async function workflowPR(cwd: string, remote: string, command: Command = run): Promise<WorkflowPR> {
  const root = await rootOf(cwd), state = await gitWorkflowState(root)
  if (!state.branch) throw new Error('Sélectionnez une branche avant de consulter sa PR.')
  return readPR(root, repository(selectedRemote(state, remote)), state.branch, command)
}
export async function gitWorkflowAction(cwd: string, request: WorkflowRequest, command: Command = run): Promise<string> {
  const root = await rootOf(cwd), state = await gitWorkflowState(root)
  if (!request || state.head !== request.expectedHead || state.branch !== request.expectedBranch) throw new Error('La branche ou le commit a changé. Actualisez avant de confirmer.')
  const action = request.action
  if (!action || !['switch', 'branch', 'push', 'create-pr', 'merge-pr'].includes(action.kind)) throw new Error('Action Git inconnue.')
  if (action.kind === 'switch' || action.kind === 'branch') {
    await validBranch(root, action.branch)
    if (state.dirty) throw new Error('Commitez vos modifications avant de changer de branche.')
    if (!state.head) throw new Error('Créez un premier commit avant de changer de branche.')
    if (action.kind === 'switch' && !state.branches.includes(action.branch)) throw new Error('Branche locale introuvable.')
    await git(root, ['switch', '--no-guess', '--no-overwrite-ignore', '--no-recurse-submodules', ...(action.kind === 'branch' ? ['-c'] : []), action.branch])
    return `Branche active : ${action.branch}.`
  }
  if (!state.branch || !state.head) throw new Error('Une branche avec au moins un commit est nécessaire.')
  if (typeof action.fingerprint !== 'string') throw new Error('Confirmation du dépôt distant manquante.')
  const remote = selectedRemote(state, action.remote, action.fingerprint)
  const configuredUrls = await git(root, ['remote', 'get-url', '--push', '--all', remote.name])
  if (hash(configuredUrls) !== action.fingerprint) throw new Error('Le dépôt distant a changé. Actualisez avant de confirmer.')
  const pushUrls = lines(configuredUrls)
  if (pushUrls.length !== 1) throw new Error('Sélectionnez un dépôt distant avec une seule adresse de publication.')
  const pushUrl = pushUrls[0]!
  if (/^https?:\/\/[^/]*@|[?#]/i.test(pushUrl)) throw new Error('Utilisez une adresse distante sans identifiants ni paramètres et le gestionnaire d’identifiants Git.')
  if (action.kind === 'push') {
    // An explicit SHA/refspec prevents a concurrent external checkout from publishing another branch.
    // Override mirror/followTags configuration: only this branch is authorized.
    await git(root, ['-c', `remote.${remote.name}.mirror=false`, 'push', '--no-follow-tags', '--recurse-submodules=no', '--', pushUrl, `${state.head}:refs/heads/${state.branch}`])
    return `Branche ${state.branch} publiée sur ${remote.name}.`
  }
  const repo = repository(remote)
  if (action.kind === 'create-pr') {
    await validBranch(root, action.base)
    if (action.base === state.branch) throw new Error('La branche de destination doit être différente.')
    if (typeof action.title !== 'string' || !action.title.trim() || action.title.length > 256 || typeof action.body !== 'string' || action.body.length > 65000 || typeof action.draft !== 'boolean') throw new Error('Titre ou description de PR invalide.')
    // gh --head explicitly disables automatic pushes/forks; publishing is a separate confirmation.
    const remoteHead = await command('git', ['ls-remote', '--heads', '--', pushUrl, `refs/heads/${state.branch}`], { cwd: root, timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    const published = String(remoteHead.stdout).split(/\s+/)[0]
    if (published !== state.head) throw new Error('Publiez d’abord le commit courant sur ce dépôt distant.')
    const directory = await mkdtemp(join(tmpdir(), 'desktop-pr-'))
    try {
      const body = join(directory, 'body.md')
      await writeFile(body, action.body, { mode: 0o600 })
      const url = await gh(root, ['pr', 'create', '--repo', repo, '--head', state.branch, '--base', action.base, '--title', action.title.trim(), '--body-file', body, ...(action.draft ? ['--draft'] : [])], command)
      return `PR créée : ${url.trim()}`
    } finally { await rm(directory, { recursive: true, force: true }) }
  }
  if (!Number.isSafeInteger(action.number) || action.number < 1 || !['merge', 'squash', 'rebase'].includes(action.method) || !/^[a-f0-9]{40,64}$/.test(action.head)) throw new Error('Demande de fusion invalide.')
  const pr = await readPR(root, repo, String(action.number), command)
  if (pr.state !== 'OPEN' || pr.isDraft || pr.headRefOid !== action.head || pr.headRefName !== state.branch || pr.baseRefName !== action.base) throw new Error('La PR a changé ou ne peut pas être fusionnée. Consultez-la à nouveau.')
  await gh(root, ['pr', 'merge', String(pr.number), '--repo', repo, `--${action.method}`, '--match-head-commit', action.head], command)
  return 'Demande de fusion transmise à GitHub. Consultez la PR pour vérifier la fusion ou sa mise en file.'
}
