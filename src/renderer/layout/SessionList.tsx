/**
 * Sessions en liste plate, tous projets confondus.
 *
 * C'est la vue « Chat & Cowork » : on y cherche une conversation par son
 * sujet, sans savoir ni vouloir savoir dans quel dossier elle a été ouverte.
 * Le nom du projet reste affiché en second rang — il désambiguïse deux
 * conversations qui commenceraient pareil, sans structurer la liste.
 *
 * La vue « Code » fait l'inverse : elle groupe par dossier, parce qu'on y
 * pense d'abord au dépôt sur lequel on travaille. Voir `ProjectList`.
 */

import * as React from 'react'
import type { Project, SessionSummary } from '../../main/preload.js'
import { compareSessions } from '../../shared/sessionMeta.js'
import { SessionRow, type SessionActions } from './SessionRow.js'

export function SessionList({
  projects,
  activeSessionId,
  loading,
  onOpenSession,
  actionsFor,
}: {
  projects: Project[]
  activeSessionId: string | null
  loading: boolean
  onOpenSession: (session: SessionSummary, project: Project) => void
  /** Les actions d'une ligne, construites par l'appelant qui tient le moteur. */
  actionsFor: (session: SessionSummary, project: Project) => SessionActions
}): React.ReactNode {
  const rows = React.useMemo(() => {
    const flat = projects.flatMap(project =>
      project.sessions.map(session => ({ session, project })),
    )
    // Les épinglées d'abord, puis la plus récente : dans une liste sans
    // structure, l'ordre chronologique est la seule chose qui rende la
    // recherche prévisible, et l'épingle la seule exception voulue.
    flat.sort((a, b) => compareSessions(a.session, b.session))
    return flat
  }, [projects])

  if (loading) return <p className="sidebar-empty">Lecture des sessions…</p>
  if (rows.length === 0) {
    return <p className="sidebar-empty">Aucune conversation.</p>
  }

  return (
    <div className="session-list">
      {rows.map(({ session, project }) => (
        <SessionRow
          key={session.id}
          session={session}
          project={project}
          active={session.id === activeSessionId}
          flat
          onOpen={() => onOpenSession(session, project)}
          actions={actionsFor(session, project)}
        />
      ))}
    </div>
  )
}
