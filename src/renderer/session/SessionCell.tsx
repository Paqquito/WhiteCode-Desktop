import { usePreferences } from '../state/usePreferences.js'
import * as React from 'react'
import type { Attachment, Project, SessionSummary } from '../../main/preload.js'
import { ConversationContext } from '../composer/ConversationContext.js'
import { Composer } from '../composer/Composer.js'
import { StatusBar } from '../layout/StatusBar.js'
import { TopBar, type ConversationActions } from '../layout/TopBar.js'
import { PanelHost } from '../panels/PanelHost.js'
import { PermissionCard } from '../dialogs/PermissionCard.js'
import { RestoreDialog } from '../dialogs/RestoreDialog.js'
import { ReviewBar } from '../review/ReviewBar.js'
import { SettingsDialog, type Tab as SettingsTab } from '../settings/SettingsDialog.js'
import { useAttachments } from '../state/useAttachments.js'
import { useCorpora } from '../state/useCorpora.js'
import type { EngineController } from '../state/useEngine.js'
import { useExtensions } from '../state/useExtensions.js'
import { PANELS_MIN, useLayout } from '../state/useLayout.js'
import { usePanels } from '../state/usePanels.js'
import { useReview } from '../state/useReview.js'
import type { useProvider } from '../state/useProvider.js'
import { useModelChoice } from '../state/useModelChoice.js'
import { useSettings } from '../state/useSettings.js'
import { useSessionState, useSessionDraftWriter } from '../state/useSessionState.js'
import { catalogModels, selectedGatewayModel } from '../../shared/modelSelection.js'
import { FileLinkContext } from '../thread/fileLink.js'
import { Thread } from '../thread/Thread.js'
import { TextAttachmentPreview } from '../composer/TextAttachmentPreview.js'
import { Lightbox } from '../ui/Lightbox.js'
import { Splitter } from '../ui/Splitter.js'

type Queued = { text: string; content: string | unknown[] }
/** Même référence à chaque rendu : une file vide neuve relancerait les effets. */
const NO_QUEUE: readonly Queued[] = []


export function SessionCell({ mode = 'code', sessionActions, engine, provider, corpora, extensions, project, focused, split, sidebarHidden, onShowSidebar, settingsRequest, onSettingsClosed, onOpenCatalog, projects, onUnarchive, onOpenSession }: {
  mode?: 'chat' | 'code';
  sessionActions?: ConversationActions;
  engine: EngineController; provider: ReturnType<typeof useProvider>; corpora: ReturnType<typeof useCorpora>;
  onOpenCatalog?: () => void;
  extensions: ReturnType<typeof useExtensions>; project: string; focused: boolean; split: boolean;
  sidebarHidden: boolean; onShowSidebar: () => void; settingsRequest: boolean; onSettingsClosed: () => void;
  /** Pour l'écran des conversations archivées, qui vit dans les Paramètres. */
  projects: Project[];
  onUnarchive: (session: SessionSummary, project: Project) => void;
  onOpenSession: (session: SessionSummary, project: Project) => void;
}): React.ReactNode {
  const workspace = engine.workspace
  const panels = usePanels(engine.activeId, extensions.panels)
  const layout = useLayout()
  const attachments = useAttachments(engine.activeId)
  const review = useReview(engine.activeId)
  const writeDraft = useSessionDraftWriter()
  const {
    settings,
    setPermissionMode,
    setModel,
    setEffort,
    setReducedTools,
  } = useSettings(engine.settings, engine.updateSettings)

  const [preview, setPreview] = React.useState<Attachment | null>(null)
  const [restoreOpen, setRestoreOpen] = React.useState(false)
  const personal = usePreferences()
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!focused || !personal.value.shortcuts || event.repeat || event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'j' || document.querySelector('dialog[open]') || (event.target as HTMLElement)?.closest?.('.terminal-host')) return
      event.preventDefault(); panels.toggle('terminal')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused, personal.value.shortcuts, panels])
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [settingsTab, setSettingsTab] = React.useState<SettingsTab>('general')
  /** Fichier désigné depuis la conversation, à ouvrir dans l'explorateur. */
  const [fileTarget, setFileTarget] = useSessionState<{ path: string } | null>(engine.activeId, null, 'file-target')
  React.useEffect(() => { if (settingsRequest) { setSettingsTab('general'); setSettingsOpen(true) } }, [settingsRequest])

  /**
   * Ouvre un fichier mentionné dans le fil.
   *
   * Le panneau est ouvert au besoin : cliquer un chemin sans que rien ne se
   * passe parce que l'explorateur est replié serait déroutant. Le chemin est
   * résolu depuis la racine de l'espace de travail s'il est relatif.
   */
  const openFileFromThread = React.useCallback(
    (relative: string) => {
      if (!workspace) return
      // Le chemin vient de la conversation, donc en barres obliques ; le
      // disque, lui, suit la convention de l'espace de travail.
      const separator = workspace.includes('\\') ? '\\' : '/'
      const normalised = relative.replace(/[\\/]/g, separator)
      if (!panels.open.includes('files')) panels.toggle('files')
      setFileTarget({ path: /^(?:[A-Za-z]:[\\/]|[/\\])/.test(relative) ? normalised : `${workspace}${separator}${normalised}` })
    },
    [workspace, panels],
  )

  /**
   * File d'attente des messages écrits pendant une réponse.
   *
   * Le contenu (pièces jointes comprises) est figé au moment de l'écriture :
   * les pièces jointes quittent le composeur avec le message, comme pour un
   * envoi direct. Chaque conversation a sa propre file.
   */
  const [queue, setQueue] = useSessionState<readonly Queued[]>(engine.activeId, NO_QUEUE, 'queue')
  const [queuePaused, setQueuePaused] = useSessionState(engine.activeId, false, 'queue-paused')

  const sendNext = React.useCallback(() => {
    const [first, ...rest] = queue
    if (!first) return
    setQueue(rest)
    engine.send(first.text, first.content)
  }, [queue, setQueue, engine])

  const submit = React.useCallback(
    (text: string) => {
      const content = attachments.buildContent(text)
      attachments.clear()
      if (engine.status.busy) setQueue(current => [...current, { text, content }])
      else engine.send(text, content)
    },
    [engine, attachments, setQueue],
  )

  // Fin d'une réponse : le message suivant part de lui-même, sauf si la
  // réponse a été arrêtée ou a échoué. L'utilisateur vient alors de reprendre
  // la main, et la file attend son accord (« Envoyer le suivant »).
  const lastBusy = React.useRef({ id: engine.activeId, busy: engine.status.busy })
  React.useEffect(() => {
    const previous = lastBusy.current
    const busy = engine.status.busy
    lastBusy.current = { id: engine.activeId, busy }
    if (!queue.length) { if (queuePaused) setQueuePaused(false); return }
    if (queuePaused || busy) return
    // Retour sur une conversation dont la réponse s'est finie hors de vue :
    // on ne sait pas comment, la file attend.
    if (previous.id !== engine.activeId) { setQueuePaused(true); return }
    if (!previous.busy) return
    const outcome = engine.entries.findLast(entry => entry.kind === 'user')
    if (engine.cancelling || (outcome?.kind === 'user' && (outcome.outcome === 'interrupted' || outcome.outcome === 'failed'))) setQueuePaused(true)
    else sendNext()
  }, [engine.status.busy, engine.activeId, engine.entries, engine.cancelling, queue, queuePaused, setQueuePaused, sendNext])

  /**
   * Envoie la revue accumulée.
   *
   * Elle part comme un message ordinaire : c'est bien une consigne adressée au
   * modèle, et la faire transiter par un canal à part la sortirait du fil, où
   * elle doit rester visible avec le reste de la conversation.
   */
  const submitReview = React.useCallback(() => {
    const prompt = review.toPrompt()
    engine.send(prompt)
    review.clear()
  }, [engine, review])

  const {
    options: modelOptions,
    selected: selectedModel,
    choose: chooseModel,
    showEffort,
    reasoningToggle,
    contextLimit,
  } = useModelChoice({
      provider,
      model: settings.model,
      setModel,
      onAddModel: () => {
        setSettingsTab('models')
        setSettingsOpen(true)
      },
    })


  /**
   * Reprise et fork d'un message envoyé.
   *
   * « Reprendre » ne fait que remettre le texte dans la zone de saisie : le
   * fil, lui, n'est pas amputé. Effacer les tours suivants supposerait de
   * réécrire la transcription du moteur, et perdre ce qui a été essayé après
   * serait plus coûteux qu'un fil un peu long.
   *
   * « Forker » demande au moteur un identifiant neuf au prochain envoi : le
   * passé est rechargé, la suite s'écrit ailleurs, et la conversation
   * d'origine reste consultable.
   */
  const [seed, setSeed] = React.useState<{ text: string; nonce: number; sessionId: string | null } | null>(
    null,
  )

  const editMessage = React.useCallback((text: string) => {
    setSeed({ text, nonce: Date.now(), sessionId: engine.activeId })
  }, [engine.activeId])

  const forkFrom = React.useCallback(
    (text: string) => {
      void engine.forkSession(mode === 'chat').then(fork => {
        if (fork) writeDraft(fork.id, text)
      })
    },
    [engine, mode, writeDraft],
  )

  /**
   * L'état tel que l'interface doit le montrer.
   *
   * Deux corrections sur ce que rapporte le moteur : la fenêtre de contexte,
   * que `useModelChoice` sait vraie, et le coût en dollars, calculé sur les
   * tarifs d'Anthropic. Sur un modèle qui tourne sur nos machines il ne
   * correspond à aucune dépense, et l'afficher tromperait sur ce que coûte
   * l'outil.
   */
  const engineStatus = React.useMemo(() => ({
    ...engine.status,
    contextLimit: contextLimit ?? engine.status.contextLimit,
    totalCostUsd: 0,
    lastCostUsd: null,
  }), [engine.status, contextLimit])

  const title = React.useMemo(() => {
    const firstUser = engine.entries.find(e => e.kind === 'user')
    return firstUser && firstUser.kind === 'user'
      ? firstUser.text.replace(/\s+/g, ' ').slice(0, 70)
      : 'Nouvelle conversation'
  }, [engine.entries])

  const hasPanels = panels.open.length > 0
  return (
    <FileLinkContext.Provider value={openFileFromThread}>
    <div className={`cell-body${split ? ' split' : ''}${hasPanels ? ' has-panels' : ''}`}
      style={!split ? { gridTemplateColumns: hasPanels ? `minmax(0, 1fr) auto ${layout.panels}px` : 'minmax(0, 1fr)' } : undefined}>
      <div className="workbench">
        <TopBar
          title={title}
          chat={mode === 'chat'}
          sessionActions={sessionActions}
          split={split}
          origin={engine.origin}
          project={project}
          sidebarHidden={sidebarHidden}
          onShowSidebar={onShowSidebar}
          isPanelOpen={panels.isOpen}
          onTogglePanel={panels.toggle}
          pluginPanels={extensions.panels}
          onOpenRestore={() => setRestoreOpen(true)}
          onOpenConnections={() => { setSettingsTab('mcp'); setSettingsOpen(true) }}
        />

        <div className={`conversation${engine.entries.length === 0 ? ' is-empty' : ''}`}>
          {engine.entries.length === 0 ? <div className="conversation-welcome"><h1>Que voulez-vous créer ?</h1><p>Décrivez votre idée, posez une question ou joignez un fichier.</p></div> : <Thread
            entries={engine.entries}
            busy={engine.status.busy}
            cancelling={engine.cancelling}
            waiting={Boolean(engine.pending)}
            onReview={mode === 'code' ? () => { if (!panels.isOpen('changes')) panels.toggle('changes') } : undefined}
            onShowAgents={() => { if (!panels.isOpen('agents')) panels.toggle('agents') }}
            onEdit={editMessage}
            onFork={forkFrom}
          />}

          {review.comments.length > 0 && (
            <ReviewBar
              comments={review.comments}
              disabled={engine.status.busy}
              onSend={submitReview}
              onClear={review.clear}
              onRemove={review.remove}
            />
          )}


          <Composer
            permission={engine.pending ? <PermissionCard key={engine.pending.requestId} pending={engine.pending} onDecide={engine.decidePermission} onInterrupt={engine.interrupt} /> : undefined}
            sessionId={engine.activeId}
            chat={engine.chat}
            transcriptId={engine.status.sessionId}
            liveSessionIds={engine.liveSessionIds}
            context={mode === 'code' && <ConversationContext workspace={workspace} project={project} worktree={engine.worktree} entries={engine.entries} settings={settings} resources={[
              ...corpora.corpora.filter(c => c.enabled && c.chunks > 0).map(c => ({ id: `corpus:${c.id}`, name: c.name, kind: 'corpus', remove: () => { void corpora.setEnabled(c.id, false) } })),
              ...extensions.extensions.filter(e => e.enabled && e.installed && e.kind === 'plugin').map(e => ({ id: `extension:${e.id}`, name: e.name, kind: 'extension', remove: () => { void extensions.setEnabled(e.id, false) } })),
            ]} onRemoveDirectory={dir => engine.updateSettings(s => ({ ...s, extraDirs: s.extraDirs.filter(d => d !== dir) }))} onOpenFile={openFileFromThread} />}
            preparing={attachments.busy}
            attachmentError={attachments.error}
            supportsImages={provider.config.kind === 'ollama' ? provider.models?.find(m => m.name === selectedModel)?.vision : provider.config.kind === 'llamacpp' ? provider.localModels.find(m => m.id === selectedModel)?.vision : undefined}
            busy={engine.status.busy}
            disabled={!workspace || !engine.ready}
            empty={engine.entries.length === 0}
            queued={queue.map(item => item.text)}
            queuePaused={queuePaused}
            onUnqueue={index => setQueue(current => current.filter((_, position) => position !== index))}
            onResumeQueue={() => { setQueuePaused(false); sendNext() }}
            attachments={attachments.items}
            workspace={workspace}
            corpora={corpora.corpora}
            extensions={extensions.extensions}
            models={modelOptions}
            settings={{ ...settings, model: selectedModel }}
            showEffort={showEffort}
            reasoningToggle={reasoningToggle}
            seed={seed?.sessionId === engine.activeId ? seed : null}
            status={engineStatus}
            onSubmit={submit}
            onInterrupt={engine.interrupt}
            onDropFiles={files => void attachments.addFiles(files)}
            onPasteFiles={files => void attachments.addFiles(files)}
            onPickFiles={() => void attachments.pick()}
            onRemoveAttachment={attachments.remove}
            onOpenAttachment={setPreview}
            onToggleCorpus={(id, enabled) => void corpora.setEnabled(id, enabled)}
            onToggleExtension={(id, enabled) => void extensions.setEnabled(id, enabled)}
            onOpenSettings={tab => { setSettingsTab(tab); setSettingsOpen(true) }}
            onOpenCatalog={onOpenCatalog}
            onPermissionMode={setPermissionMode}
            onModel={chooseModel}
            onEffort={setEffort}
          />
        </div>

        <StatusBar status={engineStatus} attention={engine.attention} />
      </div>

      {hasPanels && !split && (
        <Splitter
          value={layout.panels}
          min={PANELS_MIN}
          max={layout.panelsMax}
          side="after"
          onChange={layout.setPanels}
          label="Largeur des panneaux"
        />
      )}

      {panels.open.length > 0 && (
        <PanelHost
          sessionId={engine.activeId}
          open={panels.open}
          pluginPanels={extensions.panels}
          workspace={workspace}
          entries={engine.entries}
          busy={engine.status.busy}
          layout={layout}
          review={review}
          fileTarget={fileTarget}
          onClose={panels.close}
          onPrompt={editMessage}
        />
      )}

      {restoreOpen && engine.activeId && (
        <RestoreDialog
          sessionId={engine.activeId}
          busy={engine.status.busy}
          onClose={() => setRestoreOpen(false)}
        />
      )}

      {focused && settingsOpen && (
        <SettingsDialog
          provider={provider}
          corpora={corpora}
          extensions={extensions}
          reducedTools={settings.tools !== null}
          onReducedTools={setReducedTools}
          mcpServers={settings.mcpServers}
          onMcpServers={mcpServers => engine.updateSettings(current => ({ ...current, mcpServers }))}
          projects={projects}
          onUnarchive={onUnarchive}
          onOpenSession={onOpenSession}
          initialTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false)
            onSettingsClosed()
            setSettingsTab('provider')
          }}
        />
      )}

      {preview?.kind === 'text' && <TextAttachmentPreview item={preview} onClose={() => setPreview(null)} />}
      {preview?.kind === 'image' && (
        <Lightbox
          src={`data:${preview.mediaType};base64,${preview.data}`}
          alt={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
    </FileLinkContext.Provider>
  )
}
