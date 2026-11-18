import { PreferencesProvider, usePreferences } from './state/usePreferences.js'
import * as React from 'react'
import { SessionCell } from './session/SessionCell.js'
import { RoutinesDialog } from './dialogs/RoutinesDialog.js'
import { SessionDialog } from './dialogs/SessionDialog.js'
import type { EngineController } from './state/useEngine.js'
import { Sidebar, type SidebarMode } from './layout/Sidebar.js'
import { useWorkspace } from './state/useWorkspace.js'
import { useEngine } from './state/useEngine.js'
import { useLayout, SIDEBAR_MIN } from './state/useLayout.js'
import { useProvider } from './state/useProvider.js'
import { useCorpora } from './state/useCorpora.js'
import { useExtensions } from './state/useExtensions.js'
import { SessionStateProvider } from './state/useSessionState.js'
import { Splitter } from './ui/Splitter.js'
import type { Project, SessionSummary } from '../main/preload.js'
import type { SessionMeta } from '../shared/sessionMeta.js'
import type { SessionActions } from './layout/SessionRow.js'
import type { ProjectActions } from './layout/ProjectRow.js'
import type { ProjectMeta } from '../shared/projectMeta.js'
import { ProjectDialog } from './dialogs/ProjectDialog.js'
import { useArchiveUndo } from './state/useArchiveUndo.js'
import { PluginCatalog } from './catalog/PluginCatalog.js'

export function App(): React.ReactNode {
  if (typeof window.engine === 'undefined') return <BridgeMissing />
  return <PreferencesProvider><SessionStateProvider><Workbench /></SessionStateProvider></PreferencesProvider>
}

function Workbench(): React.ReactNode {
  const personal = usePreferences()
  const { workspace, projects, loading, refresh, setWorkspace } = useWorkspace()
  const engine = useEngine(workspace, refresh, setWorkspace)
  const layout = useLayout()
  const provider = useProvider()
  const corpora = useCorpora()
  const extensions = useExtensions()
  const [catalogOpen, setCatalogOpen] = React.useState(false)
  const mode: SidebarMode = !engine.ready || engine.chat ? 'chat' : 'code'
  const [sidebarHidden, setSidebarHidden] = React.useState(false)
  const [settingsSession, setSettingsSession] = React.useState<string | null>(null)
  const [newSession, setNewSession] = React.useState<{ cwd: string; controller: EngineController; sources?: string[]; isolated?: boolean } | null>(null)
  // Les routines appartiennent au projet, pas à la session : l'état ne retient
  // donc qu'un répertoire de travail.
  const [routinesFor, setRoutinesFor] = React.useState<string | null>(null)
  /** Accusé fugace : copier ou archiver ne produit rien de visible autrement. */
  const [flash, setFlash] = React.useState<string | null>(null)
  const annoncer = React.useCallback((texte: string) => {
    setFlash(texte)
    window.setTimeout(() => setFlash(f => (f === texte ? null : f)), 2600)
  }, [])

  const ecrireMeta = React.useCallback(
    (cwd: string, id: string, patch: SessionMeta) =>
      window.engine.setSessionMeta(cwd, id, patch).then(() => refresh()),
    [refresh],
  )

  const undo = useArchiveUndo(
    React.useCallback(
      cible => {
        void ecrireMeta(cible.cwd, cible.sessionId, { archived: false }).then(() =>
          annoncer(`« ${cible.titre} » est de retour dans la liste`),
        )
      },
      [ecrireMeta, annoncer],
    ),
  )

  const startConversation = (controller: EngineController, projectCwd?: string, sources?: string[]) => {
    setCatalogOpen(false)
    const chat = !projectCwd && controller.chat === true
    const cwd = projectCwd ?? controller.workspace
    if (!controller.ready || !cwd) return
    void controller.startNewSession(cwd, undefined, true, sources ?? projects.find(p => p.cwd === cwd)?.sources, chat)
      .catch(error => annoncer(`La conversation n’a pas pu être ouverte : ${String(error)}`))
  }

  const [editProject, setEditProject] = React.useState<Project | null>(null)

  const ecrireProjet = React.useCallback(
    (cwd: string, patch: ProjectMeta) =>
      window.engine.setProjectMeta(cwd, patch).then(() => refresh()),
    [refresh],
  )

  /**
   * Les actions d'un projet.
   *
   * « Archiver les conversations » écrit autant de fois qu'il y a de
   * conversations, puis relit une seule fois : relire à chaque écriture ferait
   * clignoter la liste et rechargerait le disque pour rien.
   */
  const projectActions = React.useCallback(
    (project: Project): ProjectActions => ({
      meta: patch => { void ecrireProjet(project.cwd, patch) },
      newSession: () => startConversation(engine, project.cwd, project.sources),
      worktree: () => setNewSession({ cwd: project.cwd, controller: engine, sources: project.sources, isolated: true }),
      reveal: () => {
        void window.engine.revealPath(project.cwd).then(erreur => {
          if (erreur) annoncer(`Impossible d’ouvrir le dossier : ${erreur}`)
        })
      },
      archiveAll: () => {
        const cibles = project.sessions.filter(s => !s.archived)
        void Promise.all(
          cibles.map(s => window.engine.setSessionMeta(project.cwd, s.id, { archived: true })),
        )
          .then(() => refresh())
          .then(() =>
            annoncer(
              `${cibles.length} conversation${cibles.length > 1 ? 's' : ''} archivée${cibles.length > 1 ? 's' : ''}`,
            ),
          )
      },
      edit: () => setEditProject(project),
      remove: () => setEditProject(project),
    }),
    [engine, ecrireProjet, refresh, annoncer],
  )

  /**
   * Les actions d'une ligne de conversation.
   *
   * Construites ici parce qu'elles ont besoin du moteur et de la relecture :
   * la barre latérale ne connaît ni l'un ni l'autre, et les lui passer en
   * ferait une pièce de plomberie plutôt qu'une vue.
   */
  const actionsFor = React.useCallback(
    (session: SessionSummary, project: Project): SessionActions => ({
      meta: patch => {
        void ecrireMeta(project.cwd, session.id, patch).then(() => {
          if (patch.archived === true) {
            undo.noter({ cwd: project.cwd, sessionId: session.id, titre: session.title })
            annoncer(`« ${session.title} » archivée — Ctrl+Z pour annuler`)
          }
        })
      },
      // La conversation d'origine reste intacte : « poursuivre » n'est pas
      // « déplacer ». Ouvrir la session avant de forker, sinon le fork partirait
      // de la conversation affichée et non de celle qu'on a désignée.
      fork: () => {
        void engine.openSession(session.id, project.cwd).then(() => engine.forkSession(mode === 'chat'))
      },
      // Le formulaire plutôt qu'une création directe : un worktree a besoin
      // d'une branche et d'une base, et les deviner poserait un nom que
      // personne n'a choisi sur une branche qui restera.
      worktree: () => setNewSession({ cwd: project.cwd, controller: engine, sources: project.sources, isolated: true }),
      reveal: () => {
        void window.engine.revealPath(project.cwd).then(erreur => {
          if (erreur) annoncer(`Impossible d’ouvrir le dossier : ${erreur}`)
        })
      },
      copy: (text, quoi) => {
        void navigator.clipboard.writeText(text).then(
          () => annoncer(quoi),
          () => annoncer('Copie refusée par le système'),
        )
      },
    }),
    [engine, ecrireMeta, undo, annoncer, mode],
  )
  const split = engine.cells.length === 2
  const cellRefs = React.useRef(new Map<string, HTMLElement>())
  // Notification navigation must move keyboard focus too, without interrupting a pointer action.
  React.useEffect(() => {
    const cell = engine.activeId ? cellRefs.current.get(engine.activeId) : undefined
    if (cell) {
      if (!cell.contains(document.activeElement)) cell.focus({ preventScroll: true })
      cell.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [engine.activeId])
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!personal.value.shortcuts || event.repeat || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || document.querySelector('dialog[open]') || (event.target as HTMLElement)?.closest?.('.terminal-host')) return
      const key = event.key.toLowerCase()
      if (key === ',' && !event.shiftKey) { event.preventDefault(); setCatalogOpen(false); setSettingsSession(engine.activeId) }
      else if (key === 'n' && event.shiftKey) { event.preventDefault(); startConversation(engine) }
      else if (key === 'b' && !event.shiftKey) { event.preventDefault(); setSidebarHidden(value => !value) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [personal.value.shortcuts, engine])
  return <div className="app" style={{ gridTemplateColumns: sidebarHidden ? 'minmax(0, 1fr)' : `${layout.sidebar}px auto minmax(0, 1fr)` }}>
    {!sidebarHidden && <Sidebar mode={mode} onModeChange={value => { setCatalogOpen(false); engine.switchMode(value === 'chat') }} workspace={engine.codeWorkspace}
      projects={engine.mergeProjects(projects).filter(project => mode === 'chat' || !project.chat)} activeSessionId={engine.activeId} loading={loading}
      onChooseWorkspace={() => setNewSession({ cwd: engine.codeWorkspace, controller: engine })}
      onNewSession={() => startConversation(engine)}
      onOpenSession={(session, project) => { setCatalogOpen(false); void engine.openSession(session.id, project.cwd) }}
      onRefresh={() => void refresh()} onCollapse={() => setSidebarHidden(true)}
      actionsFor={actionsFor} projectActions={projectActions}
      onOpenCatalog={() => setCatalogOpen(true)}
      onOpenSettings={() => { setCatalogOpen(false); setSettingsSession(engine.activeId) }} />}
    {!sidebarHidden && <Splitter value={layout.sidebar} min={SIDEBAR_MIN} max={layout.sidebarMax}
      onChange={layout.setSidebar} label="Largeur du panneau latéral" />}
    <main className="cell-workspace" style={{ gridTemplateRows: 'minmax(0, 1fr)' }}>
      {catalogOpen && <PluginCatalog extensions={extensions} onClose={() => setCatalogOpen(false)} />}
      <div className={`session-cells${split ? ' double' : ''}`} style={catalogOpen ? { display: 'none' } : undefined}>
        {!engine.cells.length && <p role="status">{engine.entries.filter(e => e.kind === 'notice').map(e => e.text).join(' ') || 'Chargement des conversations…'}</p>}
        {engine.cells.map((cell, index) => <section key={cell.activeId!}
          ref={node => { if (node) cellRefs.current.set(cell.activeId!, node); else cellRefs.current.delete(cell.activeId!) }}
          className={`session-cell${cell.activeId === engine.activeId ? ' focused' : ''}`} tabIndex={-1}
          aria-label={split ? `Conversation ${index === 0 ? 'de gauche' : 'de droite'}` : 'Conversation'}
          aria-current={split && cell.activeId === engine.activeId ? 'true' : undefined} onFocusCapture={() => engine.focusSession(cell.activeId!)}
          onPointerDownCapture={() => engine.focusSession(cell.activeId!)}>
          <SessionCell mode={cell.chat ? 'chat' : 'code'} sessionActions={{
            newConversation: () => startConversation(cell),
            chooseFolder: () => setNewSession({ cwd: cell.workspace, controller: cell }),
            worktree: () => setNewSession({ cwd: cell.worktree?.root ?? cell.workspace, controller: cell, isolated: true }),
            routines: () => setRoutinesFor(cell.workspace),
            toggleSplit: () => { if (split) engine.closeSplit(); else void engine.split() },
            splitPending: engine.splitPending,
          }} engine={cell} provider={provider} corpora={corpora} extensions={extensions}
            project={cell.chat ? 'Chat' : cell.workspace.split(/[\\/]/).filter(Boolean).pop() ?? ''}
            focused={cell.activeId === engine.activeId} split={split} sidebarHidden={sidebarHidden}
            onShowSidebar={() => setSidebarHidden(false)} settingsRequest={settingsSession === cell.activeId}
            onSettingsClosed={() => setSettingsSession(null)}
            onOpenCatalog={() => setCatalogOpen(true)}
            projects={engine.mergeProjects(projects)}
            onUnarchive={(session, project) => {
              void ecrireMeta(project.cwd, session.id, { archived: false }).then(() =>
                annoncer(`« ${session.title} » est de retour dans la liste`),
              )
            }}
            onOpenSession={(session, project) => { void engine.openSession(session.id, project.cwd) }} />
        </section>)}
      </div>
    </main>
    {/* Accusé de geste. En `role="status"` : archiver, copier et annuler ne
        produisent rien de visible ailleurs, et un lecteur d'écran n'aurait
        aucun moyen de savoir que l'action a eu lieu. */}
    {flash && <div className="flash" role="status">{flash}</div>}
    {editProject && <ProjectDialog project={editProject}
      onSave={patch => { void ecrireProjet(editProject.cwd, patch); setEditProject(null) }}
      onRemove={() => {
        void ecrireProjet(editProject.cwd, { removed: true }).then(() =>
          annoncer(`« ${editProject.name} » retiré de la liste — ses conversations sont intactes`),
        )
        setEditProject(null)
      }}
      onClose={() => setEditProject(null)} />}
    {newSession && <SessionDialog isolatedInitially={newSession.isolated} cwd={newSession.cwd} onCreate={(cwd, request) => newSession.controller.startNewSession(cwd, request, true, cwd === newSession.cwd ? newSession.sources : projects.find(p => p.cwd === cwd)?.sources)} onClose={() => setNewSession(null)} />}
    {routinesFor && <RoutinesDialog cwd={routinesFor} onOpenSession={id => { void engine.openSession(id, routinesFor) }} onClose={() => setRoutinesFor(null)} />}
  </div>
}

function BridgeMissing(): React.ReactNode {
  return (
    <div className="bridge-missing">
      <div>
        <img src="assets/icon.png" alt="" />
        <h1>Pont indisponible</h1>
        <p>
          Le préchargement n’a pas été chargé : l’interface n’a aucun accès au
          moteur.
        </p>
        <p className="hint">
          Vérifier que <code>desktop/dist/preload.js</code> existe, puis
          relancer <code>bun run build.ts</code>. La console du processus
          principal donne la cause exacte.
        </p>
      </div>
    </div>
  )
}
