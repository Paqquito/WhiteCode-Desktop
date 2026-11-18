/**
 * Menu déroulant.
 *
 * Sert aux sélecteurs du composeur — mode, modèle, effort — et à ceux des
 * en-têtes de panneaux.
 *
 * ## Le sens d'ouverture est mesuré, pas décidé d'avance
 *
 * Un menu ancré en bas de fenêtre doit s'ouvrir vers le haut, un menu ancré en
 * haut vers le bas. Choisir une fois pour toutes revient à en casser la moitié :
 * le sélecteur de machine du terminal, en haut de son panneau, sortait par le
 * haut de la fenêtre et devenait inatteignable. La place disponible est donc
 * mesurée à l'ouverture, et le menu se place du côté où il tient.
 *
 * ## La hauteur aussi est mesurée
 *
 * Le sens seul ne suffit pas. Le menu des permissions se coupait en pleine
 * description alors qu'il avait 880 px de libre au-dessus de lui : une
 * `max-height` fixe le tronquait sans rapport avec la place réelle. La hauteur
 * est donc déduite du même mesurage que le sens, et le plafond ne sert plus
 * qu'à empêcher un menu long — la liste des modèles — de couvrir la fenêtre.
 *
 * ## L'entrée courante est amenée dans la vue
 *
 * Quand la liste défile malgré tout, l'ouvrir en haut cache le choix en cours
 * s'il est en bas : l'utilisateur ne voit pas ce qu'il a déjà choisi. La valeur
 * courante prend le focus à l'ouverture, ce qui la fait défiler sous les yeux
 * et donne son point de départ au parcours au clavier.
 *
 * Fermeture au clic extérieur et à Échap. Les deux, et pas seulement le clic :
 * un menu qu'on ne peut refermer qu'en visant ailleurs est une impasse au
 * clavier.
 */

import * as React from 'react'
import { focusInside } from './inputModality.js'
import { Icon, type IconName } from './Icon.js'

export type MenuOption<T> = {
  id: T
  label: string
  hint?: string
  /**
   * Entrée détachée du reste, en pied de liste.
   *
   * Sert à ce qui n'est pas du même ordre que les autres choix — un mode qui
   * lève toutes les gardes n'est pas un mode parmi d'autres, et le présenter
   * comme tel invite à le choisir par mégarde.
   */
  apart?: boolean
}

/** Marge conservée entre la liste et le bord de fenêtre. */
const EDGE = 8
/** Écart entre le bouton et sa liste, tenu identique en CSS. */
const GAP = 6
/**
 * Plafond de hauteur.
 *
 * N'existe que pour les listes vraiment longues — les modèles. Il ne doit
 * jamais devenir la raison pour laquelle une liste courte se coupe.
 */
const CEILING = 560
/** En deçà, une liste n'a plus assez de corps pour qu'on s'y repère. */
const FLOOR = 140

export type MenuPlacement = { direction: 'up' | 'down'; maxHeight: number }

/**
 * Sens d'ouverture et hauteur utile, d'après la place réelle autour du bouton.
 *
 * Vers le haut par défaut — c'est le cas du composeur, le plus fréquent — mais
 * vers le bas dès que le dessus n'offre pas de quoi afficher la liste. Quand
 * aucun des deux côtés ne suffit, on prend le plus grand : mieux vaut une liste
 * qui défile qu'une liste coupée.
 */
export function placeMenu({
  anchorTop,
  anchorBottom,
  viewportHeight,
  optionCount,
}: {
  anchorTop: number
  anchorBottom: number
  viewportHeight: number
  optionCount: number
}): MenuPlacement {
  // Hauteur plausible d'une entrée, étiquette et description comprises.
  const needed = optionCount * 46 + 16
  const above = Math.max(0, anchorTop - GAP - EDGE)
  const below = Math.max(0, viewportHeight - anchorBottom - GAP - EDGE)
  const direction =
    above >= needed || above >= below ? ('up' as const) : ('down' as const)
  const space = direction === 'up' ? above : below
  return { direction, maxHeight: Math.max(FLOOR, Math.min(CEILING, space)) }
}

export function Menu<T extends string | null>({
  label,
  icon,
  options,
  value,
  title,
  align = 'left',
  numbered = false,
  onChange,
}: {
  /** Ce qu'affiche le bouton quand le menu est fermé. */
  label: string
  icon?: IconName
  options: Array<MenuOption<T>>
  value: T
  title?: string
  align?: 'left' | 'right'
  /** Numérote les entrées, comme un raccourci le ferait. */
  numbered?: boolean
  onChange: (id: T) => void
}): React.ReactNode {
  const [open, setOpen] = React.useState(false)
  /** Sens et hauteur, mesurés à l'ouverture puis à chaque redimensionnement. */
  const [placement, setPlacement] = React.useState<MenuPlacement>({
    direction: 'up',
    maxHeight: CEILING,
  })
  const rootRef = React.useRef<HTMLDivElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  const measure = React.useCallback(() => {
    const anchor = rootRef.current?.getBoundingClientRect()
    if (!anchor) return
    setPlacement(
      placeMenu({
        anchorTop: anchor.top,
        anchorBottom: anchor.bottom,
        viewportHeight: window.innerHeight,
        optionCount: options.length,
      }),
    )
  }, [options.length])

  // La valeur courante prend le focus à l'ouverture : elle défile ainsi dans la
  // vue même quand la liste est plus longue que la place, et le clavier part
  // d'où l'utilisateur en est plutôt que du haut.
  React.useEffect(() => {
    if (!open) return
    const list = listRef.current
    const current = list?.querySelector<HTMLButtonElement>(
      'button[aria-checked="true"]',
    )
    focusInside(current ?? list?.querySelector<HTMLButtonElement>('button'))
  }, [open])

  React.useEffect(() => {
    if (!open) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, measure])

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      // Flèches, Origine et Fin : sans elles, une liste qui défile ne se
      // parcourt qu'à la souris, et son bas reste hors d'atteinte.
      const items = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
      )
      if (!items.length) return
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      const to =
        event.key === 'ArrowDown'
          ? (at + 1) % items.length
          : event.key === 'ArrowUp'
            ? (at <= 0 ? items.length : at) - 1
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? items.length - 1
                : -1
      if (to < 0) return
      event.preventDefault()
      items[to]?.focus()
    }
    // En phase de capture : un menu doit se fermer même si la zone cliquée
    // arrête la propagation pour son propre compte.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu" ref={rootRef}>
      <button
        type="button"
        className={open ? 'menu-trigger open' : 'menu-trigger'}
        onClick={() => {
          if (!open) measure()
          setOpen(o => !o)
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? label}
      >
        {icon && <Icon name={icon} size={13} />}
        <span>{label}</span>
        <Icon name="chevron-down" size={11} className="menu-caret" />
      </button>

      {open && (
        <div
          className={`menu-list ${align} ${placement.direction}`}
          role="menu"
          ref={listRef}
          style={{ maxHeight: placement.maxHeight }}
        >
          {title && <div className="menu-title">{title}</div>}
          {options.map((option, index) => (
            <button
              key={String(option.id)}
              type="button"
              role="menuitemradio"
              aria-checked={option.id === value}
              className={[
                'menu-item',
                option.id === value ? 'active' : '',
                option.apart ? 'apart' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => {
                onChange(option.id)
                setOpen(false)
              }}
            >
              <span className="menu-item-body">
                <span className="menu-item-label">{option.label}</span>
                {option.hint && (
                  <span className="menu-item-hint">{option.hint}</span>
                )}
              </span>
              {option.id === value ? (
                <Icon name="check" size={13} />
              ) : numbered && !option.apart ? (
                <span className="menu-item-index">{index + 1}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
