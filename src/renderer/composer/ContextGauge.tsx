/**
 * Occupation de la fenêtre de contexte.
 *
 * Le chiffre qui décide s'il faut relancer une session : quand le contexte
 * sature, le moteur compacte, et une conversation compactée perd du détail.
 * Voir venir la saturation permet de couper au bon moment, plutôt que de
 * s'apercevoir après coup que le modèle a oublié le début.
 *
 * Mesuré au dernier tour, donc en retard d'un message — c'est le seul moment
 * où le moteur rapporte l'usage. La barre reste vide tant qu'aucun tour n'a
 * eu lieu, plutôt que d'afficher un zéro qui aurait l'air d'une mesure.
 */

import * as React from 'react'
import type { SessionStatus } from '#desktop/session-protocol'

/** Seuil à partir duquel la saturation devient une information à agir. */
const WARN = 0.7
const CRITICAL = 0.9

/**
 * Écriture courte d'un nombre de jetons.
 *
 * La décimale ne sert qu'en dessous de cent mille : « 15,3k » informe, « 200,0k »
 * ajoute un chiffre qui ne varie jamais et allonge la ligne pour rien.
 */
function compact(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  if (tokens < 1_000_000) {
    const thousands = tokens / 1000
    return thousands >= 100
      ? `${Math.round(thousands)}k`
      : `${thousands.toFixed(1)}k`
  }
  const millions = tokens / 1_000_000
  return `${millions.toFixed(millions >= 10 ? 0 : 1).replace(/\.0$/, '')}M`
}

export function ContextGauge({
  status,
}: {
  status: SessionStatus
}): React.ReactNode {
  const { contextTokens, contextLimit } = status
  if (contextTokens === null || !contextLimit) return null

  const ratio = Math.min(1, contextTokens / contextLimit)
  const percent = Math.round(ratio * 100)
  const tone = ratio >= CRITICAL ? 'critical' : ratio >= WARN ? 'warn' : ''

  return (
    <span
      className={`context ${tone}`}
      title={`Contexte : ${contextTokens.toLocaleString('fr-FR')} jetons sur ${contextLimit.toLocaleString('fr-FR')}, mesuré à la dernière réponse`}
    >
      <span className="context-bar" aria-hidden="true">
        <span className="context-fill" style={{ width: `${percent}%` }} />
      </span>
      <span className="context-text">
        {compact(contextTokens)} / {compact(contextLimit)}
      </span>
    </span>
  )
}
