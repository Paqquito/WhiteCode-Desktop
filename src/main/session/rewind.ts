/** File restoration through WhiteCode's public CLI; never contacts a model. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { backendCommand, backendEnvironment, distribution } from '../backend/launch.js'
import { readFile, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { projectKey } from '../backend/transcript.js'
import { diffLines, countChanges } from '../../renderer/diff/model.js'

export type RewindResult = { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number; fingerprint?: string; conflicts?: string[] }
export type RewindOptions = { appRoot: string; engineRoot: string; cwd: string; configDir: string; sessionId: string; messageId: string; dryRun: boolean; signal?: AbortSignal; timeoutMs?: number; fingerprint?: string }

export async function rewindFiles(options: RewindOptions): Promise<RewindResult> {
  try {
    const id = distribution(options.appRoot), command = backendCommand(options.engineRoot, id)
    if (options.fingerprint !== undefined && !/^[a-f0-9]{16}$/.test(options.fingerprint)) throw new Error('Empreinte de restauration invalide.')
    const args = [...command.args, '--non-interactive', '--reopen=' + options.sessionId, '--restore-files', options.messageId, '--result-format', 'json', ...(options.dryRun ? ['--dry-run'] : []), ...(!options.dryRun && options.fingerprint ? ['--allow-external-overwrite', options.fingerprint] : [])]
    const { stdout } = await promisify(execFile)(command.file, args, { cwd: options.cwd, windowsHide: true, timeout: options.timeoutMs ?? 30000, maxBuffer: 2 * 1024 * 1024, signal: options.signal,
      env: { ...process.env, ...backendEnvironment(id, options.configDir, 'http://127.0.0.1', 'unused-for-restore') } })
    const plan = JSON.parse(stdout)
    const incomplete = [...(plan.unavailable ?? []), ...(plan.unsupported ?? []), ...(plan.removed ?? [])]
    if (incomplete.length || plan.outcome?.failed?.length) return { canRewind: false, error: [...incomplete, ...(plan.outcome?.failed ?? [])].map((entry: any) => entry.path + ' : ' + entry.reason).join('\n') }
    const operations = [...(plan.operations ?? []), ...(plan.conflicts ?? [])]
    let added = 0, removed = 0, measured = options.dryRun
    if (options.dryRun) for (const operation of operations) {
      try {
        const bytes = async (state: any, current: boolean): Promise<string> => {
          if (state.kind === 'absent') return ''
          if (state.kind !== 'file' || !/^[a-f0-9]{64}$/.test(state.hash)) throw new Error('Non-text file')
          const file = current ? operation.path : join(options.configDir, 'sessions', projectKey(options.cwd), options.sessionId, 'file-history', state.hash)
          const info = await lstat(file)
          if (!info.isFile() || info.isSymbolicLink() || info.size > 20 * 1024 * 1024) throw new Error('Invalid file')
          const value = await readFile(file)
          if (createHash('sha256').update(value).digest('hex') !== state.hash || value.includes(0)) throw new Error('Changed or binary file')
          return value.toString('utf8')
        }
        const counts = countChanges(diffLines(await bytes(operation.current, true), await bytes(operation.target, false)))
        added += counts.added; removed += counts.removed
      } catch { measured = false }
    }
    return { canRewind: true, filesChanged: operations.map((entry: any) => entry.path), fingerprint: plan.fingerprint, conflicts: (plan.conflicts ?? []).map((entry: any) => entry.path), ...(measured ? { insertions: added, deletions: removed } : {}) }
  } catch (error) {
    const failure = error as { stderr?: string; message?: string }
    return { canRewind: false, error: (failure.stderr || failure.message || 'Restauration WhiteCode indisponible.').slice(-2000) }
  }
}
