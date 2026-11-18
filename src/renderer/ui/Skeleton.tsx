/**
 * Lignes d'attente pendant un chargement.
 *
 * Une liste qui apparaît vide puis se remplit fait croire, un instant, qu'il
 * n'y a rien. Des lignes grisées de la forme de celles qui arrivent disent
 * « ça vient » sans déplacer la page à l'arrivée. Le texte reste annoncé aux
 * lecteurs d'écran.
 */

import * as React from 'react'

export function SkeletonRows({ count = 3, label }: { count?: number; label: string }): React.ReactNode {
  return <div className="skeleton-rows" role="status" aria-label={label}>
    {Array.from({ length: count }, (_, index) => <div key={index} className="skeleton-row" aria-hidden="true">
      <span className="skeleton-bar" style={{ width: `${55 - index * 9}%` }} />
      <span className="skeleton-bar short" />
    </div>)}
  </div>
}
