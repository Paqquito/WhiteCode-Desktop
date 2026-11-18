import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { desktopTranscript } from '../backend/transcript.js'

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block && typeof block === 'object' && block.type === 'text') return String(block.text ?? '')
  }
  return ''
}

/** User prompts only: tool responses, subagents and internal messages do not change recency. */
export function promptTextOf(record: { message?: { content?: unknown }; isSidechain?: boolean; isMeta?: boolean }): string | null {
  if (record.isSidechain || record.isMeta) return null
  const content = record.message?.content
  if (!content) return null
  if (Array.isArray(content) && content.some(block => block?.type === 'tool_result')) return null
  const text = textOf(content).trim()
  return text && !text.startsWith('<') ? text : null
}

type Summary = { title: string; cwd: string | null; updatedAt: number; bytes: number }
const cache = new Map<string, { mtime: number; summary: Summary }>()

/** Stream once per changed transcript; listing unchanged history only needs stat. */
export async function readTranscriptSummary(file: string): Promise<Summary> {
  const info = await stat(file)
  const cached = cache.get(file)
  if (cached?.mtime === info.mtimeMs && cached.summary.bytes === info.size) return cached.summary
  let title: string | null = null, cwd: string | null = null, lastPromptAt = 0
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      let entry: { type?: string; cwd?: string; timestamp?: string; isSidechain?: boolean; isMeta?: boolean; message?: { content?: unknown } }
      try { entry = desktopTranscript(JSON.parse(line), resolve(dirname(file), '..', '..', 'content')) } catch { continue }
      if (!entry || typeof entry !== 'object') continue
      if (!cwd && typeof entry.cwd === 'string') cwd = entry.cwd
      if (entry.type !== 'user') continue
      const text = promptTextOf(entry)
      if (!text) continue
      title ??= text.replace(/\s+/g, ' ').slice(0, 90)
      const timestamp = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : NaN
      if (Number.isFinite(timestamp)) lastPromptAt = Math.max(lastPromptAt, timestamp)
    }
  } finally { lines.close(); stream.destroy() }
  const summary = { title: title ?? 'Session sans titre', cwd, updatedAt: lastPromptAt || info.birthtimeMs, bytes: info.size }
  // Bound retained summaries without keeping full transcripts in memory.
  if (cache.size >= 2000) cache.delete(cache.keys().next().value!)
  cache.set(file, { mtime: info.mtimeMs, summary })
  return summary
}
