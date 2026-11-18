/**
 * Barre latérale.
 *
 * Trois strates, du plus stable au plus changeant : l'identité et le mode en
 * haut, la navigation ensuite, l'historique en dessous — seule zone qui
 * défile. Cet ordre évite que la liste des sessions, qui grandit sans fin,
 * repousse les commandes hors de portée.
 *
 * ## Ce que le mode change
 *
 * Le sélecteur en tête n'est pas décoratif : il change la façon dont
 * l'historique est organisé, parce que les deux usages posent une question
 * différente.
 *
 *  - **Chat** — « où était cette conversation ? ». Liste plate,
 *    la plus récente en tête, tous dossiers mélangés.
 *  - **Code** — « où en est ce dépôt ? ». Groupée par dossier de travail, et
 *    accompagnée du sélecteur de dossier, qui n'a de sens que là.
 */

import * as React from 'react'
import type { Project, SessionSummary } from '../../main/preload.js'
import type { SessionActions } from './SessionRow.js'
import type { ProjectActions } from './ProjectRow.js'
import { Icon, type IconName } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'
import { ProjectList } from './ProjectList.js'
import { SessionList } from './SessionList.js'
import { BRAND } from '../brand.js'

export type SidebarMode = 'chat' | 'code'

export function Sidebar({
  mode,
  onModeChange,
  workspace,
  projects,
  activeSessionId,
  loading,
  onChooseWorkspace,
  onNewSession,
  onOpenSession,
  onRefresh,
  actionsFor,
  projectActions,
  onCollapse,
  onOpenSettings,
  onOpenCatalog,
}: {
  mode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
  workspace: string
  projects: Project[]
  activeSessionId: string | null
  loading: boolean
  onChooseWorkspace: () => void
  onNewSession: () => void
  onOpenSession: (session: SessionSummary, project: Project) => void
  onRefresh: () => void
  actionsFor: (session: SessionSummary, project: Project) => SessionActions
  projectActions: (project: Project) => ProjectActions
  onCollapse: () => void
  onOpenSettings: () => void
  onOpenCatalog?: () => void
}): React.ReactNode {
  const [query, setQuery] = React.useState('')
  const folder = workspace.split(/[\\/]/).filter(Boolean).pop() ?? workspace

  const [showArchived, setShowArchived] = React.useState(false)

  const archivedCount = React.useMemo(
    () => projects.reduce((n, p) => n + p.sessions.filter(s => s.archived).length, 0),
    [projects],
  )

  // Le filtre porte sur le titre **et** sur le nom du projet : on cherche
  // aussi bien « le diff de vendredi » que « tout ce qui touche eqt_master ».
  //
  // Les archivées sortent de la liste, mais **jamais de la recherche** : une
  // conversation qu'on ne peut plus retrouver est supprimée, pas archivée, et
  // ce n'est pas ce qu'on a promis en cliquant « Archiver ».
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    const garder = (s: { title: string; archived?: boolean }) =>
      (showArchived || needle ? true : !s.archived) &&
      (!needle || s.title.toLowerCase().includes(needle))
    return projects
      .map(project => ({
        ...project,
        sessions:
          needle && project.name.toLowerCase().includes(needle)
            ? project.sessions.filter(s => showArchived || needle ? true : !s.archived)
            : project.sessions.filter(garder),
      }))
      .filter(project => project.sessions.length > 0)
  }, [projects, query, showArchived])

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <img src="assets/icon.png" alt="" />
          <span className="brand-name">{BRAND.product}</span>
        </div>
        <IconButton icon="sidebar" onClick={onCollapse} title="Masquer le panneau" label="Masquer le panneau latéral" />
      </div>

      <div className="segmented" role="tablist" aria-label="Mode">
        <SegmentButton
          icon="chat"
          label="Chat"
          active={mode === 'chat'}
          onClick={() => onModeChange('chat')}
        />
        <SegmentButton
          icon="code"
          label="Code"
          active={mode === 'code'}
          onClick={() => onModeChange('code')}
        />
      </div>

      <nav className="sidebar-nav">
        <NavItem icon="plus" label="Nouvelle conversation" onClick={onNewSession} />
        {onOpenCatalog && <NavItem icon="extension" label="Plugins et skills" onClick={onOpenCatalog} />}
        {/* Le dossier de travail ne figure qu'en mode Code : en Chat, aucune
            des actions proposées n'en dépend, et l'afficher laisserait croire
            le contraire. */}
        {mode === 'code' && (
          <NavItem
            icon="folder-open"
            label={folder || 'Choisir un dossier'}
            hint={<Icon name="edit" size={13} />}
            onClick={onChooseWorkspace}
            title={workspace ? `Changer de dossier (actuel : ${workspace})` : 'Choisir un dossier'}
            ariaLabel={folder ? `Dossier ${folder}, changer de dossier` : 'Choisir un dossier'}
          />
        )}
      </nav>

      <div className="sidebar-search">
        <Icon name="search" size={13} />
        <input
          type="search"
          value={query}
          placeholder="Filtrer les conversations"
          aria-label="Filtrer les conversations"
          onChange={event => setQuery(event.target.value)}
        />
        {query && (
          <IconButton icon="close" size={12} onClick={() => setQuery('')} title="Effacer" label="Effacer le filtre" />
        )}
      </div>

      <div className="sidebar-section">
        <span>{mode === 'chat' ? 'Conversations' : 'Projets'}</span>
        {archivedCount > 0 && (
          <button
            type="button"
            className={showArchived ? 'sidebar-archived on' : 'sidebar-archived'}
            aria-pressed={showArchived}
            onClick={() => setShowArchived(v => !v)}
            title={showArchived ? 'Masquer les conversations archivées' : 'Afficher les conversations archivées'}
          >
            {archivedCount} archivée{archivedCount > 1 ? 's' : ''}
          </button>
        )}
        <IconButton icon="refresh" size={13} onClick={onRefresh} title="Rafraîchir" label="Rafraîchir la liste des projets" />
      </div>

      <div className="sidebar-scroll">
        {mode === 'chat' ? (
          <SessionList
            projects={filtered}
            activeSessionId={activeSessionId}
            loading={loading}
            onOpenSession={onOpenSession}
            actionsFor={actionsFor}
          />
        ) : (
          <ProjectList
            projects={filtered}
            activeSessionId={activeSessionId}
            activeCwd={workspace}
            loading={loading}
            // Un filtre actif ouvre tous les groupes : chercher puis devoir
            // déplier chaque dossier pour voir les résultats n'aurait aucun
            // sens.
            forceOpen={query.trim().length > 0}
            onOpenSession={onOpenSession}
            actionsFor={actionsFor}
            projectActions={projectActions}
          />
        )}
      </div>

      {/* Pied de barre : ce qui vaut pour toute l'application, pas pour la
          conversation courante. Séparé de la liste pour ne pas défiler avec
          elle. */}
      <div className="sidebar-foot">
        <button type="button" className="sidebar-settings" onClick={onOpenSettings}><Icon name="settings" />Paramètres</button>
      </div>
    </aside>
  )
}

function SegmentButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName
  label: string
  active: boolean
  onClick: () => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? 'segment active' : 'segment'}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  )
}

function NavItem({
  icon,
  label,
  hint,
  onClick,
  title,
  ariaLabel,
}: {
  icon: IconName
  label: string
  hint?: React.ReactNode
  onClick: () => void
  title?: string
  ariaLabel?: string
}): React.ReactNode {
  return (
    <button type="button" className="nav-item" onClick={onClick} title={title} aria-label={ariaLabel}>
      <Icon name={icon} size={15} />
      <span className="nav-label">{label}</span>
      {hint && <span className="nav-hint">{hint}</span>}
    </button>
  )
}
