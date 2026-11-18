/**
 * Champ de formulaire : intitulé, contrôle, indication.
 *
 * Ce composant existait déjà — privé dans `ProviderSettings`, où il servait
 * huit fois — pendant que `CorpusSettings` réécrivait la même structure à la
 * main deux fois de plus. C'est la forme ordinaire de la duplication dans ce
 * dépôt : non pas l'absence d'abstraction, mais une abstraction gardée trop
 * près de son premier usage.
 *
 * Le `<label>` enveloppe le contrôle : l'association vaut sans `htmlFor` ni
 * `id`, donc sans identifiant à inventer ni risque d'en réutiliser un.
 */

import * as React from 'react'

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  /** Accepte du JSX : certaines indications portent des insécables. */
  hint?: React.ReactNode
  children: React.ReactNode
}): React.ReactNode {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}
