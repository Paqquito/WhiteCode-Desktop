import type { GitWorkflowState, WorkflowRequest, WorkflowPR } from './vcs/workflow.js'
import type { SurfaceSource, SurfaceState, SurfaceBounds, SurfaceCommand, BrowserSelection } from '../shared/browser.js'
import type { Preferences } from '../shared/preferences.js'
import type { ActivityPeriod, PersonalActivity } from '../shared/personalActivity.js'
import type { GitAction, PullRequestInfo } from './vcs/git.js'
/**
 * Pont entre le processus principal et le rendu.
 *
 * Le rendu tourne isolé, sans accès à Node. Ce fichier est le **seul** endroit
 * où une surface lui est ouverte : elle est nommée, close, et ne laisse passer
 * que ce que l'application a besoin de faire. Exposer `ipcRenderer` en entier
 * reviendrait à rendre l'isolation décorative.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SessionSnapshot } from './engine/engineManager.js'
import type { SessionMeta } from '../shared/sessionMeta.js'
import type { ProjectMeta } from '../shared/projectMeta.js'
import type { McpEntry, McpView, McpProbe, ConnectorStatus, ConnectorResult, ConnectorView } from './extensions/mcpRegistry.js'
export type { McpEntry, McpView, McpProbe, ConnectorStatus, ConnectorResult, ConnectorView } from './extensions/mcpRegistry.js'
import type { RoutineRun } from './routines/routineHistory.js'
export type { RoutineRun } from './routines/routineHistory.js'
import type { Routine } from './routines/routines.js'
export type { Routine } from './routines/routines.js'
import type { ManagedWorktree, RepositoryInfo, WorktreeRequest } from './vcs/worktrees.js'
export type { ManagedWorktree, RepositoryInfo, WorktreeRequest } from './vcs/worktrees.js'
export type { SessionSnapshot } from './engine/engineManager.js'
import type { Attachment } from './workspace/attachments.js'
import type { DirEntry, FileContent } from './workspace/files.js'
import type { GitSummary } from './vcs/git.js'
import type { RestorePoint } from './session/sessions.js'
import type { RewindResult } from './session/rewind.js'
import type { TerminalTargets } from '../shared/terminal.js'
import type {
  InstalledModel,
  ModelProgress,
  ModelsConfig,
  QuantOption,
  ResolveResult,
  ServerStatus,
} from './models/index.js'
import type {
  GatewayModel,
  OllamaModel,
  ProviderConfig,
  PullProgress,
} from './providers/index.js'
import type { ExtensionProgress, ExtensionState, ExtensionSource } from './extensions/plugins.js'
import type { Corpus, IndexProgress } from './rag/index.js'
import type { Project } from './workspace/projects.js'
import type {
  EngineMessage,
  PermissionDecision,
  SessionSettings,
} from '../shared/protocol.js'
import type { TranscriptEntry } from './session/sessions.js'

export type Notice = { tone: 'info' | 'error'; text: string }
export type { Attachment, DirEntry, FileContent, Project, TranscriptEntry }
export type { GitFile, GitSummary } from './vcs/git.js'
export type { RestorePoint } from './session/sessions.js'
export type { RewindResult } from './session/rewind.js'
export type { TerminalTarget, TerminalTargets } from '../shared/terminal.js'
export type {
  CatalogEntry,
  CustomModel,
  GgufFile,
  InstalledModel,
  ModelProgress,
  ModelsConfig,
  QuantOption,
  ResolvedRepo,
  ResolveResult,
  RuntimeBackend,
  ServerStatus,
} from './models/index.js'
export type {
  GatewayModel,
  OllamaModel,
  ProviderConfig,
  ProviderKind,
  PullProgress,
} from './providers/index.js'
export type { Corpus, IndexProgress } from './rag/index.js'
export type { ExtensionKind, ExtensionProgress, ExtensionState, ExtensionSource } from './extensions/plugins.js'
export type { SessionSummary } from './workspace/projects.js'

const api = {
  invokeModule(id: string, method: string, input?: unknown): Promise<unknown> {
    return ipcRenderer.invoke('module:invoke', { id, method, input })
  },

  surfaceOpen(id:string,source:SurfaceSource):Promise<SurfaceState> {return ipcRenderer.invoke('surface:open',{id,source})},
  surfaceBounds(id:string,bounds:SurfaceBounds):Promise<void> {return ipcRenderer.invoke('surface:bounds',{id,bounds})},
  surfaceClose(id:string):Promise<void> {return ipcRenderer.invoke('surface:close',id)},
  surfaceCommand(id:string,command:SurfaceCommand,value?:string):Promise<BrowserSelection|void> {return ipcRenderer.invoke('surface:command',{id,command,value})},
  onSurfaceState(handler:(state:SurfaceState)=>void):()=>void {const listener=(_event:unknown,state:SurfaceState)=>handler(state);ipcRenderer.on('surface:state',listener);return()=>ipcRenderer.removeListener('surface:state',listener)},

  listMcp(): Promise<McpView[]> { return ipcRenderer.invoke('mcp:list') },
  getMcp(id: string): Promise<McpEntry> { return ipcRenderer.invoke('mcp:get', id) },
  saveMcp(entry: McpEntry): Promise<void> { return ipcRenderer.invoke('mcp:save', entry) },
  enableMcp(id: string, enabled: boolean): Promise<void> { return ipcRenderer.invoke('mcp:enabled', { id, enabled }) },
  removeMcp(id: string): Promise<void> { return ipcRenderer.invoke('mcp:remove', id) },
  probeMcp(id: string): Promise<McpProbe> { return ipcRenderer.invoke('mcp:probe', id) },
  listConnectors(): Promise<ConnectorView[]> { return ipcRenderer.invoke('connector:list') },
  connectorStatus(id: string): Promise<ConnectorStatus> { return ipcRenderer.invoke('connector:status', id) },
  setConnectorSecret(id: string, name: string, value: string | null): Promise<void> { return ipcRenderer.invoke('connector:secret', { id, name, value }) },
  callConnector(id: string, tool: string, args: unknown, cwd?: string): Promise<ConnectorResult> { return ipcRenderer.invoke('connector:call', { id, tool, args, cwd }) },
  openConnectorLink(id: string, link: string, params: Record<string, string | number>): Promise<void> { return ipcRenderer.invoke('connector:open', { id, link, params }) },
  openPanelUrl(url: string): Promise<void> { return ipcRenderer.invoke('panel:open-url', url) },


  // Routines : par projet, d'où le `cwd` plutôt qu'un identifiant de session.
  routineHistory(cwd: string): Promise<RoutineRun[]> { return ipcRenderer.invoke('routines:history',cwd) },
  updateRoutine(cwd: string, id: string, patch: {cron?:string;prompt?:string;recurring?:boolean;paused?:boolean}): Promise<void> { return ipcRenderer.invoke('routines:update',{cwd,id,patch}) },
  listRoutines(cwd: string): Promise<Routine[]> { return ipcRenderer.invoke('routines:list', cwd) },
  addRoutine(cwd: string, draft: { cron: string; prompt: string; recurring?: boolean }): Promise<Routine> {
    return ipcRenderer.invoke('routines:add', { cwd, ...draft })
  },
  removeRoutine(cwd: string, id: string): Promise<void> { return ipcRenderer.invoke('routines:remove', { cwd, id }) },
  // --- Conversation ------------------------------------------------------

  /**
   * Envoie un message et lance un tour.
   *
   * `content` accepte une chaîne, ou une suite de blocs quand des pièces
   * jointes accompagnent le message.
   */
  send(id: string, text: string, content: string | unknown[]): Promise<void> {
    return ipcRenderer.invoke('engine:send', { id, text, content })
  },

  /** Arbitre une demande de permission. */
  respondToPermission(
    id: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<void> {
    return ipcRenderer.invoke('engine:permission', { id, requestId, decision })
  },

  /** Interrompt le tour en cours. */
  interrupt(id: string): Promise<void> {
    return ipcRenderer.invoke('engine:interrupt', id)
  },

  /** Crée une session indépendante sans interrompre les autres. */
  createSession(cwd: string, settings: SessionSettings, worktree?: WorktreeRequest, chat?: boolean): Promise<SessionSnapshot> {
    return ipcRenderer.invoke('engine:create', { cwd, settings, worktree, chat })
  },
  repository(cwd: string): Promise<RepositoryInfo> { return ipcRenderer.invoke('worktrees:repository', cwd) },
  listWorktrees(): Promise<ManagedWorktree[]> { return ipcRenderer.invoke('worktrees:list') },
  removeWorktree(id: string): Promise<void> { return ipcRenderer.invoke('worktrees:remove', id) },

  /** Tours auxquels le disque peut être ramené, du plus ancien au plus récent. */
  listRestorePoints(id: string): Promise<RestorePoint[]> {
    return ipcRenderer.invoke('rewind:list', id)
  },

  /**
   * Prévisualise puis, une fois confirmée, applique une restauration.
   *
   * L'aperçu (`dryRun`) ne touche à rien et sert à montrer ce qui changerait ;
   * l'écriture est refusée tant qu'un tour est en cours dans le dossier.
   */
  rewindFiles(id: string, messageId: string, dryRun: boolean, fingerprint?: string): Promise<RewindResult> {
    return ipcRenderer.invoke('rewind:run', { id, messageId, dryRun, fingerprint })
  },

  /**
   * Le prochain envoi forke la session : même passé, identifiant neuf.
   *
   * La conversation d'origine n'est pas touchée ; on repart d'un point sans
   * perdre ce qui a été tenté après.
   */
  forkSession(id: string, chat?: boolean): Promise<SessionSnapshot> {
    return ipcRenderer.invoke('engine:fork', id, chat)
  },

  liveSessions(): Promise<SessionSnapshot[]> {
    return ipcRenderer.invoke('engine:list')
  },
  getSession(id: string): Promise<SessionSnapshot> {
    return ipcRenderer.invoke('engine:get', id)
  },
  requestedSession(): Promise<string | null> {
    return ipcRenderer.invoke('engine:requested-session')
  },
  viewSession(id: string | null): Promise<void> {
    return ipcRenderer.invoke('engine:view', id)
  },
  onOpenSession(handler: (id: string) => void): () => void {
    const listener = (_event: unknown, id: string) => handler(id)
    ipcRenderer.on('engine:open-session', listener)
    return () => ipcRenderer.removeListener('engine:open-session', listener)
  },

  // --- Espace de travail -------------------------------------------------

  defaultWorkspace(): Promise<string> {
    return ipcRenderer.invoke('workspace:default')
  },

  chooseWorkspace(): Promise<string | null> {
    return ipcRenderer.invoke('workspace:choose')
  },

  // --- Projets et sessions ------------------------------------------------

  /** Nom, épingle, dossiers sources ou retrait d'un projet ; retouche partielle. */
  setProjectMeta(cwd: string, patch: ProjectMeta): Promise<ProjectMeta | null> {
    return ipcRenderer.invoke('projects:meta', { cwd, patch })
  },

  /** Ouvre un dossier dans l'explorateur ; rend le message d'erreur, ou ''. */
  revealPath(path: string): Promise<string> {
    return ipcRenderer.invoke('workspace:reveal', path)
  },

  /** Tous les projets connus, chacun avec ses sessions. */
  listProjects(): Promise<Project[]> {
    return ipcRenderer.invoke('projects:list')
  },

  /**
   * Épingle, archive ou renomme une conversation.
   *
   * Retouche **partielle** : ce qui n'est pas dans `patch` n'est pas touché.
   * Un titre vide rend le titre déduit du transcript — c'est la façon
   * d'annuler un renommage.
   */
  setSessionMeta(cwd: string, sessionId: string, patch: SessionMeta): Promise<SessionMeta | null> {
    return ipcRenderer.invoke('sessions:meta', { cwd, sessionId, patch })
  },

  /** Transcript d'une session, pour réafficher une conversation reprise. */
  readTranscript(cwd: string, sessionId: string): Promise<TranscriptEntry[]> {
    return ipcRenderer.invoke('sessions:transcript', { cwd, sessionId })
  },

  /** Rattache les prochains tours à une session existante. */
  resumeSession(sessionId: string, cwd: string, settings: SessionSettings): Promise<SessionSnapshot> {
    return ipcRenderer.invoke('sessions:resume', { sessionId, cwd, settings })
  },

  // --- Fichiers -----------------------------------------------------------

  /** Contenu d'un dossier, un niveau à la fois. */
  readDirectory(root: string, path?: string): Promise<DirEntry[]> {
    return ipcRenderer.invoke('files:read-dir', { root, path })
  },

  /** Contenu d'un fichier texte, borné. */
  readFile(root: string, path: string): Promise<FileContent> {
    return ipcRenderer.invoke('files:read-file', { root, path })
  },

  // --- Pièces jointes -----------------------------------------------------

  /** Prépare des fichiers déposés ou choisis pour l'envoi. */
  prepareAttachments(paths: string[]): Promise<Attachment[]> {
    return ipcRenderer.invoke('attachments:prepare', paths)
  },

  /** Ouvre le sélecteur de fichiers ; rend les chemins choisis. */
  chooseAttachments(): Promise<string[]> {
    return ipcRenderer.invoke('attachments:choose')
  },

  /**
   * Chemin disque d'un fichier glissé dans la fenêtre.
   *
   * Depuis Electron 32, `File.path` n'existe plus : le rendu ne reçoit qu'un
   * `File` opaque, sans indication de son origine. `webUtils.getPathForFile`
   * est la seule voie, et elle n'est accessible qu'ici, dans le préchargement.
   */
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file)
  },

  // --- Terminaux ----------------------------------------------------------

  /** `remote` absent : shell local. Sinon, session SSH dans le même PTY. */
  createTerminal(
    cwd: string,
    cols: number,
    rows: number,
    remote?: string,
  ): Promise<string> {
    return ipcRenderer.invoke('terminal:create', { cwd, cols, rows, remote })
  },

  /**
   * Rattache le panneau à un shell laissé en vie, s'il en existe un.
   *
   * Rend sa sortie déjà émise, pour que la réouverture retrouve l'écran tel
   * qu'il était plutôt qu'un cadre vide.
   */
  attachTerminal(cwd: string, remote?: string): Promise<{ id: string; scrollback: string } | null> {
    return ipcRenderer.invoke('terminal:attach', { cwd, remote })
  },

  writeTerminal(id: string, data: string): Promise<void> {
    return ipcRenderer.invoke('terminal:write', { id, data })
  },

  resizeTerminal(id: string, cols: number, rows: number): Promise<void> {
    return ipcRenderer.invoke('terminal:resize', { id, cols, rows })
  },

  killTerminal(id: string): Promise<void> {
    return ipcRenderer.invoke('terminal:kill', id)
  },

  /**
   * Applique les réglages de session.
   *
   * Mode de permission, modèle et effort. Ils deviennent des drapeaux au
   * prochain lancement du moteur, et sont poussés en direct si un tour est en
   * cours.
   */
  setSessionSettings(id: string, settings: SessionSettings): Promise<SessionSnapshot> {
    return ipcRenderer.invoke('engine:settings', { id, settings })
  },

  /**
   * Réécrit un fichier de l'espace de travail.
   *
   * Le confinement est revérifié côté processus principal : cette surface est
   * accessible à tout le rendu, elle ne peut pas être sa propre garantie.
   */
  writeFile(
    root: string,
    path: string,
    text: string,
    expectedText?: string,
  ): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke('files:write', { root, path, text, expectedText })
  },

  /** Fichiers correspondant à une requête, pour la mention « @ ». */
  searchFiles(
    root: string,
    query: string,
  ): Promise<Array<{ path: string; relative: string; kind: 'file' | 'dir' }>> {
    return ipcRenderer.invoke('files:search', { root, query })
  },

  // --- Git ----------------------------------------------------------------

  /** État du dépôt : branche et fichiers modifiés. */
  getPreferences(): Promise<{ value: Preferences; error: string | null; notificationsSupported: boolean; platform?: string }> { return ipcRenderer.invoke('preferences:get') },
  savePreferences(value: Preferences): Promise<Preferences> { return ipcRenderer.invoke('preferences:save', value) },
  testNotification(): Promise<void> { return ipcRenderer.invoke('preferences:test') },
  personalActivity(period: ActivityPeriod): Promise<PersonalActivity> { return ipcRenderer.invoke('activity:read', period) },

  gitWorkflow(cwd: string): Promise<GitWorkflowState> { return ipcRenderer.invoke('git:workflow', cwd) },
  gitWorkflowAction(cwd: string, request: WorkflowRequest): Promise<string> { return ipcRenderer.invoke('git:workflow-action', { cwd, request }) },
  workflowPR(cwd: string, remote: string): Promise<WorkflowPR> { return ipcRenderer.invoke('git:workflow-pr', { cwd, remote }) },
  gitAction(cwd: string, action: GitAction): Promise<void> { return ipcRenderer.invoke('git:action', { cwd, action }) },
  pullRequest(cwd: string): Promise<PullRequestInfo> { return ipcRenderer.invoke('git:pr', cwd) },

  gitSummary(cwd: string): Promise<GitSummary> {
    return ipcRenderer.invoke('git:summary', cwd)
  },

  /**
   * Diff unifié d'un fichier, demandé à l'ouverture de sa ligne.
   *
   * Un par un, et non tous d'un coup : un dépôt en cours de refonte compte
   * des centaines de fichiers modifiés, et rapatrier l'ensemble pour n'en
   * lire qu'un serait payer le pire cas à chaque ouverture du panneau.
   */
  gitDiff(
    cwd: string,
    path: string,
    staged: boolean,
    untracked: boolean,
  ): Promise<string> {
    return ipcRenderer.invoke('git:diff', { cwd, path, staged, untracked })
  },

  onTerminalData(
    handler: (payload: { id: string; data: string }) => void,
  ): () => void {
    const listener = (_e: unknown, payload: { id: string; data: string }) =>
      handler(payload)
    ipcRenderer.on('terminal:data', listener)
    return () => ipcRenderer.removeListener('terminal:data', listener)
  },

  onTerminalExit(
    handler: (payload: { id: string; exitCode: number }) => void,
  ): () => void {
    const listener = (_e: unknown, payload: { id: string; exitCode: number }) =>
      handler(payload)
    ipcRenderer.on('terminal:exit', listener)
    return () => ipcRenderer.removeListener('terminal:exit', listener)
  },

  // --- Fournisseur ---------------------------------------------------------

  getProvider(): Promise<ProviderConfig> {
    return ipcRenderer.invoke('provider:get')
  },

  setProvider(config: ProviderConfig): Promise<void> {
    return ipcRenderer.invoke('provider:set', config)
  },

  listOllamaModels(
    host: string,
  ): Promise<{ ok: true; models: OllamaModel[] } | { ok: false; reason: string }> {
    return ipcRenderer.invoke('provider:ollama-models', host)
  },

  /** Modèles publiés par une passerelle compatible, avec leurs noms lisibles. */
  listOpenAIModels(baseUrl: string, apiKey: string): Promise<{ ok: true; models: GatewayModel[] } | { ok: false; reason: string }> {
    return ipcRenderer.invoke('provider:openai-models', { baseUrl, apiKey })
  },
  listGatewayModels(
    baseUrl: string,
    token: string,
  ): Promise<{ ok: true; models: GatewayModel[] } | { ok: false; reason: string }> {
    return ipcRenderer.invoke('provider:gateway-models', { baseUrl, token })
  },

  /** Télécharge un modèle dans Ollama ; la progression arrive par événements. */
  pullModel(host: string, name: string): Promise<boolean> {
    return ipcRenderer.invoke('provider:pull', { host, name })
  },

  onPullProgress(handler: (progress: PullProgress) => void): () => void {
    const listener = (_e: unknown, progress: PullProgress) => handler(progress)
    ipcRenderer.on('provider:pull-progress', listener)
    return () => ipcRenderer.removeListener('provider:pull-progress', listener)
  },

  // --- Modèles locaux -------------------------------------------------------

  modelsConfig(): Promise<ModelsConfig> {
    return ipcRenderer.invoke('models:config')
  },

  setModelsConfig(next: Partial<ModelsConfig>): Promise<ModelsConfig> {
    return ipcRenderer.invoke('models:set-config', next)
  },

  /** Ouvre le sélecteur de dossier ; rend la configuration mise à jour. */
  chooseModelsRoot(): Promise<ModelsConfig | null> {
    return ipcRenderer.invoke('models:choose-root')
  },

  installedModels(): Promise<InstalledModel[]> {
    return ipcRenderer.invoke('models:installed')
  },

  /** Télécharge des poids depuis Hugging Face ; progression par événements. */
  downloadModel(id: string): Promise<boolean> {
    return ipcRenderer.invoke('models:download', id)
  },

  cancelModel(id: string): Promise<void> {
    return ipcRenderer.invoke('models:cancel', id)
  },

  removeModel(id: string): Promise<void> {
    return ipcRenderer.invoke('models:remove', id)
  },

  /** Met un modèle en service ; installe `llama-server` au premier appel. */
  startModel(id: string): Promise<boolean> {
    return ipcRenderer.invoke('models:start', id)
  },

  stopModel(): Promise<void> {
    return ipcRenderer.invoke('models:stop')
  },

  modelServerStatus(): Promise<ServerStatus> {
    return ipcRenderer.invoke('models:status')
  },

  onModelProgress(handler: (progress: ModelProgress) => void): () => void {
    const listener = (_e: unknown, progress: ModelProgress) => handler(progress)
    ipcRenderer.on('models:progress', listener)
    return () => ipcRenderer.removeListener('models:progress', listener)
  },

  // --- Hugging Face ---------------------------------------------------------

  /**
   * Résout une adresse collée : le dépôt existe-t-il, et qu'y trouve-t-on ?
   *
   * Les messages d'échec sont rédigés pour l'utilisateur et destinés à être
   * affichés tels quels.
   */
  resolveHuggingFace(input: string): Promise<ResolveResult> {
    return ipcRenderer.invoke('hf:resolve', input)
  },

  /**
   * Installe une quantification choisie.
   *
   * La progression arrive par `onModelProgress`, sous l'identifiant de
   * l'option : le téléchargement dure des minutes et ne peut pas être attendu
   * sur la promesse seule.
   */
  installHuggingFace(repo: string, option: QuantOption): Promise<boolean> {
    return ipcRenderer.invoke('hf:install', { repo, option })
  },

  // --- Corpus documentaires -------------------------------------------------

  listCorpora(): Promise<Corpus[]> {
    return ipcRenderer.invoke('rag:list')
  },

  corporaReady(): Promise<boolean> {
    return ipcRenderer.invoke('rag:ready')
  },

  createCorpus(name: string, source: string, embedding: string): Promise<Corpus> {
    return ipcRenderer.invoke('rag:create', { name, source, embedding })
  },

  removeCorpus(id: string): Promise<void> {
    return ipcRenderer.invoke('rag:remove', id)
  },

  enableCorpus(id: string, enabled: boolean): Promise<void> {
    return ipcRenderer.invoke('rag:enable', { id, enabled })
  },

  indexCorpus(id: string): Promise<void> {
    return ipcRenderer.invoke('rag:index', id)
  },

  prepareCorpusEnvironment(): Promise<boolean> {
    return ipcRenderer.invoke('rag:prepare')
  },

  chooseCorpusSource(): Promise<string | null> {
    return ipcRenderer.invoke('rag:choose-source')
  },

  /** Progression d'indexation : l'opération dure des minutes. */
  onCorpusProgress(
    handler: (payload: { id: string; progress: IndexProgress }) => void,
  ): () => void {
    const listener = (
      _e: unknown,
      payload: { id: string; progress: IndexProgress },
    ) => handler(payload)
    ipcRenderer.on('rag:progress', listener)
    return () => ipcRenderer.removeListener('rag:progress', listener)
  },

  // --- Extensions -----------------------------------------------------------

  listExtensionSources(): Promise<ExtensionSource[]> { return ipcRenderer.invoke('ext:sources') },
  addExtensionSource(repository: string, ref?: string): Promise<void> { return ipcRenderer.invoke('ext:source-add', { repository, ref }) },
  refreshExtensionSource(id: string, ref?: string): Promise<void> { return ipcRenderer.invoke('ext:source-refresh', { id, ref }) },
  removeExtensionSource(id: string): Promise<void> { return ipcRenderer.invoke('ext:source-remove', id) },
  diagnoseExtension(id: string): Promise<string> { return ipcRenderer.invoke('ext:diagnose', id) },
  extensionCatalogueStatus(): Promise<import('./extensions/plugins.js').CatalogueStatus> { return ipcRenderer.invoke('ext:catalogue-status') },
  retryExtensionCatalogue(): Promise<void> { return ipcRenderer.invoke('ext:bootstrap') },

  listExtensions(): Promise<ExtensionState[]> {
    return ipcRenderer.invoke('ext:list')
  },

  installExtension(id: string, ref?: string): Promise<boolean> {
    return ipcRenderer.invoke('ext:install', { id, ref })
  },

  updateExtension(id: string, ref?: string): Promise<boolean> {
    return ipcRenderer.invoke('ext:update', { id, ref })
  },

  removeExtension(id: string): Promise<void> {
    return ipcRenderer.invoke('ext:remove', id)
  },

  enableExtension(id: string, enabled: boolean): Promise<void> {
    return ipcRenderer.invoke('ext:enable', { id, enabled })
  },

  /** Progression d'installation : un clone dure plusieurs dizaines de secondes. */
  onExtensionProgress(handler: (progress: ExtensionProgress) => void): () => void {
    const listener = (_e: unknown, progress: ExtensionProgress) => handler(progress)
    ipcRenderer.on('ext:progress', listener)
    return () => ipcRenderer.removeListener('ext:progress', listener)
  },

  // --- Cibles des terminaux ------------------------------------------------------------

  /** Catalogue fourni par la distribution, sans arguments de processus. */
  terminalTargets(): Promise<TerminalTargets> {
    return ipcRenderer.invoke('terminal:targets')
  },

  // --- Flux ---------------------------------------------------------------

  /**
   * S'abonne au flux du moteur. Rend la fonction de désabonnement.
   *
   * Le rappel est enveloppé : l'objet `IpcRendererEvent` d'Electron ne doit
   * pas franchir le pont, il porte des références au processus principal.
   */
  onSession(handler: (session: SessionSnapshot) => void): () => void {
    const listener = (_event: unknown, session: SessionSnapshot) => handler(session)
    ipcRenderer.on('engine:session', listener)
    return () => ipcRenderer.removeListener('engine:session', listener)
  },

  onNotice(handler: (notice: Notice) => void): () => void {
    const listener = (_event: unknown, notice: Notice) => handler(notice)
    ipcRenderer.on('engine:notice', listener)
    return () => ipcRenderer.removeListener('engine:notice', listener)
  },

  onTurnEnd(handler: (id: string) => void): () => void {
    const listener = (_event: unknown, id: string) => handler(id)
    ipcRenderer.on('engine:turn-end', listener)
    return () => ipcRenderer.removeListener('engine:turn-end', listener)
  },
}

export type EngineApi = typeof api

contextBridge.exposeInMainWorld('engine', api)
