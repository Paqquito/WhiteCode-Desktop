import * as React from 'react'
import type { SessionOrigin } from '../../shared/sessionOrigin.js'

/** Même provenance dans l'historique et la session ouverte. */
export function RoutineOrigin({ origin, detailed = false }: {
  origin?: SessionOrigin
  detailed?: boolean
}): React.ReactNode {
  if (!origin) return null
  const date = new Date(origin.firedAt).toLocaleString('fr-FR')
  const description = `Lancée par la routine ${origin.routineId} le ${date} · Rythme : ${origin.cron}`
  return <span className="routine-origin" title={description} aria-label={description}>
    Routine{detailed && <> · <time dateTime={new Date(origin.firedAt).toISOString()}>{date}</time></>}
  </span>
}
