/**
 * Sessions groupées par projet.
 *
 * Les conversations d'un même dossier de travail se regroupent sous son nom,
 * repliable. Sans ce groupement, une liste plate mélange les projets et
 * devient inutilisable dès qu'on en suit plusieurs — ce qui est le cas normal.
 *
 * Les groupes s'ouvrent et se ferment sans état persistant : le projet courant
 * est ouvert d'office, les autres repliés. Ce qu'on regarde est visible, le
 * reste est à un clic.
 */

import * as React from 'react'
import type { Project, SessionSummary } from '../../main/preload.js'
import { compareSessions } from '../../shared/sessionMeta.js'
import { ProjectRow, type ProjectActions } from './ProjectRow.js'
import { SessionRow, type SessionActions } from './SessionRow.js'

export function ProjectList({
  projects,
  activeSessionId,
  activeCwd,
  loading,
  forceOpen = false,
  onOpenSession,
  actionsFor,
  projectActions,
}: {
  projects: Project[]
  activeSessionId: string | null
  activeCwd: string
  loading: boolean
  /** Filtre actif : tout ouvrir, sinon les résultats resteraient cachés. */
  forceOpen?: boolean
  onOpenSession: (session: SessionSummary, project: Project) => void
  /** Les actions d'une ligne, construites par l'appelant qui tient le moteur. */
  actionsFor: (session: SessionSummary, project: Project) => SessionActions
  projectActions: (project: Project) => ProjectActions
}): React.ReactNode {
  if (loading) {
    return <p className="sidebar-empty">Lecture des projets…</p>
  }
  if (projects.length === 0) {
    return <p className="sidebar-empty">Aucun projet enregistré.</p>
  }

  return (
    <div className="project-list">
      {projects.map(project => (
        <ProjectGroup
          key={project.cwd}
          project={project}
          showAll={forceOpen}
          activeSessionId={activeSessionId}
          defaultOpen={
            forceOpen ||
            project.sessions.some(s => s.id === activeSessionId) ||
            sameDir(project.cwd, activeCwd)
          }
          onOpenSession={onOpenSession}
          actionsFor={actionsFor}
          projectActions={projectActions}
        />
      ))}
    </div>
  )
}

/** Le moteur écrit `E:\…`, le sélecteur de dossier rend `E:/…`. */
function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, '/').toLowerCase()
  return norm(a) === norm(b)
}

function ProjectGroup({
  project,
  activeSessionId,
  defaultOpen,
  showAll,
  onOpenSession,
  actionsFor,
  projectActions,
}: {
  project: Project
  activeSessionId: string | null
  defaultOpen: boolean
  showAll: boolean
  onOpenSession: (session: SessionSummary, project: Project) => void
  /** Les actions d'une ligne, construites par l'appelant qui tient le moteur. */
  actionsFor: (session: SessionSummary, project: Project) => SessionActions
  projectActions: (project: Project) => ProjectActions
}): React.ReactNode {
  const [open, setOpen] = React.useState(defaultOpen)
  const [expanded, setExpanded] = React.useState(false)
  const sessions = [...project.sessions].sort(compareSessions)
  const visible = showAll || expanded ? sessions : sessions.slice(0, 5)

  // Rouvre le groupe quand la session active y bascule — sinon l'entrée
  // sélectionnée resterait cachée dans un groupe replié.
  React.useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])

  return (
    <section className="project">
      <ProjectRow
        project={project}
        open={open}
        onToggle={() => setOpen(o => !o)}
        actions={projectActions(project)}
      />

      {open && (
        <div className="project-sessions">
          {/* Trié ici et pas seulement à la lecture du disque : une session
              vivante est replacée en tête par `mergeSessionProjects`, ce qui
              défait l'ordre venu du processus principal. */}
          {visible.map(session => (
            <SessionRow
              key={session.id}
              session={session}
              project={project}
              active={session.id === activeSessionId}
              onOpen={() => onOpenSession(session, project)}
              actions={actionsFor(session, project)}
            />
          ))}
          {!showAll && sessions.length > 5 && <button type="button" className="project-show-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? 'Voir moins' : 'Voir plus'}
          </button>}
        </div>
      )}
    </section>
  )
}
