/**
 * Gabarit de dialogue.
 *
 * Neuf dialogues avaient chacun leur en-tête, leurs marges, leur largeur et
 * leur pied. Ils partagent désormais une structure : en-tête (titre, bouton
 * Fermer), corps qui défile, pied d'actions aligné à droite, et trois
 * largeurs — 480, 640 et 1120 px.
 *
 * Sur le `<dialog>` natif, pour ce qu'il donne sans code : piège de focus,
 * `Esc`, inertie de l'arrière-plan. Le focus revient à l'élément qui l'avait
 * avant l'ouverture.
 */

import * as React from 'react'
import { IconButton } from './IconButton.js'
import { focusInside } from './inputModality.js'

export type DialogSize = 'sm' | 'md' | 'lg'

export function Dialog({
  title,
  size = 'md',
  className,
  onClose,
  dismissible = true,
  footer,
  children,
  role,
  closeLabel = 'Fermer le dialogue',
}: {
  title: React.ReactNode
  size?: DialogSize
  /** Classes propres au dialogue, conservées pour ses styles et ses tests. */
  className?: string
  onClose: () => void
  /** Faux pendant une opération : `Esc` et Fermer attendent la fin. */
  dismissible?: boolean
  footer?: React.ReactNode
  children?: React.ReactNode
  role?: 'alertdialog'
  /** Nom du bouton Fermer pour les lecteurs d'écran, quand « Fermer le dialogue » est trop vague. */
  closeLabel?: string
}): React.ReactNode {
  const dialog = React.useRef<HTMLDialogElement>(null)
  const titleId = React.useId()

  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current
    if (element && !element.open) element.showModal()
    // Le premier contrôle utile prend le focus, pas le bouton Fermer : on
    // ouvre un dialogue pour y faire quelque chose. Sans contrôle dans le
    // corps, le dialogue lui-même le reçoit, sans anneau sur Fermer.
    const first = element?.querySelector<HTMLElement>('.app-dialog-body :is(input:not([type=hidden]), select, textarea, button):not(:disabled)')
    if (first) focusInside(first)
    else if (element) { element.tabIndex = -1; focusInside(element) }
    return () => {
      element?.close()
      previous?.focus?.()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      role={role}
      className={`app-dialog size-${size}${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      // `cancel` est l'événement d'`Esc` : sans lui, le navigateur fermerait
      // l'élément sans que React le sache.
      onCancel={event => {
        event.preventDefault()
        if (dismissible) onClose()
      }}
    >
      <header className="app-dialog-head">
        <h2 id={titleId}>{title}</h2>
        <IconButton icon="close" size={15} onClick={onClose} disabled={!dismissible} title="Fermer" label={closeLabel} />
      </header>
      <div className="app-dialog-body">{children}</div>
      {footer && <footer className="app-dialog-foot">{footer}</footer>}
    </dialog>
  )
}
