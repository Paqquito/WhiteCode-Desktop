/**
 * Barre d'état.
 *
 * Elle n'apparaît que lorsqu'elle a quelque chose à dire : une réponse en
 * cours, une autorisation attendue, une erreur. Au repos, elle affichait
 * « Inactif » et un identifiant de session — une ligne entière pour une
 * information nulle, qu'on finissait par ne plus voir le jour où elle
 * comptait.
 */

import * as React from 'react'
import type { SessionStatus } from '../../shared/protocol.js'
import type { AttentionPhase, SessionAttention } from '../../shared/sessionAttention.js'
import { SessionActivity } from './SessionActivity.js'

const VISIBLE: ReadonlySet<AttentionPhase> = new Set(['working', 'waiting', 'failed'])

export function StatusBar({
  status,
  attention,
}: {
  status: SessionStatus
  attention: SessionAttention
}): React.ReactNode {
  if (!status.busy && !VISIBLE.has(attention.phase)) return null
  // Le moteur peut se déclarer occupé avant que l'état d'attention ne suive :
  // afficher « Inactif » sur une barre qui n'existe que pendant l'activité
  // serait contradictoire.
  const shown: SessionAttention = status.busy && attention.phase === 'idle' ? { ...attention, phase: 'working' } : attention
  return (
    <div className={`status phase-${shown.phase}`}>
      <span className={status.busy ? 'dot busy' : 'dot'} />
      <SessionActivity attention={shown} />

      {/* Coût poussé à droite : information de contrôle, pas de navigation. */}
      {status.totalCostUsd > 0 && (
        <span className="muted status-cost">
          ${status.totalCostUsd.toFixed(4)}
        </span>
      )}
    </div>
  )
}
