/**
 * Une ligne de conversation.
 *
 * Partagée par les deux modes de navigation : ils dessinent la liste
 * différemment, mais les actions sont les mêmes, et les dupliquer les ferait
 * diverger à la première correction.
 *
 * ## Un titre sur une ligne, et rien d'autre
 *
 * La ligne portait deux lignes de titre et un horodatage. Dans une liste de
 * trente conversations, cela fait quatre-vingt-dix lignes de texte à parcourir
 * pour retrouver la bonne. Le titre tient désormais sur **une** ligne, tronqué
 * par des points de suspension, et la date a disparu : elle changeait à chaque
 * rendu sans jamais servir à choisir.
 *
 * Ce qui a été retiré n'est pas perdu — la carte de survol le montre en entier,
 * avec le dossier et la branche, c'est-à-dire ce qui distingue vraiment deux
 * conversations qui portent le même début de phrase.
 *
 * ## Deux icônes, pas un menu
 *
 * Épingler et archiver sont les deux gestes courants ; les cacher derrière un
 * menu leur coûterait deux clics chacun. Elles apparaissent au survol — les
 * afficher en permanence ferait un rideau d'icônes dans la liste. Le reste est
 * au clic droit, là où on le cherche.
 *
 * ## La ligne n'est plus un bouton
 *
 * Un bouton ne peut pas en contenir d'autres. La zone d'ouverture reste un
 * vrai bouton ; les icônes sont ses voisines dans un conteneur commun.
 */

import * as React from 'react'
import type { Project, SessionSummary } from '../../main/preload.js'
import type { SessionMeta } from '../../shared/sessionMeta.js'
import { Icon } from '../ui/Icon.js'
import { RoutineOrigin } from './RoutineOrigin.js'
import { SessionIndicator } from './SessionIndicator.js'
import { SessionHoverCard, type CardAnchor } from './SessionHoverCard.js'
import { SessionMenu, type MenuEntry } from './SessionMenu.js'
import { BRAND } from '../brand.js'

/** Délai avant la carte : sans lui, parcourir la liste la fait clignoter. */
const SURVOL_MS = 450

export type SessionActions = {
  /** Épingle, archive, non-lu, titre — retouche partielle. */
  meta: (patch: SessionMeta) => void
  /** Reprend la conversation dans une session neuve, l'originale intacte. */
  fork: () => void
  /** Ouvre le formulaire de nouvelle session sur un worktree de ce dossier. */
  worktree: () => void
  /** Ouvre le dossier de travail dans l'explorateur du système. */
  reveal: () => void
  /** Copie dans le presse-papier, avec un accusé fugace. */
  copy: (text: string, quoi: string) => void
}

export function SessionRow({
  session,
  project,
  active,
  flat,
  onOpen,
  actions,
}: {
  session: SessionSummary
  project: Project
  active: boolean
  /** Liste plate : les conversations de tous les projets se mélangent. */
  flat?: boolean
  onOpen: () => void
  actions: SessionActions
}): React.ReactNode {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)
  const [renaming, setRenaming] = React.useState(false)
  const [card, setCard] = React.useState<CardAnchor | null>(null)
  const rowRef = React.useRef<HTMLDivElement>(null)
  const timer = React.useRef<number | undefined>(undefined)

  const quitterSurvol = React.useCallback(() => {
    window.clearTimeout(timer.current)
    setCard(null)
  }, [])

  // La carte ne doit pas survivre à ce qui la rendait pertinente.
  React.useEffect(() => {
    if (menu || renaming) quitterSurvol()
  }, [menu, renaming, quitterSurvol])

  React.useEffect(() => () => window.clearTimeout(timer.current), [])

  if (renaming) {
    return (
      <div className="session-row" ref={rowRef}>
        <RenameField
          initial={session.title}
          placeholder={session.derivedTitle}
          onDone={title => {
            setRenaming(false)
            if (title !== session.title) actions.meta({ title })
          }}
          onCancel={() => setRenaming(false)}
        />
      </div>
    )
  }

  const classes = [
    'session',
    flat ? 'flat' : '',
    active ? 'active' : '',
    session.archived ? 'archived' : '',
    session.unread ? 'unread' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const groups: MenuEntry[][] = [
    [
      {
        label: session.pinned ? 'Détacher' : 'Épingler la conversation',
        onClick: () => actions.meta({ pinned: !session.pinned }),
      },
      { label: 'Renommer…', onClick: () => setRenaming(true) },
      {
        label: session.archived ? 'Sortir de l’archive' : 'Archiver',
        onClick: () => actions.meta({ archived: !session.archived }),
      },
      {
        label: session.unread ? 'Marquer comme lue' : 'Marquer comme non lue',
        onClick: () => actions.meta({ unread: !session.unread }),
      },
    ],
    [
      { label: 'Ouvrir dans l’explorateur', onClick: actions.reveal },
      {
        label: 'Copier le dossier de travail',
        onClick: () => actions.copy(project.cwd, 'Dossier copié'),
      },
      {
        label: 'Copier l’identifiant de la conversation',
        onClick: () => actions.copy(session.id, 'Identifiant copié'),
      },
      {
        label: 'Copier le lien direct',
        onClick: () =>
          actions.copy(`${BRAND.scheme}://session/${encodeURIComponent(session.id)}`, 'Lien copié'),
      },
    ],
    [
      { label: 'Poursuivre dans une nouvelle conversation', onClick: actions.fork },
      ...(project.chat ? [] : [{ label: 'Poursuivre dans un nouveau worktree', onClick: actions.worktree }]),
    ],
    [
      {
        label: 'Ouvrir dans une nouvelle fenêtre',
        // Voir `SessionMenu` : le processus principal ne tient qu'une fenêtre.
        disabled: 'L’application ne gère qu’une fenêtre pour l’instant',
      },
    ],
  ]

  return (
    <div
      className="session-row"
      ref={rowRef}
      onContextMenu={event => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
      onMouseEnter={() => {
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          const row = rowRef.current
          if (!row) return
          // Le bord de la **barre** et non celui de la ligne : une ligne peut
          // être plus étroite que la barre, et la carte doit rester collée au
          // même endroit d'une ligne à l'autre.
          const sidebar = row.closest('.sidebar')?.getBoundingClientRect()
          const rect = row.getBoundingClientRect()
          setCard({
            sidebarRight: sidebar?.right ?? rect.right,
            rowTop: rect.top,
          })
        }, SURVOL_MS)
      }}
      onMouseLeave={quitterSurvol}
    >
      <button type="button" className={classes} onClick={onOpen}>
        <SessionIndicator phase={session.attention?.phase ?? (session.activity === 'running' ? 'working' : session.activity === 'permission' ? 'waiting' : 'idle')} unread={Boolean(session.unread || session.attention?.unread)} />
        <span className="session-title">
          {session.pinned && <Icon name="pin" size={11} className="session-pin" />}
          {session.title}
        </span>
        <RoutineOrigin origin={session.origin} />
      </button>

      <span className="session-tools">
        <button
          type="button"
          className={session.pinned ? 'session-tool on' : 'session-tool'}
          aria-pressed={session.pinned ?? false}
          title={session.pinned ? 'Détacher' : 'Épingler'}
          aria-label={`${session.pinned ? 'Détacher' : 'Épingler'} ${session.title}`}
          onClick={() => actions.meta({ pinned: !session.pinned })}
        >
          <Icon name="pin" size={13} />
        </button>
        <button
          type="button"
          className="session-tool"
          title={session.archived ? 'Sortir de l’archive' : 'Archiver'}
          aria-label={`${session.archived ? 'Sortir de l’archive' : 'Archiver'} ${session.title}`}
          onClick={() => actions.meta({ archived: !session.archived })}
        >
          <Icon name="archive" size={13} />
        </button>
      </span>

      {card && !menu && (
        <SessionHoverCard
          anchor={card}
          title={session.title}
          project={project.name}
          cwd={project.cwd}
          updatedAt={session.updatedAt}
        />
      )}

      {menu && <SessionMenu groups={groups} at={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

function RenameField({
  initial,
  placeholder,
  onDone,
  onCancel,
}: {
  initial: string
  placeholder: string
  onDone: (title: string) => void
  onCancel: () => void
}): React.ReactNode {
  const [value, setValue] = React.useState(initial)
  return (
    <input
      className="session-rename"
      autoFocus
      value={value}
      placeholder={placeholder}
      aria-label="Nouveau nom de la conversation"
      onChange={event => setValue(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Enter') onDone(value)
        if (event.key === 'Escape') {
          // Rattrapé ici : plus haut, Échap fermerait aussi la barre latérale.
          event.stopPropagation()
          onCancel()
        }
      }}
      // Cliquer ailleurs vaut validation : perdre un nom qu'on vient de taper
      // est le comportement le plus coûteux des deux.
      onBlur={() => onDone(value)}
    />
  )
}
