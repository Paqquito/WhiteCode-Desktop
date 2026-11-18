/**
 * Carte de survol d'un projet.
 *
 * Même ancrage que celle des conversations — au bord de la barre latérale, pas
 * à celui de la ligne — pour la même raison : c'est le seul repère qui ne
 * bouge pas d'une ligne à l'autre.
 *
 * Elle montre le **chemin complet**, qui est la seule chose distinguant deux
 * projets portant le même nom de dossier. La ligne, elle, ne peut pas
 * l'afficher : un chemin absolu ne tient pas dans une barre latérale, et le
 * tronquer par la fin cache précisément ce qui les différencie.
 */

import * as React from 'react'
import { Icon } from '../ui/Icon.js'
import { placeCard, type CardAnchor } from './SessionHoverCard.js'
import { useBranch } from './useBranch.js'

export function ProjectHoverCard({
  anchor,
  name,
  cwd,
  sessions,
  onEdit,
  onEnter,
  onLeave,
}: {
  anchor: CardAnchor
  name: string
  cwd: string
  sessions: number
  onEdit: () => void
  /**
   * Souris entrée dans la carte.
   *
   * Contrairement à celle des conversations, cette carte porte une action :
   * elle doit survivre au trajet qui l'y amène. L'écart entre la barre et la
   * carte fait sortir de la ligne, donc la fermeture est différée et annulée
   * ici.
   */
  onEnter: () => void
  onLeave: () => void
}): React.ReactNode {
  const branch = useBranch(cwd, true)
  const ref = React.useRef<HTMLDivElement>(null)
  const [place, setPlace] = React.useState(() => placeCard(anchor, 0, window.innerHeight))

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
      className="session-card project-card"
      role="tooltip"
      style={{ left: place.left, top: place.top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <p className="session-card-title">
        <Icon name="folder" size={13} />
        <span>{name}</span>
      </p>
      <p className="session-card-line">
        <Icon name="chat" size={12} />
        <span>
          {sessions} conversation{sessions > 1 ? 's' : ''}
        </span>
      </p>
      {(
        <p className="session-card-line">
          <Icon name="branch" size={12} />
          <span>{branch ?? "—"}</span>
        </p>
      )}
      {/* Le chemin sur sa propre ligne, coupé aux séparateurs : un chemin
          Windows n'a pas d'espace où le navigateur puisse le replier. */}
      <p className="session-card-path" title={cwd}>{cwd}</p>
      <button type="button" className="session-card-action" onClick={onEdit}>
        <Icon name="settings" size={12} />
        <span>Modifier le projet</span>
      </button>
    </div>
  )
}
