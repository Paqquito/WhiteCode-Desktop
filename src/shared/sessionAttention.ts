export type AttentionPhase = 'idle' | 'working' | 'waiting' | 'done' | 'interrupted' | 'failed'
export type SessionAttention = {
  phase: AttentionPhase
  startedAt: number | null
  endedAt: number | null
  lastActivityAt: number | null
  unread: boolean
  /** Increases only for a new permission or terminal outcome, not streaming tokens. */
  eventId: number
}

export const INITIAL_ATTENTION: SessionAttention = {
  phase: 'idle', startedAt: null, endedAt: null, lastActivityAt: null, unread: false, eventId: 0,
}

export const ATTENTION_LABELS: Record<AttentionPhase, string> = {
  idle: 'Inactif', working: 'En cours', waiting: 'Réponse requise',
  done: 'Terminé', interrupted: 'Interrompu', failed: 'En erreur',
}

export function elapsedLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes} min ${seconds % 60} s` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}
