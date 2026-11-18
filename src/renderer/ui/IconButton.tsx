/**
 * Bouton réduit à son icône.
 *
 * Quinze endroits écrivaient la même structure de six lignes : `type`,
 * `className`, `title`, `aria-label`, puis l'icône. Rien d'intéressant ne
 * variait, et la répétition avait un coût réel — `aria-label` n'y tenait que
 * par la discipline de celui qui écrivait, alors qu'un bouton sans texte est
 * muet pour un lecteur d'écran.
 *
 * Ici, il est obligatoire. Sa valeur retombe sur `title` quand les deux
 * disent la même chose, ce qui est le cas le plus courant ; les endroits où
 * l'infobulle est brève et l'annonce plus explicite — « Fermer » contre
 * « Fermer le panneau Terminal » — gardent les deux.
 */

import * as React from 'react'
import { Icon, type IconName } from './Icon.js'

export function IconButton({
  icon,
  size,
  title,
  label,
  variant,
  pressed,
  onClick,
  disabled,
}: {
  icon: IconName
  /** Taille de l'icône ; celle par défaut d'`Icon` si absente. */
  size?: number
  /** Infobulle au survol. */
  title: string
  /** Annonce au lecteur d'écran. Vaut `title` par défaut. */
  label?: string
  /** `active` : l'état que le bouton commande est en cours. `accent` : il appelle une action. */
  variant?: 'active' | 'accent'
  /** Pour un bouton à deux états : annonce lequel est en cours. */
  pressed?: boolean
  onClick?: () => void
  disabled?: boolean
}): React.ReactNode {
  return (
    <button
      type="button"
      className={variant ? `icon-button ${variant}` : 'icon-button'}
      onClick={onClick}
      title={title}
      aria-label={label ?? title}
      aria-pressed={pressed}
      disabled={disabled}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}
