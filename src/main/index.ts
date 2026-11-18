import { registerBrowserIpc, registerPreviewScheme } from './browser/surfaces.js'
import { distribution } from './backend/launch.js'
import { existsSync, mkdirSync } from 'node:fs'
import { PreferencesStore } from './preferences/store.js'
import { readPersonalActivity } from './session/personalActivity.js'
/**
 * Processus principal Electron.
 *
 * Tient la fenêtre et le moteur. Le moteur vit **ici** et non dans le rendu :
 * lui seul a accès au système de fichiers et aux sous-processus, et c'est ce
 * qui permet de garder le rendu isolé (`contextIsolation`, pas d'intégration
 * Node). Le rendu ne voit du moteur que la surface exposée par le préchargement.
 */

import { SessionOrigins } from './session/sessionOrigins.js'
import { SessionMetaStore } from './session/sessionMeta.js'
import { ProjectMetaStore } from './workspace/projectMeta.js'

import { registerNativeModules } from './nativeHost.js'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage } from 'electron'
import { join, resolve } from 'node:path'
import { Engine } from './engine/engine.js'
import { EngineManager, sameWorkspace } from './engine/engineManager.js'
import { Worktrees } from './vcs/worktrees.js'
import { SessionNotifications } from './session/sessionNotifications.js'
import { DiagnosticLog, Redactor } from './logging/logging.js'
import {
  DEFAULT_SESSION_SETTINGS,
  type PermissionDecision,
  type SessionSettings,
} from '../shared/protocol.js'
import { RoutineScheduler } from './routines/routineScheduler.js'
import { listProjects, setProjectsRoot } from './workspace/projects.js'
import { ChatWorkspaces } from './workspace/chats.js'
import { setProjectsRoot as setSessionsRoot } from './session/sessions.js'
import {
  engineConfigDir,
  Providers,
  type ProviderConfig,
} from './providers/index.js'
import {
  LocalModels,
  resolveRepo,
  type ModelProgress,
  type ModelsConfig,
  type QuantOption,
} from './models/index.js'
import { Extensions } from './extensions/plugins.js'
import { RagStore } from './rag/index.js'
import { Terminals } from './terminal/terminal.js'
import { McpRegistry } from './extensions/mcpRegistry.js'
import { confirmConnectorWrite } from './extensions/writeConfirmation.js'
import { configureProjectDataDirectory } from './backend/paths.js'
import { shell } from 'electron'
import type { MainContext } from './ipcContext.js'
import { registerEngineIpc } from './engine/ipc.js'
import { registerVcsIpc } from './vcs/ipc.js'
import { registerExtensionsIpc, registerMcpIpc } from './extensions/ipc.js'
import { registerProviderIpc } from './providers/ipc.js'
import { registerModelsIpc } from './models/ipc.js'
import { registerRagIpc } from './rag/ipc.js'
import { registerTerminalIpc } from './terminal/ipc.js'
import { LOCAL_TERMINALS_ONLY } from '../shared/terminal.js'
import { registerWorkspaceIpc } from './workspace/ipc.js'
import { registerRoutinesIpc } from './routines/ipc.js'
import { registerRewindIpc } from './session/ipc.js'


/**
 * Racine de l'application : le dossier qui contient `package.json`.
 *
 * `app.getAppPath()` et non `__dirname` : le bundler fige `__dirname` sur
 * l'emplacement du **fichier source** (`src/`) et non sur celui de la
 * sortie (`dist/`). Le préchargement était donc cherché dans `src/`,
 * introuvable, et la fenêtre s'ouvrait vide.
 */
const APP_ROOT = app.getAppPath()
/** Dossier des fichiers bundlés. */
const DIST = join(APP_ROOT, 'dist')
const DISTRIBUTION = distribution(APP_ROOT)
/**
 * Dossier du moteur, dont le build a produit l'exécutable du produit dans `dist/`.
 * Empaqueté : à côté de l'application ; en développement : le dépôt voisin.
 */
const ENGINE_ROOT = process.env[`${DISTRIBUTION.envPrefix}DESKTOP_ENGINE_DIR`] ?? process.env.DESKTOP_ENGINE_DIR
  ?? (app.isPackaged ? join(process.resourcesPath, 'engine') : resolve(APP_ROOT, '..', 'WhiteCode'))
configureProjectDataDirectory(`.${DISTRIBUTION.slug}-desktop`)
const originalHome = app.getPath('userData')
const originalDefaultHome = join(app.getPath('appData'), app.getName())
app.setName(DISTRIBUTION.product)
const desktopHome = process.env[`${DISTRIBUTION.envPrefix}DESKTOP_USER_DATA`] ?? (sameWorkspace(originalHome, originalDefaultHome) ? join(app.getPath('appData'), DISTRIBUTION.slug + '-desktop') : originalHome)
mkdirSync(desktopHome, { recursive: true })
app.setPath('userData', desktopHome)

registerPreviewScheme()
let window: BrowserWindow | null = null
let engines: EngineManager | null = null
const personalPreferences = new PreferencesStore(join(app.getPath('userData'), 'preferences.json'))
let notifications: SessionNotifications | null = null
let selectedSession: string | null = null
let requestedSession: string | null = null
let rendererReady = false
let notificationUnavailable = false

if (process.platform === 'win32') app.setAppUserModelId(DISTRIBUTION.bundleId + '.desktop')

/**
 * Liens profonds `<schéma>-desktop://session/<id>`.
 *
 * Copier un lien qui n'ouvre rien serait pire que ne pas l'offrir : il
 * circulerait dans des tickets et des messages en promettant un accès direct.
 * Le protocole est donc réellement enregistré, et le lien passe par le même
 * chemin qu'un clic sur une notification — `openNotificationSession`, qui
 * vérifie déjà que la session existe avant de l'afficher.
 *
 * Une **seule** instance : un second lancement, tel que le produit l'ouverture
 * d'un lien sous Windows et Linux, transmet son lien à l'instance en place au
 * lieu d'ouvrir une seconde fenêtre sur les mêmes données.
 */
const SCHEME = DISTRIBUTION.urlScheme + '-desktop'

function sessionFromDeepLink(urls: readonly string[]): string | null {
  for (const raw of urls) {
    if (!raw.startsWith(`${SCHEME}://`)) continue
    try {
      const url = new URL(raw)
      if (url.hostname !== 'session') continue
      const id = url.pathname.replace(/^\/+/, '')
      if (id) return decodeURIComponent(id)
    } catch {
      // Un lien mal formé se trouve dans la nature ; il ne doit rien casser.
    }
  }
  return null
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const id = sessionFromDeepLink(argv)
    if (id) openNotificationSession(id)
    else if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
  // macOS ne relance pas le programme : il livre l'adresse à l'instance vivante.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    const id = sessionFromDeepLink([url])
    if (id) openNotificationSession(id)
  })
}

function updateViewedSession(): void {
  const viewing = rendererReady && !requestedSession && window?.isFocused() && !window.isMinimized()
  engines?.setViewed(viewing ? selectedSession : null)
}

function openNotificationSession(id: string): void {
  if (!window || window.isDestroyed() || !engines?.list().some(s => s.id === id)) return
  requestedSession = id
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  updateViewedSession()
  toRenderer('engine:open-session', id)
}

/**
 * Réglages de session, conservés hors du moteur.
 *
 * Le moteur est recréé au changement de dossier de travail ; les réglages,
 * eux, sont un choix de l'utilisateur et n'ont pas à être repris à chaque
 * fois.
 */

/**
 * Dépôt du moteur, hors de `~/.claude`.
 *
 * WhiteCode utilise le CONFIG_HOME de cette distribution. L'application
 * relit ses sessions au même endroit, avant toute ouverture de l'historique.
 */
const ENGINE_HOME = engineConfigDir(app.getPath('userData'))
const sessionOrigins = new SessionOrigins(join(ENGINE_HOME, 'session-origins'))
/** Épingle, archive et titre choisi — à côté des transcripts, jamais dedans. */
const sessionMeta = new SessionMetaStore(join(ENGINE_HOME, 'session-meta'))
/** Nom, épingle, sources et retrait d'un projet — le dossier n'en sait rien. */
const projectMeta = new ProjectMetaStore(join(ENGINE_HOME, 'project-meta'))
const worktrees = new Worktrees(join(app.getPath('userData'), 'worktrees'))
const chatWorkspaces = new ChatWorkspaces(join(app.getPath('userData'), 'chats'))
// Opening a session/terminal must not race a checkout removal.
let workspaceOperation: Promise<unknown> = Promise.resolve()
function workspaceAction<T>(action: () => Promise<T> | T): Promise<T> {
  const next = workspaceOperation.then(action)
  workspaceOperation = next.catch(() => {})
  return next
}
async function worktreeFor(cwd: string) {
  return (await worktrees.list()).find(t => sameWorkspace(t.path, cwd))
}
setProjectsRoot(join(ENGINE_HOME, 'sessions'))
setSessionsRoot(join(ENGINE_HOME, 'sessions'))

/**
 * Corpus documentaires.
 *
 * Les scripts Python sont copiés dans `dist/` par le build : ils ne passent
 * pas par le bundler, qui ne saurait qu'en faire, mais doivent voyager avec
 * l'application.
 */
/** Extensions : plugins clonés localement, chargés par `--plugin-dir`. */
const extensions: Extensions = new Extensions(app.getPath('userData'), { appRoot: APP_ROOT, engineRoot: ENGINE_ROOT })
/**
 * Profil déjà utilisé : la Bureautique y était incluse et active par défaut.
 * Lu avant que le lancement n'écrive quoi que ce soit, pour distinguer une
 * mise à jour (on la réinstalle) d'une première installation (rien d'office).
 */
const existingProfile = ['provider.json', 'preferences.json', 'extensions.json']
  .some(file => existsSync(join(app.getPath('userData'), file)))

/**
 * Modèles locaux : poids en GGUF et serveur `llama-server`.
 *
 * Relu tout de suite comme le fournisseur : l'emplacement des poids est un
 * chemin disque que l'interface affiche dès l'ouverture des paramètres.
 */
const models = new LocalModels(app.getPath('userData'))
void models.load()

/**
 * Fournisseur de modèles, et le pont Ollama qu'il tient éventuellement.
 *
 * Après `models`, et non avant : le fournisseur `llamacpp` met le serveur
 * local en service lui-même, sur la même instance que l'écran des réglages —
 * deux instances se disputeraient le port.
 */
const secretVault = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value: string) => safeStorage.encryptString(value),
  decryptString: (value: Buffer) => safeStorage.decryptString(value),
  getSelectedStorageBackend: process.platform === 'linux' ? () => safeStorage.getSelectedStorageBackend() : undefined,
}
const applicationIpc = ipcMain
registerNativeModules(applicationIpc, app.getPath('userData'), () => window, pathToFileURL(join(DIST, 'renderer/index.html')).href)
const browserSurfaces = registerBrowserIpc(applicationIpc, () => window)
const providers = new Providers(app.getPath('userData'), models, progress =>
  toRenderer('models:progress', progress), secretVault,
)

const logRedactor = new Redactor()
let diagnosticLog: DiagnosticLog | undefined
let diagnosticLogUnavailable = false

function reportLogUnavailable(): void {
  toRenderer('engine:notice', { tone: 'error', text: 'Le journal de diagnostic est indisponible. Les échanges continuent sans journal local.' })
}

async function loadProvider(): Promise<ProviderConfig> {
  // DPAPI and Linux keyrings are available only after Electron is ready.
  await app.whenReady()
  const config = await providers.load()
  logRedactor.addSecrets([config.token ?? '', config.openaiApiKey ?? ''])
  return config
}

const rags = new RagStore(app.getPath('userData'), {
  index: join(DIST, 'rag', 'rag_index.py'),
  server: join(DIST, 'rag', 'rag_server.py'),
})
const mcpRegistry: McpRegistry = new McpRegistry(app.getPath('userData'), secretVault,
  () => rags.mcpConfig(),
  secret => logRedactor.addSecrets([secret]), () => extensions.connectors())

/**
 * Terminaux de la fenêtre.
 *
 * Le rendu est fourni paresseusement : les terminaux survivent au rechargement
 * de la page, une référence figée pointerait sur un rendu mort.
 */
const terminals = new Terminals(
  () => window && !window.isDestroyed() ? window.webContents : null,
  undefined,
  () => personalPreferences.get().terminalShell,
)

/** Icône de l'application et de la fenêtre. */
const APP_ICON = join(DIST, 'renderer', 'assets', 'icon.png')

function createWindow(): void {
  window = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 780,
    minHeight: 540,
    // Peint avant le premier rendu : sans cette teinte, la fenêtre s'ouvre
    // sur un fond blanc système puis bascule, ce qui produit un clignotement.
    backgroundColor: '#ffffff',
    title: DISTRIBUTION.product,
    icon: nativeImage.createFromPath(APP_ICON),
    // La barre de menu native (File / Edit / View / Window) n'offre rien que
    // l'application n'expose déjà, et rompt la ligne épurée : l'espace
    // au-dessus du contenu doit appartenir à l'application, pas au système.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(DIST, 'preload.js'),
      // Le rendu n'a aucun accès direct à Node : tout passe par le
      // préchargement, qui expose une surface nommée et vérifiée.
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const browserOwner = window
  // The privileged desktop and its password form only load the bundled UI.
  // Web pages use the existing isolated BrowserSurfaces instead.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-redirect', event => event.preventDefault())
  window.on('close', event => {
    // Préférence « Confirmer avant de fermer » : une réponse en cours serait
    // interrompue sans trace, d'où le réglage par défaut « si une réponse est
    // en cours ».
    const policy = personalPreferences.get().confirmClose
    if (policy === 'always' || (policy === 'busy' && engines?.isBusy)) {
      const choice = dialog.showMessageBoxSync(browserOwner, {
        type: 'question',
        buttons: ['Fermer', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        title: DISTRIBUTION.product,
        message: engines?.isBusy ? 'Une réponse est en cours. Fermer quand même ?' : `Fermer ${DISTRIBUTION.product} ?`,
        detail: engines?.isBusy ? 'Le tour en cours sera interrompu. Les conversations restent enregistrées.' : 'Les conversations restent enregistrées.',
      })
      if (choice !== 0) { event.preventDefault(); return }
    }
    browserSurfaces.closeOwner(browserOwner)
  })
  window.webContents.on('did-start-loading', () => browserSurfaces.closeOwner(browserOwner))
  window.webContents.on('render-process-gone', () => browserSurfaces.closeOwner(browserOwner))
  void window.loadFile(join(DIST, 'renderer', 'index.html'))
  window.webContents.on('did-start-loading', () => { rendererReady = false; updateViewedSession() })
  window.webContents.on('render-process-gone', () => { rendererReady = false; updateViewedSession() })
  window.webContents.on('did-finish-load', () => {
    if (diagnosticLogUnavailable) reportLogUnavailable()
  })
  window.on('closed', () => {
    notifications?.dispose()
    notifications = null
    selectedSession = requestedSession = null
    rendererReady = false
    engines?.stopAll()
    engines = null
    // Sans cela, les shells restent vivants après la fermeture de la fenêtre
    // et l'application ne quitte jamais vraiment.
    terminals.killAll()
    // Le pont Ollama garde un port ouvert : le fermer avec la fenêtre évite
    // qu'un processus survive à l'application.
    providers.stop()
    // Même raison, avec plus d'enjeu : `llama-server` tient plusieurs
    // gigaoctets de mémoire tant qu'il vit.
    models.stop()
    window = null
  })
  window.on('focus', updateViewedSession)
  window.on('blur', updateViewedSession)
  window.on('minimize', updateViewedSession)
  window.on('restore', updateViewedSession)
}

/** Relaie un événement du moteur vers le rendu, si la fenêtre existe encore. */
function toRenderer(channel: string, payload: unknown): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send(channel, payload)
  }
}

function ensureEngines(): EngineManager {
  if (engines) return engines
  engines = new EngineManager(options => new Engine({
    appRoot: APP_ROOT,
    engineRoot: ENGINE_ROOT,
    distribution: DISTRIBUTION,
    ...options,
    // À la racine de l'application plutôt que dans les données applicatives :
    // ce journal sert au développement, il doit être trouvable sans chercher.
    diagnosticLog,
    configDir: ENGINE_HOME,
    extraEnv: async (effort, model, signal) => {
      await loadProvider()
      signal?.throwIfAborted()
      // OFFICE_RUNTIME pointe vers le plugin Bureautique installé et activé ;
      // sans lui, la variable manque et ses skills le disent.
      const office = await extensions.officeRuntime()
      return { ...await providers.environment(effort, model, signal), OFFICE_NODE: process.execPath, ...(office ? { OFFICE_RUNTIME: office } : {}) }
    },
    mcpConfig: settings => mcpRegistry.configuration(settings),
    pluginDirs: () => extensions.pluginDirs(),
  }), sessionOrigins, chatWorkspaces)
  engines.on('origin-error', error => {
    diagnosticLog?.write('stderr', { type: 'routine_origin_save_failed', message: String(error) })
    toRenderer('engine:notice', { tone: 'error', text: 'La provenance de routine n’a pas pu être enregistrée. Elle risque de manquer après redémarrage.' })
  })
  engines.on('session', snapshot => toRenderer('engine:session', snapshot))
  engines.on('turn-end', id => toRenderer('engine:turn-end', id))
  notifications = new SessionNotifications(engines, options => {
    if (!Notification.isSupported()) throw new Error('Notifications unavailable')
    return new Notification({ ...options, title: options.title || DISTRIBUTION.product, icon: APP_ICON })
  }, openNotificationSession, () => {
    if (notificationUnavailable) return
    notificationUnavailable = true
    diagnosticLog?.write('stderr', { type: 'notification_unavailable' })
    toRenderer('engine:notice', { tone: 'info', text: 'Les notifications natives sont indisponibles. Les états des conversations restent visibles dans la barre latérale.' })
  }, () => personalPreferences.get().notifications, () => Boolean(window?.isFocused()))
  return engines
}

/**
 * Ordonnanceur des routines.
 *
 * Démarré une fois le processus prêt, et pas rattaché à une fenêtre : une
 * routine doit partir même si aucune session n'est ouverte.
 *
 * Le tir ouvre une **session isolée** puis lui envoie l'invite. C'est le point
 * qui compte : glisser le texte dans la session active ferait surgir, au
 * milieu du travail de quelqu'un, une demande qu'il n'a pas écrite — et le
 * modèle y répondrait avec le contexte du voisin.
 */
let routines: RoutineScheduler | null = null

async function startRoutines(): Promise<void> {
  if (routines) return
  let projets: readonly string[] = []
  const rafraichirProjets = async (): Promise<void> => {
    try {
      projets = (await listProjects(undefined, undefined, undefined, chatWorkspaces)).filter(p => !p.chat).map(p => p.cwd)
    } catch {
      // Un dossier de projets illisible ne doit pas empêcher l'application de
      // démarrer ; la liste restera vide jusqu'au tour suivant.
    }
  }
  await rafraichirProjets()

  routines = new RoutineScheduler(
    () => projets,
    async (cwd, task) => {
      // L'origine est posée à la création, pas après : le rendu reçoit
      // l'instantané dès la première publication, et une session qui
      // s'annoncerait « lancée par une routine » une seconde trop tard aurait
      // déjà été prise pour une conversation ordinaire.
      const session = ensureEngines().create(cwd, DEFAULT_SESSION_SETTINGS, undefined, {
        kind: 'routine',
        routineId: task.id,
        cron: task.cron,
        firedAt: Date.now(),
      })
      const completion = ensureEngines().waitForTurnEnd(session.id)
      await ensureEngines()
        .send(session.id, task.prompt, task.prompt)
        .catch(error => {
          diagnosticLog?.write('stderr', {
            type: 'routine_failed',
            cwd,
            id: task.id,
            error: String(error),
          })
          throw error
        })
      return {sessionId:session.id, completion}
    },
  )
  routines.start()

  // Au démarrage, les routines de la nuit sont déjà en retard : attendre la
  // première minute n'aiderait personne.
  void routines.tick()

  // La liste des projets bouge (un projet ouvert, un autre retiré). La relire
  // au rythme de l'ordonnanceur suffit : une routine créée dans un projet
  // inconnu partira au tour suivant, pas plus tard.
  setInterval(() => void rafraichirProjets(), 60_000).unref?.()
}

app.whenReady().then(async () => {
  // `autoHideMenuBar` la masque mais la laisse surgir sur Alt. La retirer
  // franchement est plus net : elle ne contient aucune action propre à
  // l'application.
  Menu.setApplicationMenu(null)
  // En développement, l'exécutable est Electron lui-même : l'enregistrement
  // doit alors désigner le script, sans quoi le lien lancerait Electron nu.
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(SCHEME, process.execPath, [resolve(process.argv[1]!)])
    }
  } else {
    app.setAsDefaultProtocolClient(SCHEME)
  }
  // A locked vault is surfaced in ProviderSettings; it must not erase the file.
  await loadProvider().catch(() => {})
  // Migration locale du coffre avant les premières lectures de connecteurs ; aucun téléchargement ici.
  await extensions.prepareMigrations().catch(() => {}) // Un registre endommagé reste signalé dans Plugins, sans bloquer la fenêtre.
  diagnosticLog = new DiagnosticLog(join(app.isPackaged ? app.getPath('userData') : APP_ROOT, 'protocol.log'), logRedactor, undefined, undefined, () => {
    diagnosticLogUnavailable = true
    reportLogUnavailable()
  })
  createWindow()
  // Après la fenêtre : une routine en retard ne doit pas retarder l'affichage.
  void startRoutines()
  // Catalogue officiel et migration de la Bureautique, en arrière-plan : un
  // clone GitHub ne doit pas retarder l'ouverture. Un échec est conservé et
  // affiché dans Paramètres > Plugins.
  void extensions.bootstrap(progress => toRenderer('ext:progress', progress), existingProfile, undefined, DISTRIBUTION.extensionCatalogs).catch(() => {})

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  engines?.stopAll()
  if (process.platform !== 'darwin') app.quit()
})

// ---------------------------------------------------------------------------
// Surface exposée au rendu
//
// Les 74 canaux vivent à côté de leur domaine ; ce fichier ne fait plus que les
// brancher. `MainContext` porte ce qu'ils ont en commun — la fenêtre, le relais
// vers le rendu, le gestionnaire de moteurs, la file des opérations
// d'arborescence — sous forme d'**accesseurs**, parce que la fenêtre et le
// gestionnaire sont réassignés au fil de la vie de l'application.
//
// Le câblage reste à la portée du module, avant `app.whenReady()` : le rendu
// peut appeler dès son premier effet, et un canal enregistré plus tard
// répondrait « no handler registered ».
// ---------------------------------------------------------------------------

const relayModel = (progress: ModelProgress) =>
  toRenderer('models:progress', progress)

const context: MainContext = {
  window: () => window,
  toRenderer,
  engines: ensureEngines,
  enginesIfAny: () => engines,
  workspaceAction,
  worktreeFor,
  appRoot: APP_ROOT,
  engineRoot: ENGINE_ROOT,
  engineHome: ENGINE_HOME,
  requestedSession: () => requestedSession,
  selectSession: id => {
    selectedSession = id
    rendererReady = true
    // A renderer selection also acknowledges a newer user navigation which superseded a toast click.
    requestedSession = null
    updateViewedSession()
  },
}

registerEngineIpc(applicationIpc, context, { worktrees, projectMeta })
registerVcsIpc(applicationIpc, context, { worktrees, busyTerminals: () => terminals.workingDirectories })
registerMcpIpc(applicationIpc, { mcpRegistry, confirmWrite: confirmConnectorWrite, openExternal: url => shell.openExternal(url) })
registerExtensionsIpc(applicationIpc, context, { extensions })
registerProviderIpc(applicationIpc, context, { providers, loadProvider })
registerModelsIpc(applicationIpc, context, { models, relay: relayModel })
registerRagIpc(applicationIpc, context, { rags })
registerTerminalIpc(applicationIpc, context, { terminals, targets: LOCAL_TERMINALS_ONLY })
registerWorkspaceIpc(applicationIpc, context, { sessionOrigins, sessionMeta, projectMeta, chats: chatWorkspaces })
registerRoutinesIpc(applicationIpc)
registerRewindIpc(applicationIpc, context)

/**
 * Reprise du modèle servi en dernier.
 *
 * `serving` était écrit à chaque mise en service mais jamais rejoué : le
 * serveur ne repartait qu'au premier tour du moteur, qui restait bloqué les
 * deux à trois minutes du chargement des poids — sans que l'interface montre
 * autre chose qu'une attente. On le relance ici, en tâche de fond : le
 * démarrage n'attend rien, et la progression arrive au rendu par le même canal
 * qu'une mise en service manuelle (`toRenderer` ne fait rien tant que la
 * fenêtre n'existe pas).
 *
 * Seulement pour `llamacpp` : c'est le seul fournisseur dont le serveur local
 * soit la cible. Sous Ollama ou avec un serveur distant, charger 17 Go pour
 * personne serait pire que l'attente qu'on supprime.
 */
void (async () => {
  const [config, provider] = await Promise.all([
    models.load(),
    loadProvider(),
  ])
  if (provider.kind !== 'llamacpp') return
  // Même règle que le fournisseur : son choix explicite prime sur le dernier
  // modèle servi, sinon le démarrage chargerait l'un et le premier tour
  // l'autre.
  const id = provider.llamacppModel ?? config.serving
  // `auto` comme au premier tour d'une session ordinaire : seul un effort
  // « low » demande `off`, et il relancera alors le serveur de lui-même.
  if (id) await models.start(id, relayModel, 'auto')
})().catch(() => {
  // Storage errors are displayed by provider:get; no unhandled rejection or
  // automatic overwrite while the vault is locked.
})

// Personal preferences are shared by all conversations and persisted before acknowledgement.
applicationIpc.handle('activity:read', (_event, period: unknown) => readPersonalActivity(join(ENGINE_HOME, 'sessions'), period, personalPreferences.get().modules.activity))
applicationIpc.handle('preferences:get', () => ({ value: personalPreferences.get(), error: personalPreferences.loadError, notificationsSupported: Notification.isSupported(), platform: process.platform }))
applicationIpc.handle('preferences:save', async (_event, value: unknown) => {
  const previousNotifications = personalPreferences.get().notifications
  const previousLogin = personalPreferences.get().launchAtLogin
  const saved = await personalPreferences.save(value)
  if (saved.launchAtLogin !== previousLogin) applyLaunchAtLogin(saved.launchAtLogin)
  if (JSON.stringify(previousNotifications) !== JSON.stringify(saved.notifications)) notifications?.dismissAll()
  return saved
})
/**
 * Ouverture à la connexion du système. Hors paquet, c'est `electron.exe` qui
 * démarre : il lui faut le chemin de l'application en argument.
 */
function applyLaunchAtLogin(openAtLogin: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return
  app.setLoginItemSettings({ openAtLogin, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] })
}
applicationIpc.handle('preferences:test', async () => {
  if (!Notification.isSupported()) throw new Error('Les notifications système sont indisponibles sur ce poste.')
  await new Promise(resolve => setTimeout(resolve, 3000))
  const prefs = personalPreferences.get().notifications
  if (!prefs.enabled) throw new Error('Les notifications sont désactivées.')
  const notice = new Notification({ title: DISTRIBUTION.product, body: 'Notification de test. Cliquez pour revenir à l’application.', silent: !prefs.sound, icon: APP_ICON })
  notice.once('click', () => { if (window && !window.isDestroyed()) { window.restore(); window.show(); window.focus() } })
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { notice.close(); reject(new Error('Le système n’a pas confirmé la remise. Vérifiez ses autorisations et le mode Ne pas déranger.')) }, 5000)
    notice.once('show', () => { clearTimeout(timeout); resolve() })
    notice.once('failed', () => { clearTimeout(timeout); reject(new Error('Le système a refusé la notification.')) })
    notice.show()
  })
})
