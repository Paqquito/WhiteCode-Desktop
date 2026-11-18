import * as React from 'react'
import { ATTENTION_LABELS, elapsedLabel, type SessionAttention } from '../../shared/sessionAttention.js'

export function SessionActivity({ attention }: { attention: SessionAttention }): React.ReactNode {
  const [now, setNow] = React.useState(Date.now)
  const running = attention.startedAt !== null && attention.endedAt === null
  React.useEffect(() => {
    setNow(Date.now())
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running, attention.startedAt])
  const duration = attention.startedAt === null ? null
    : elapsedLabel((attention.endedAt ?? now) - attention.startedAt)
  return (
    <span className={`session-activity phase-${attention.phase}`}>
      <span className="activity-label">{ATTENTION_LABELS[attention.phase]}{attention.unread ? ' · Non consulté' : ''}</span>
      {duration && <span className="activity-duration"> · {duration}</span>}
      {attention.lastActivityAt !== null && (
        <span className="activity-time">Activité à <time dateTime={new Date(attention.lastActivityAt).toISOString()}>
          {new Date(attention.lastActivityAt).toLocaleTimeString('fr-FR')}
        </time></span>
      )}
    </span>
  )
}
