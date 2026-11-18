import * as React from 'react'
import type { AttentionPhase } from '../../shared/sessionAttention.js'

/** A fixed-size state marker; its explanation is available on hover and to screen readers. */
export function SessionIndicator({ phase = 'idle', unread = false }: { phase?: AttentionPhase; unread?: boolean }): React.ReactNode {
  const state = phase === 'failed' || phase === 'waiting' || phase === 'working' ? phase : unread ? 'unread' : 'idle'
  const label = { working: 'En cours', unread: 'Nouvelle réponse', idle: 'Inactif', failed: 'Une erreur est survenue', waiting: 'Réponse requise' }[state]
  return <span className={`session-indicator indicator-${state}`} role="img" aria-label={label} title={label}>
    {state === 'working' ? <svg className="session-orbit" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".25" />
      <circle cx="8" cy="3" r="2" fill="currentColor" />
    </svg> : state === 'waiting' ? <span className="session-indicator-dot" />
    : state === 'failed' ? <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.1 2.4a1 1 0 0 1 1.8 0l5.5 10a1 1 0 0 1-.9 1.5h-11a1 1 0 0 1-.9-1.5Z M8 6v3 M8 11.5h.01" />
    </svg> : <span className="session-indicator-dot" />}
  </span>
}
