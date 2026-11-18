/**
 * Panneau : carte à en-tête, refermable.
 *
 * Toutes les surfaces secondaires — fichiers, terminal, modifications —
 * partagent cette coquille. Elles n'ont donc à fournir que leur contenu, et
 * l'ajout d'un nouveau panneau ne demande ni mise en page ni bouton de
 * fermeture à réécrire.
 */

import * as React from 'react'
import { Icon, type IconName } from './Icon.js'
import { IconButton } from './IconButton.js'

export function Panel({
  title,
  subtitle,
  icon,
  actions,
  onClose,
  children,
  padded = true,
  scroll = true,
}: {
  title: string
  /** Précision discrète après le titre (le shell et le dossier d'un terminal). */
  subtitle?: string
  icon?: IconName
  /** Contrôles propres au panneau, placés avant la fermeture. */
  actions?: React.ReactNode
  onClose?: () => void
  children: React.ReactNode
  /** À désactiver quand le contenu gère lui-même ses marges (arborescence). */
  padded?: boolean
  /**
   * À désactiver quand le contenu tient son propre défilement.
   *
   * Le terminal en est le cas : xterm gère son historique et sa barre de
   * défilement. En laisser une seconde au panneau en superpose deux, dont une
   * horizontale parasite sous la dernière ligne.
   */
  scroll?: boolean
}): React.ReactNode {
  return (
    <section className="panel">
      <header className="panel-head">
        {icon && <Icon name={icon} size={14} />}
        <span className="panel-title">{title}</span>
        {subtitle && <span className="panel-subtitle" title={subtitle}>{subtitle}</span>}
        <div className="panel-actions">
          {actions}
          {onClose && (
            <IconButton icon="close" size={14} onClick={onClose} title="Fermer" label={`Fermer ${title}`} />
          )}
        </div>
      </header>
      <div
        className={`panel-body${padded ? ' padded' : ''}${scroll ? '' : ' no-scroll'}`}
      >
        {children}
      </div>
    </section>
  )
}

/**
 * État vide d'un panneau.
 *
 * Un panneau ouvert et vide doit dire pourquoi il l'est : sans cela,
 * l'utilisateur ne sait pas s'il attend, s'il a mal cliqué, ou s'il n'y a
 * simplement rien à voir.
 */
export function PanelEmpty({
  children,
  icon,
}: {
  children: React.ReactNode
  /** Avec une icône, l'état vide se centre et se lit d'un regard. */
  icon?: IconName
}): React.ReactNode {
  if (!icon) return <p className="panel-empty">{children}</p>
  return <div className="panel-empty centered"><Icon name={icon} size={18} /><p>{children}</p></div>
}
