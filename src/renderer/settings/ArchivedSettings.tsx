/**
 * Conversations archivées.
 *
 * Une archive n'a de sens que si on peut y retourner. La barre latérale offre
 * un raccourci — un compteur qui les fait réapparaître en place — mais il
 * dépend d'un survol et disparaît dès qu'il n'y en a plus aucune. Cet écran
 * est l'endroit stable : on y va en le cherchant, pas en le trouvant.
 *
 * Aucune suppression ici, et c'est délibéré. Archiver promet de ne rien
 * effacer ; poser un bouton « tout supprimer » à côté de la liste rendrait ce
 * geste dangereux à l'endroit exact où l'on vient réparer une erreur. Effacer
 * une conversation reste une opération de fichiers, faite en connaissance de
 * cause.
 */

import * as React from 'react'
import { SettingsPage } from '../ui/SettingRows.js'
import type { Project, SessionSummary } from '../../main/preload.js'
import { Icon } from '../ui/Icon.js'

export function ArchivedSettings({
  projects,
  onUnarchive,
  onOpen,
}: {
  projects: Project[]
  onUnarchive: (session: SessionSummary, project: Project) => void
  onOpen: (session: SessionSummary, project: Project) => void
}): React.ReactNode {
  const [query, setQuery] = React.useState('')

  const groupes = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return projects
      .map(project => ({
        project,
        sessions: project.sessions.filter(
          s => s.archived && (!needle || s.title.toLowerCase().includes(needle)),
        ),
      }))
      .filter(g => g.sessions.length > 0)
  }, [projects, query])

  const total = React.useMemo(
    () => projects.reduce((n, p) => n + p.sessions.filter(s => s.archived).length, 0),
    [projects],
  )

  if (total === 0) {
    return (
      <SettingsPage title="Conversations archivées" lead="Archiver retire une conversation de la liste sans jamais l’effacer ; elle se retrouve ici.">
        <p className="settings-note">Aucune conversation archivée.</p>
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title="Conversations archivées" lead="Archiver retire une conversation de la liste sans jamais l’effacer ; elle se retrouve ici.">

      <label className="field">
        <span className="field-label">Rechercher</span>
        <input
          type="text"
          value={query}
          placeholder={`${total} conversation${total > 1 ? 's' : ''} archivée${total > 1 ? 's' : ''}`}
          onChange={event => setQuery(event.target.value)}
        />
      </label>

      {groupes.length === 0 && (
        <p className="settings-note">Aucune archive ne correspond à cette recherche.</p>
      )}

      {groupes.map(({ project, sessions }) => (
        <div className="archived-group" key={project.cwd}>
          <p className="archived-project">
            <Icon name="folder" size={13} />
            <span>{project.name}</span>
            <span className="archived-count">
              {sessions.length} conversation{sessions.length > 1 ? 's' : ''}
            </span>
          </p>
          {sessions.map(session => (
            <div className="archived-row" key={session.id}>
              <button
                type="button"
                className="archived-title"
                onClick={() => onOpen(session, project)}
                title={`Ouvrir « ${session.title} »`}
              >
                {session.title}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => onUnarchive(session, project)}
              >
                Désarchiver
              </button>
            </div>
          ))}
        </div>
      ))}
    </SettingsPage>
  )
}
