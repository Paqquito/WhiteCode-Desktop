/**
 * Ce que la ligne ne montre plus.
 *
 * La ligne est réduite à un titre sur une seule ligne, tronqué — c'est ce qui
 * rend une liste longue parcourable du regard. Tout ce qui a été retiré se
 * retrouve ici au survol : le titre entier, la dernière activité, le dossier
 * et la branche.
 *
 * ## Une carte, et non l'infobulle du système
 *
 * `title=""` aurait coûté une ligne. Trois raisons de ne pas s'en contenter :
 * elle n'apparaît qu'après un délai qu'on ne choisit pas, elle ne met rien en
 * forme — quatre informations y deviennent un pavé —, et elle est coupée par
 * le bord de la fenêtre sans possibilité de la replacer.
 *
 * Position calculée en coordonnées de fenêtre plutôt qu'en `position:
 * absolute` dans la ligne : la barre latérale défile et masque ce qui déborde,
 * une carte posée dedans serait tronquée par son propre conteneur.
 *
 * ## Ancrée sur la barre, pas sur la ligne
 *
 * La carte se posait au bord droit de la **ligne** survolée. Tant qu'une ligne
 * déborde — et elles débordaient —, la carte part avec elle et se retrouve au
 * milieu de l'écran, détachée de ce qu'elle décrit. Le bord de la barre
 * latérale, lui, est le même pour toutes les lignes et suit la poignée de
 * redimensionnement : c'est le seul repère stable.
 */

import * as React from 'react'
import { Icon } from '../ui/Icon.js'
import { ago } from './ago.js'
import { useBranch } from './useBranch.js'

/** Marge au bord de fenêtre, pour que la carte ne colle jamais au vide. */
const BORD = 10
/** Écart entre la barre latérale et la carte. */
const ECART = 8

export type CardAnchor = {
  /** Bord droit de la barre latérale, en coordonnées de fenêtre. */
  sidebarRight: number
  /** Haut de la ligne survolée. */
  rowTop: number
}

/**
 * Où poser la carte, d'après la barre et la hauteur mesurée de la carte.
 *
 * Sortie du composant pour être éprouvable : une position se vérifie par des
 * nombres, pas en regardant l'écran.
 */
export function placeCard(
  anchor: CardAnchor,
  cardHeight: number,
  viewportHeight: number,
): { left: number; top: number } {
  // Remontée quand la carte dépasserait le bas ; jamais au-dessus du haut,
  // sinon une carte plus haute que la fenêtre deviendrait illisible par le
  // haut au lieu de l'être par le bas.
  const max = viewportHeight - cardHeight - BORD
  return {
    left: anchor.sidebarRight + ECART,
    top: Math.max(BORD, Math.min(anchor.rowTop, max)),
  }
}

export function SessionHoverCard({
  anchor,
  title,
  project,
  cwd,
  updatedAt,
}: {
  anchor: CardAnchor
  title: string
  project: string
  cwd: string
  updatedAt: number
}): React.ReactNode {
  const branch = useBranch(cwd, true)
  const ref = React.useRef<HTMLDivElement>(null)
  const [place, setPlace] = React.useState(() => placeCard(anchor, 0, window.innerHeight))

  // Mesurée après le premier rendu : la hauteur dépend du texte, et la ligne
  // de branche peut s'ajouter une fois Git interrogé.
  React.useLayoutEffect(() => {
    const update = () => {
      const next = placeCard(anchor, ref.current?.offsetHeight ?? 0, window.innerHeight)
      next.left = Math.max(10, Math.min(next.left, window.innerWidth - (ref.current?.offsetWidth ?? 320) - 10))
      setPlace(next)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [anchor, branch])

  return (
    <div
      ref={ref}
      className="session-card"
      role="tooltip"
      style={{ left: place.left, top: place.top }}
    >
      <p className="session-card-title">{title}</p>
      <p className="session-card-line">
        <Icon name="folder" size={12} />
        <span>{project}</span>
      </p>
      {(
        <p className="session-card-line">
          <Icon name="branch" size={12} />
          <span>{branch ?? "—"}</span>
        </p>
      )}
      <p className="session-card-line">
        <Icon name="history" size={12} />
        <span>{ago(updatedAt)}</span>
      </p>
    </div>
  )
}
