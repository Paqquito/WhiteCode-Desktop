/**
 * L'en-tête d'un projet, et ce qu'on peut en décider.
 *
 * La ligne ne faisait que replier son groupe. Un projet est pourtant l'objet
 * qu'on manipule le plus dans le mode Code — c'est lui qui porte le dossier de
 * travail, les sources, et l'endroit où l'on ouvre une session.
 *
 * Trois choses s'y ajoutent, dans l'ordre où on les atteint : un bouton de
 * **nouvelle session** dans ce dossier, parce que c'est le geste le plus
 * fréquent et qu'il passait par le choix d'un dossier déjà connu ; un menu
 * pour le reste ; et une carte de survol qui montre le **chemin complet**,
 * seule chose distinguant deux projets homonymes.
 *
 * La carte porte une action, contrairement à celle des conversations. Elle
 * doit donc survivre au trajet de la souris entre la ligne et elle, d'où une
 * fermeture différée plutôt qu'immédiate.
 */

import * as React from 'react'
import type { Project } from '../../main/preload.js'
import type { ProjectMeta } from '../../shared/projectMeta.js'
import { Icon } from '../ui/Icon.js'
import { ProjectHoverCard } from './ProjectHoverCard.js'
import { SessionMenu, type MenuEntry } from './SessionMenu.js'
import type { CardAnchor } from './SessionHoverCard.js'

const SURVOL_MS = 450
/** Le temps de traverser l'écart entre la barre et la carte. */
const FERMETURE_MS = 180

export type ProjectActions = {
  meta: (patch: ProjectMeta) => void
  /** Ouvre une session neuve dans ce dossier. */
  newSession: () => void
  /** Ouvre le formulaire de worktree sur ce dossier. */
  worktree: () => void
  reveal: () => void
  /** Archive toutes les conversations du projet d'un coup. */
  archiveAll: () => void
  /** Ouvre le formulaire de modification du projet. */
  edit: () => void
  /** Retire le projet de la liste, sans rien effacer. */
  remove: () => void
}

export function ProjectRow({
  project,
  open,
  onToggle,
  actions,
}: {
  project: Project
  open: boolean
  onToggle: () => void
  actions: ProjectActions
}): React.ReactNode {
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)
  const [card, setCard] = React.useState<CardAnchor | null>(null)
  const rowRef = React.useRef<HTMLDivElement>(null)
  const ouvrir = React.useRef<number | undefined>(undefined)
  const fermer = React.useRef<number | undefined>(undefined)

  const annuler = () => {
    window.clearTimeout(ouvrir.current)
    window.clearTimeout(fermer.current)
  }
  React.useEffect(() => () => annuler(), [])
  React.useEffect(() => {
    if (menu) {
      annuler()
      setCard(null)
    }
  }, [menu])

  const entries: MenuEntry[][] = [
    [
      {
        label: project.pinned ? 'Détacher le projet' : 'Épingler le projet',
        onClick: () => actions.meta({ pinned: !project.pinned }),
      },
      { label: 'Ouvrir dans l’explorateur', onClick: actions.reveal },
      { label: 'Créer un worktree permanent', onClick: actions.worktree },
      { label: 'Modifier le projet…', onClick: actions.edit },
    ],
    [
      {
        label: 'Archiver les conversations',
        disabled:
          project.sessions.every(s => s.archived) && project.sessions.length > 0
            ? 'Toutes sont déjà archivées'
            : undefined,
        onClick: actions.archiveAll,
      },
      {
        label: 'Retirer de la liste',
        onClick: actions.remove,
      },
    ],
  ]

  return (
    <div
      className="project-head-row"
      ref={rowRef}
      onContextMenu={event => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
      onMouseEnter={() => {
        annuler()
        ouvrir.current = window.setTimeout(() => {
          const row = rowRef.current
          if (!row) return
          const sidebar = row.closest('.sidebar')?.getBoundingClientRect()
          const rect = row.getBoundingClientRect()
          setCard({ sidebarRight: sidebar?.right ?? rect.right, rowTop: rect.top })
        }, SURVOL_MS)
      }}
      onMouseLeave={() => {
        window.clearTimeout(ouvrir.current)
        fermer.current = window.setTimeout(() => setCard(null), FERMETURE_MS)
      }}
    >
      <button
        type="button"
        className="project-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        {project.pinned && <Icon name="pin" size={11} className="session-pin" />}
        <span className="project-name">{project.name}</span>
        <span className="project-count">{project.sessions.length}</span>
      </button>

      <span className="project-tools">
        <button
          type="button"
          className="session-tool"
          title="Actions sur le projet"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          aria-label={`Actions sur ${project.name}`}
          onClick={event => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
            setMenu({ x: rect.left, y: rect.bottom + 4 })
          }}
        >
          <Icon name="more" size={14} />
        </button>
        <button
          type="button"
          className="session-tool"
          title="Nouvelle conversation dans ce projet"
          aria-label={`Nouvelle conversation dans ${project.name}`}
          onClick={actions.newSession}
        >
          <Icon name="edit" size={13} />
        </button>
      </span>

      {card && !menu && (
        <ProjectHoverCard
          anchor={card}
          name={project.name}
          cwd={project.cwd}
          sessions={project.sessions.length}
          onEdit={() => {
            setCard(null)
            actions.edit()
          }}
          onEnter={annuler}
          onLeave={() => setCard(null)}
        />
      )}

      {menu && <SessionMenu groups={entries} at={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
