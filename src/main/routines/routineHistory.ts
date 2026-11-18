import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { projectDataDirectory } from '#desktop/project-paths'
import { randomUUID } from 'node:crypto'

export type RoutineRun = {
  id: string
  routineId: string
  prompt: string
  firedAt: number
  status: 'starting' | 'launched' | 'failed' | 'completed' | 'cancelled'
  sessionId?: string
  error?: string
}
const queues = new Map<string, Promise<unknown>>()
export async function readRoutineHistory(cwd: string): Promise<RoutineRun[]> {
  try {
    const rows: unknown = JSON.parse(
      await readFile(join(projectDataDirectory(cwd), 'routine_history.json'), 'utf8'),
    )
    if (
      !Array.isArray(rows) ||
      !rows.every(
        (row) =>
          row &&
          typeof row.id === 'string' &&
          typeof row.routineId === 'string' &&
          typeof row.prompt === 'string' &&
          Number.isFinite(row.firedAt) &&
          ['starting', 'launched', 'failed', 'completed', 'cancelled'].includes(
            row.status,
          ),
      )
    )
      throw new Error(
        'Historique des routines illisible ; le fichier a été conservé.',
      )
    return rows
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
export async function saveRoutineRun(
  cwd: string,
  run: RoutineRun,
): Promise<void> {
  const next = (queues.get(cwd) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const rows = await readRoutineHistory(cwd)
      const updated = [run, ...rows.filter((r) => r.id !== run.id)]
        .sort((a, b) => b.firedAt - a.firedAt)
        .slice(0, 100)
      const directory = projectDataDirectory(cwd)
      await mkdir(directory, { recursive: true })
      const target = join(directory, 'routine_history.json'),
        temporary = `${target}.${randomUUID()}.tmp`
      await writeFile(temporary, JSON.stringify(updated, null, 2) + '\n')
      await rename(temporary, target)
    })
  queues.set(cwd, next)
  try {
    await next
  } finally {
    if (queues.get(cwd) === next) queues.delete(cwd)
  }
}
