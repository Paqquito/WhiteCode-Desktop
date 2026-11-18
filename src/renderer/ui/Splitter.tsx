/**
 * Poignée de redimensionnement.
 *
 * Sert les deux axes : entre les colonnes de la fenêtre, et entre les panneaux
 * empilés d'une même colonne. Le geste est le même, seul l'axe mesuré change —
 * en faire deux composants aurait dupliqué la partie délicate, qui est le
 * suivi du pointeur.
 *
 * Le suivi se fait sur `window` et non sur la poignée : la souris sort de la
 * poignée dès le premier pixel parcouru, et un écouteur local perdrait le
 * geste aussitôt commencé.
 */

import * as React from 'react'

export type SplitterAxis = 'x' | 'y'

export function Splitter({
  value,
  min,
  max,
  axis = 'x',
  /**
   * `after` : la zone redimensionnée est celle qui suit la poignée, donc le
   * déplacement du pointeur joue à l'envers.
   */
  side = 'before',
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  axis?: SplitterAxis
  side?: 'before' | 'after'
  onChange: (next: number) => void
  label: string
}): React.ReactNode {
  const [dragging, setDragging] = React.useState(false)

  const clamp = (n: number) => Math.min(max, Math.max(min, n))

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const start = axis === 'x' ? event.clientX : event.clientY
    const startValue = value
    setDragging(true)

    const onMove = (move: PointerEvent) => {
      const now = axis === 'x' ? move.clientX : move.clientY
      const delta = side === 'before' ? now - start : start - now
      onChange(clamp(startValue + delta))
    }
    const onUp = () => {
      setDragging(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.classList.remove('resizing-x', 'resizing-y')
    }

    // Empêche la sélection de texte et fige le curseur pendant le geste : sans
    // cela, glisser au-dessus du fil sélectionne la conversation.
    document.body.classList.add(axis === 'x' ? 'resizing-x' : 'resizing-y')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Au clavier : 16 px par pression, 64 px avec Maj. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16
    const dir = side === 'before' ? 1 : -1
    const less = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    const more = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    if (event.key === less) {
      event.preventDefault()
      onChange(clamp(value - step * dir))
    } else if (event.key === more) {
      event.preventDefault()
      onChange(clamp(value + step * dir))
    }
  }

  return (
    <div
      className={`splitter ${axis}${dragging ? ' dragging' : ''}`}
      role="separator"
      // Une poignée entre deux colonnes sépare selon la verticale, et
      // inversement : l'attribut décrit le trait, pas le mouvement.
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <span className="splitter-grip" />
    </div>
  )
}
