import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { PersonalActivity } from '../../shared/personalActivity.js'
import { promptTextOf } from '#desktop/session-history'
import { desktopTranscript } from '../backend/transcript.js'

const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** Read on demand, serially and by line; never start a model or persist a second history. */
export async function readPersonalActivity(root: string, period: unknown, enabled: boolean, now = new Date()): Promise<PersonalActivity> {
  if (!enabled) throw new Error('Le bilan local est désactivé dans les modules optionnels.')
  if (period !== 7 && period !== 30 && period !== 90) throw new Error('Période invalide : choisir 7, 30 ou 90 jours.')
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - period + 1)
  const days = Array.from({ length: period }, (_, index) => {
    const date = new Date(start)
    date.setDate(date.getDate() + index)
    return { date: dayKey(date), messages: 0 }
  })
  const byDate = new Map(days.map(day => [day.date, day]))
  const result: PersonalActivity = { generatedAt: now.getTime(), sessions: 0, messages: 0, activeDays: 0, ignoredEntries: 0, unreadableFiles: 0, days }
  const projects = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw new Error('Impossible de lire l’historique local.')
  })
  for (const project of projects) {
    if (!project.isDirectory()) continue
    const directory = join(root, project.name)
    const files = await readdir(directory, { withFileTypes: true }).catch(() => { result.unreadableFiles++; return [] })
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
      const seen = new Set<string>()
      let active = false
      const input = createReadStream(join(directory, file.name), { encoding: 'utf8' })
      const lines = createInterface({ input, crlfDelay: Infinity })
      try {
        for await (const line of lines) {
          if (!line.trim()) continue
          let entry
          try { entry = desktopTranscript(JSON.parse(line)) } catch { result.ignoredEntries++; continue }
          if (!entry || entry.type !== 'user' || entry.isMeta || entry.parent_tool_use_id || !promptTextOf(entry)) continue
          const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
          if (!Number.isFinite(timestamp)) { result.ignoredEntries++; continue }
          if (timestamp < start.getTime() || timestamp > now.getTime()) continue
          if (typeof entry.uuid === 'string') {
            if (seen.has(entry.uuid)) continue
            seen.add(entry.uuid)
          }
          const day = byDate.get(dayKey(new Date(timestamp)))
          if (day) { day.messages++; result.messages++; active = true }
        }
      } catch { result.unreadableFiles++ }
      finally { lines.close(); input.destroy() }
      if (active) result.sessions++
    }
  }
  result.activeDays = days.filter(day => day.messages > 0).length
  return result
}
