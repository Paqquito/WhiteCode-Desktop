/** Git owns repository semantics; paths are parsed with NUL separators. */
import { execFile, type ExecFileOptions } from 'node:child_process'
import { readFile, stat, realpath } from 'node:fs/promises'
import { join, relative, isAbsolute } from 'node:path'
import { promisify } from 'node:util'
const run = promisify(execFile)
const MAX_OUTPUT = 2 * 1024 * 1024
export type GitFile = { path: string; originalPath?: string; status: string; staged: boolean; added: number; removed: number }
export type GitSummary = { available: false; reason: string } | { available: true; root?: string; branch: string; files: GitFile[] }
export type GitAction = { kind: 'stage' | 'unstage'; path: string } | { kind: 'commit'; message: string }
export type PullRequestInfo = { available: false; reason: string } | { available: true; title: string; url: string; state: string; checks: Array<{ name: string; state: string }> }
export async function git(cwd: string, args: string[]) {
  const { stdout } = await run('git', ['--no-pager', ...args], { cwd, maxBuffer: MAX_OUTPUT, timeout: 30000, windowsHide: true, env: { ...process.env, GIT_PAGER: 'cat', GIT_LITERAL_PATHSPECS: '1', GIT_TERMINAL_PROMPT: '0' } })
  return stdout
}
const failure = (error: unknown) => String((error as { stderr?: string }).stderr || error)
export async function rootOf(cwd: string) { return (await git(cwd, ['rev-parse', '--show-toplevel'])).trim() }
async function counts(cwd: string, staged: boolean) {
  const out = new Map<string, { added: number; removed: number }>()
  const chunks = (await git(cwd, ['diff', '--numstat', '-z', ...(staged ? ['--cached'] : [])])).split('\0')
  for (let i = 0; i < chunks.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(chunks[i]!)
    if (!match) continue
    let path = match[3]!
    if (!path) { i++; path = chunks[++i] ?? '' }
    out.set(path, { added: Number(match[1]) || 0, removed: Number(match[2]) || 0 })
  }
  return out
}
export async function gitSummary(cwd: string): Promise<GitSummary> {
  if (!cwd) return { available: false, reason: 'Aucun dossier de travail.' }
  try {
    const root = await rootOf(cwd)
    const branch = (await git(root, ['symbolic-ref', '--short', 'HEAD']).catch(async () => `HEAD détachée · ${(await git(root, ['rev-parse', '--short', 'HEAD'])).trim()}`)).trim()
    const [raw, staged, unstaged] = await Promise.all([git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']), counts(root, true), counts(root, false)])
    const records = raw.split('\0'), files: GitFile[] = []
    for (let i = 0; i < records.length; i++) {
      const record = records[i]!
      if (record.length < 4) continue
      const x = record[0]!, y = record[1]!, path = record.slice(3)
      const originalPath = /[RC]/.test(x + y) ? records[++i] : undefined
      const add = (status: string, indexed: boolean) => files.push({ path, originalPath, status, staged: indexed, ...((indexed ? staged : unstaged).get(path) ?? { added: 0, removed: 0 }) })
      if (['DD','AU','UD','UA','DU','AA','UU'].includes(x + y)) add('U', false)
      else if (x === '?') add('?', false)
      else { if (x !== ' ') add(x, true); if (y !== ' ') add(y, false) }
    }
    return { available: true, root, branch, files: files.sort((a,b) => a.path.localeCompare(b.path)) }
  } catch (error) {
    const message = failure(error)
    return { available: false, reason: /not a git repository/i.test(message) ? 'Ce dossier n’est pas un dépôt Git.' : /ENOENT/.test(message) ? 'Git ou le dossier de travail est indisponible.' : message }
  }
}
export async function gitFileDiff(cwd: string, path: string, staged: boolean, untracked: boolean): Promise<string> {
  const root = await rootOf(cwd)
  const summary = await gitSummary(root)
  const file = summary.available && summary.files.find(f => f.path === path && f.staged === staged)
  if (!file) throw new Error('Ce fichier ne figure plus dans les modifications. Actualisez le panneau.')
  if (file.status === 'U') throw new Error('Conflit de fusion : ouvrez le fichier pour résoudre les marqueurs, puis indexez la résolution.')
  if (untracked) {
    const target = await realpath(join(root, path)), rel = relative(await realpath(root), target)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Lien hors du dépôt : aperçu refusé.')
    if ((await stat(target)).size > MAX_OUTPUT) throw new Error('Fichier trop volumineux pour le diff.')
    const content = await readFile(target, 'utf8')
    if (content.includes('\0')) throw new Error('Fichier binaire : aperçu textuel indisponible.')
    const lines = content.replace(/\n$/, '').split('\n')
    return ['--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n')
  }
  return git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', ...(staged ? ['--cached'] : []), '--', ...(file.originalPath ? [file.originalPath] : []), path])
}
/** Mutations are explicit and never push, discard files or rewrite history. */
export async function gitAction(cwd: string, action: GitAction): Promise<void> {
  const root = await rootOf(cwd), summary = await gitSummary(root)
  if (!summary.available) throw new Error(summary.reason)
  if (action.kind === 'commit') {
    if (!action.message.trim()) throw new Error('Saisissez un message de commit.')
    if (summary.files.some(f => f.status === 'U')) throw new Error('Résolvez et indexez les conflits avant de committer.')
    if (!summary.files.some(f => f.staged)) throw new Error('Aucun changement indexé.')
    await git(root, ['commit', '-m', action.message.trim()]); return
  }
  if (action.kind !== 'stage' && action.kind !== 'unstage') throw new Error('Action Git inconnue.')
  const file = summary.files.find(f => f.path === action.path && f.staged === (action.kind === 'unstage'))
  if (!file) throw new Error('État du fichier modifié : actualisez le panneau.')
  const paths = [...(file.originalPath ? [file.originalPath] : []), file.path]
  if (action.kind === 'stage') await git(root, ['add', '--', ...paths])
  else {
    const hasHead = await git(root, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false)
    await git(root, hasHead ? ['reset', 'HEAD', '--', ...paths] : ['rm', '--cached', '--', ...paths])
  }
}
/** Only queried on explicit request; no GitHub credentials are changed. */
export async function pullRequest(
  cwd: string,
  command: (file: string, args: string[], options: ExecFileOptions) => Promise<{ stdout: string | Buffer }> = run,
): Promise<PullRequestInfo> {
  try {
    const { stdout } = await command('gh', ['pr', 'view', '--json', 'title,url,state,statusCheckRollup'], { cwd: await rootOf(cwd), timeout: 20000, maxBuffer: MAX_OUTPUT, windowsHide: true, env: { ...process.env, GH_PROMPT_DISABLED: '1' } })
    const pr = JSON.parse(String(stdout))
    return { available: true, title: String(pr.title), url: String(pr.url), state: String(pr.state), checks: (pr.statusCheckRollup ?? []).map((c: any) => ({ name: String(c.name ?? c.context ?? 'Contrôle'), state: String(c.conclusion || c.state || c.status || 'En attente') })) }
  } catch (error) { return { available: false, reason: /ENOENT/.test(failure(error)) ? 'GitHub CLI (gh) indisponible. Installez-le et connectez votre compte pour consulter les PR.' : `PR indisponible : ${failure(error)}` } }
}
