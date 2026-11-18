/**
 * Menu contextuel d'une conversation.
 *
 * Quatre groupes séparés, et la séparation porte du sens : ce qui change la
 * conversation, ce qui la copie ou la révèle, ce qui en repart, ce qui change
 * de fenêtre. Un menu de douze entrées d'affilée ne se lit pas.
 *
 * ## Une entrée désactivée plutôt qu'absente
 *
 * « Ouvrir dans une nouvelle fenêtre » est là, grisée, avec sa raison. Le
 * processus principal ne tient **qu'une** fenêtre : `toRenderer`, les
 * terminaux et les notifications visent tous la même variable. Ouvrir la
 * seconde demanderait de donner un propriétaire à chacun de ces flux, ce qui
 * est un chantier et non une entrée de menu. La masquer laisserait croire
 * qu'elle n'a pas été pensée.
 */

import * as React from 'react'
import { focusInside } from '../ui/inputModality.js'
import { Icon, type IconName } from '../ui/Icon.js'

export type MenuEntry = {
  label: string
  /** Renseigné : l'entrée est grisée et la raison s'affiche. */
  disabled?: string
  onClick?: () => void
  checked?: boolean
  icon?: IconName
}

export function SessionMenu({
  groups,
  at,
  onClose,
  anchor,
}: {
  /** Groupes séparés par un filet ; les vides sont ignorés. */
  groups: MenuEntry[][]
  /** Position du clic, en coordonnées de fenêtre. */
  at: { x: number; y: number }
  onClose: () => void
  anchor?: React.RefObject<HTMLButtonElement | null>
}): React.ReactNode {
  const ref = React.useRef<HTMLDivElement>(null)
  const [place, setPlace] = React.useState(at)

  // Replacé après mesure : un clic droit près du bord bas ou droit ferait
  // sortir le menu de la fenêtre, où il est inatteignable.
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    focusInside(el.querySelector<HTMLButtonElement>('button:not(:disabled)'), { preventScroll: true })
    setPlace({
      x: Math.max(8, Math.min(at.x, window.innerWidth - el.offsetWidth - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - el.offsetHeight - 8)),
    })
  }, [at.x, at.y])

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && !anchor?.current?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') { if (event.key === 'Escape') event.preventDefault(); onClose(); return }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        items[next]?.focus({ preventScroll: true })
      }
    }
    // En capture : le menu doit se fermer même si la zone visée arrête la
    // propagation pour son propre compte.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    // Un défilement laisserait le menu accroché au vide, loin de sa ligne.
    const onScroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose, anchor])

  const visibles = groups.filter(g => g.length > 0)

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: place.x, top: place.y }}
    >
      {visibles.map((group, index) => (
        <React.Fragment key={index}>
          {index > 0 && <div className="menu-separator" role="separator" />}
          {group.map(entry => (
            <button
              key={entry.label}
              type="button"
              role={entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={entry.checked}
              className="menu-item"
              disabled={Boolean(entry.disabled)}
              title={entry.disabled}
              onClick={() => {
                onClose()
                entry.onClick?.()
              }}
            >
              {entry.icon && <Icon name={entry.icon} size={16} />}
              <span className="menu-item-body">
                <span className="menu-item-label">{entry.label}</span>
                {entry.disabled && (
                  <span className="menu-item-hint">{entry.disabled}</span>
                )}
              </span>
              {entry.checked && <Icon name="check" size={14} />}
            </button>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}
