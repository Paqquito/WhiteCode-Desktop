import * as React from 'react'
import { useSessionState } from './useSessionState.js'

export type SavedDraft = { id: string; workspace: string; chat?: boolean; transcriptId: string | null; text: string; updatedAt: number }
const KEY = 'desktop:drafts:v1'
export function readDrafts(): SavedDraft[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(data) ? data.filter((d): d is SavedDraft => d && typeof d.id === 'string' && typeof d.workspace === 'string' && typeof d.text === 'string' && d.text.trim() && (d.transcriptId === null || typeof d.transcriptId === 'string') && typeof d.updatedAt === 'number') : []
  } catch { return [] }
}
function writeDrafts(drafts: SavedDraft[]): boolean {
  try { localStorage.setItem(KEY, JSON.stringify(drafts)); return true } catch { return false }
}

/** Desktop ids die with the process; transcript ids survive it. Unsent sessions
 * have no transcript yet. Their drafts remain recoverable in the same Code
 * folder, or from another standalone chat after restarting the application. */
export function useDraft(id: string | null, transcriptId: string | null, workspace: string, liveSessionIds: readonly string[] = [], chat = false) {
  const stored = readDrafts()
  const saved = stored.find(d => d.workspace === workspace && (d.id === id || (transcriptId && d.transcriptId === transcriptId)))
  const [draft, update] = useSessionState(id, saved?.text ?? '')
  const [saveFailed, setSaveFailed] = React.useState(false)
  React.useEffect(() => {
    if (!id || !workspace) return
    const others = readDrafts().filter(d => !(d.workspace === workspace && (d.id === id || (transcriptId && d.transcriptId === transcriptId))))
    setSaveFailed(!writeDrafts(draft.trim() ? [...others, { id, workspace, chat, transcriptId, text: draft, updatedAt: Date.now() }] : others))
  }, [id, workspace, chat, transcriptId, draft])
  const recovered = stored.filter(d => (d.workspace === workspace || chat && d.chat === true && d.transcriptId === null)
    && d.id !== id && !liveSessionIds.includes(d.id) && (!transcriptId || d.transcriptId !== transcriptId)).sort((a, b) => b.updatedAt - a.updatedAt)
  const recover = (item: SavedDraft) => {
    if (!id) return
    // Write the new owner and remove the orphan in a single storage update.
    const others = readDrafts().filter(d => d.id !== item.id && d.id !== id)
    const text = draft.trim() ? `${draft}\n\n${item.text}` : item.text
    const success = writeDrafts([...others, { id, workspace, chat, transcriptId, text, updatedAt: Date.now() }])
    setSaveFailed(!success)
    update(text)
  }
  return { draft, setDraft: update, recovered, saveFailed, recover }
}
