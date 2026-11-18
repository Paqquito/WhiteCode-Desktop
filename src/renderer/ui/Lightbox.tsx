/**
 * Agrandissement d'une image jointe.
 *
 * Une vignette de vingt pixels ne permet pas de vérifier qu'on joint la bonne
 * capture — et une capture d'écran jointe par erreur part avec le message.
 * L'ouvrir en grand avant d'envoyer est la seule façon de s'en assurer.
 *
 * Superposition plutôt que fenêtre : l'image se referme d'un clic ou d'Échap,
 * sans rien déplacer de la mise en page en dessous.
 */

import * as React from 'react'
import { Icon } from './Icon.js'

export function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <button
        type="button"
        className="lightbox-close"
        onClick={onClose}
        title="Fermer"
        aria-label="Fermer l’aperçu"
      >
        <Icon name="close" size={16} />
      </button>

      {/* Le clic sur l'image ne referme pas : on zoome pour regarder, pas pour
          fermer, et refermer au moindre clic sur le contenu est déroutant. */}
      <img src={src} alt={alt} onClick={event => event.stopPropagation()} />
      <span className="lightbox-name">{alt}</span>
    </div>
  )
}
