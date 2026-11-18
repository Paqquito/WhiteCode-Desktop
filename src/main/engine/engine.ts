/** One native WhiteCode process per desktop turn; history is reopened through its public CLI. */
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import treeKill from 'tree-kill'
import { backendArguments, backendCommand, backendEnvironment, configureBackend, distribution, DESKTOP_DELIVERY_INSTRUCTIONS, type Distribution } from '../backend/launch.js'
import { WhiteCodeProtocol, whiteCodeContent, whiteCodeTools, approvalMode } from '../backend/protocol.js'
import { inferenceRelay } from '../backend/inferenceRelay.js'
import { whiteCodeExtensions } from '../backend/extensions.js'
import { DesktopFileDelivery } from '../backend/fileDelivery.js'
import { McpSession } from '../extensions/mcpSession.js'
import { requireInferenceEndpoint } from '../../shared/inferenceEndpoint.js'
import { DiagnosticLog, Redactor } from '../logging/logging.js'
import type { McpLaunch } from '../extensions/mcpRegistry.js'
import {
  DEFAULT_SESSION_SETTINGS,
  type EffortLevel,
  type EngineMessage,
  type PermissionDecision,
  type SessionSettings,
} from '../../shared/protocol.js'

export type EngineOptions = {
  /** Desktop session ID for correlating interleaved diagnostic records. */
  diagnosticSessionId?: string
  /** Dossier de l'application : contient `dist/distribution.json`. */
  appRoot: string
  /** Dossier du moteur : contient l'exécutable du produit dans `dist/`. */
  engineRoot: string
  distribution?: Distribution
  backendCommand?: { file: string; args: string[] }
  /** Répertoire de travail de la session. */
  cwd: string
  chat?: boolean
  /** Session à reprendre, si l'on continue une conversation existante. */
  resumeSessionId?: string
  /**
   * Fichier où consigner les deux sens du protocole.
   *
   * Le flux est la seule trace de ce qui se passe entre l'application et le
   * moteur : sans lui, une panne d'échange se manifeste par un comportement
   * absurde du modèle — tentatives de contournement, chemins alternatifs —
   * sans que rien n'indique que c'est le canal qui est en cause.
   */
  logFile?: string
  /** Writer shared by all Engine instances so rotation remains consistent. */
  diagnosticLog?: DiagnosticLog
  /** Réglages initiaux ; modifiables ensuite par `updateSettings`. */
  settings?: SessionSettings
  /**
   * Environnement supplémentaire au lancement, fourni à chaque tour.
   *
   * Asynchrone parce que le fournisseur peut avoir à démarrer quelque chose
   * — le pont Ollama doit écouter avant que le moteur ne l'appelle.
   */
  extraEnv?: (effort?: EffortLevel | null, model?: string | null, signal?: AbortSignal) => Promise<Record<string, string>>
  /** Dépôt du moteur — sessions, réglages, mémoire. Hors de `~/.claude`. */
  configDir: string
  /** Registre MCP sélectionné pour ce tour, avec ses variables protégées. */
  mcpConfig?: (settings: SessionSettings) => Promise<string | null | McpLaunch>
  /** Dossiers de plugins à charger pour la session. */
  pluginDirs?: () => Promise<string[]>
}

/**
 * Bruit de la sortie d'erreur, à ne pas présenter comme une panne.
 *
 * Electron lancé en mode Node écrit des lignes de son rapporteur de plantage
 * et de son moteur graphique, sans qu'il ne se passe rien d'anormal. Les
 * afficher en rouge dans la conversation détourne l'attention de la vraie
 * cause — on lit « ERROR ... crashpad » et on cherche là où il n'y a rien.
 */
const NOISE = [
  /crashpad/i,
  /registration_protocol_win/i,
  /GPU process|gpu_init|dxdiag/i,
  /Failed to send GpuControl/i,
  /DevTools listening/i,
  /ExtensionsGuestView/i,
]

function isNoise(text: string): boolean {
  return NOISE.some(pattern => pattern.test(text))
}

type Turn = {
  result?: boolean
  failed?: boolean
  protocol?: WhiteCodeProtocol
  mcp?: McpSession
  cleanup?: () => void
  delivery?: DesktopFileDelivery
  initialization?: Record<string, any>
  replies: Map<string, { message: EngineMessage; reply: (decision: PermissionDecision) => void }>
  activePermission?: string
  /** Confirmations déjà accordées aux outils d'écriture déclarés par les connecteurs. */
  writeGrants: Set<string>
  controller: AbortController
  child: ChildProcess | null
  cancelled: boolean
  timer?: ReturnType<typeof setTimeout>
  permissions: Set<string>
  permissionMode: SessionSettings['permissionMode']
  modeChanges: Map<string, SessionSettings['permissionMode']>
}

/** Stop waiting even when a preparation service does not support cancellation. */
async function prepare<T>(work: Promise<T> | undefined, signal: AbortSignal): Promise<T | undefined> {
  signal.throwIfAborted()
  let onAbort!: () => void
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try { return await Promise.race([work, aborted]) }
  finally { signal.removeEventListener('abort', onAbort) }
}

/**
 * Une session moteur.
 *
 * Un tour = un cycle complet du canal JSONL. La continuité entre tours passe
 * par `--reopen` et l'identifiant de session sauvegardé par WhiteCode.
 */
export class Engine extends EventEmitter {
  private turn: Turn | null = null
  private get child(): ChildProcess | null { return this.turn?.child ?? null }
  private buffered = ''
  private sessionId: string | null = null
  private readonly options: EngineOptions
  private log: DiagnosticLog | null = null
  private readonly redactor: Redactor
  private stderrBuffer = ''
  private stderrDiscarding = false
  private settings: SessionSettings

  /** Le prochain tour repart sous un nouvel identifiant, passé conservé. */
  private forkNext = false
  private forkSource?: string

  /** Demande que le prochain tour forke la session en cours. */
  forkOnNextTurn(sourceProject?: string): void {
    if (this.sessionId) {
      this.forkNext = true
      this.forkSource = sourceProject
    }
  }

  constructor(options: EngineOptions) {
    super()
    this.options = options
    this.settings = options.settings ?? DEFAULT_SESSION_SETTINGS
    this.sessionId = options.resumeSessionId ?? null
    this.redactor = options.diagnosticLog?.redactor ?? new Redactor()
    this.log = options.diagnosticLog ?? (options.logFile ? new DiagnosticLog(options.logFile, this.redactor) : null)
    this.on('notice', notice => this.record('<<', { type: 'desktop_notice', ...notice }))
  }

  get currentSettings(): SessionSettings {
    return this.settings
  }

  /**
   * Change les réglages de session.
   *
   * Ils prennent effet au prochain lancement, sous forme de drapeaux. Si un
   * tour est en cours, le sous-processus est vivant et accepte les requêtes de
   * contrôle correspondantes : le changement s'applique alors immédiatement,
   * ce qui compte surtout pour le mode de permission — c'est précisément
   * quand le modèle demande quelque chose qu'on veut pouvoir le desserrer.
   */
  updateSettings(next: SessionSettings): void {
    const previous = this.settings
    this.settings = next
    if (!this.child) return

    if (next.permissionMode !== previous.permissionMode) {
      const requestId = `set-mode-${crypto.randomUUID()}`
      this.turn!.modeChanges.set(requestId, next.permissionMode)
      this.write({
        type: 'control_request',
        id: requestId,
        request: 'set_approval_mode',
        params: { mode: approvalMode(next.permissionMode) },
      })
    }
    // Le modèle change au prochain tour, après validation par le fournisseur.
  }

  /**
   * Consigne un message, avec son sens.
   *
   * `>>` sort de l'application vers le moteur, `<<` l'inverse. Les deux sens
   * dans un seul fichier et dans l'ordre : c'est leur entrelacement qui
   * révèle les pannes d'échange — une demande sans réponse, une réponse
   * après fermeture.
   */
  private record(direction: '>>' | '<<', payload: unknown): void {
    this.log?.write(direction, this.options.diagnosticSessionId
      ? { session: this.options.diagnosticSessionId, payload } : payload)
  }

  get currentSessionId(): string | null {
    return this.sessionId
  }

  get isBusy(): boolean {
    return this.turn !== null
  }

  /**
   * Envoie un message utilisateur et lance un tour.
   *
   * `content` accepte une chaîne ou une suite de blocs. La forme composite
   * sert aux pièces jointes : une image voyage en bloc `image` base64, un
   * document en bloc `text` précédé de son nom.
   */
  async send(content: string | unknown[]): Promise<void> {
    if (this.turn) {
      this.emit('notice', {
        tone: 'error',
        text: 'A turn is already running.',
      })
      return
    }
    const turn: Turn = { controller: new AbortController(), child: null, cancelled: false, permissions: new Set(), permissionMode: this.settings.permissionMode, modeChanges: new Map(), replies: new Map(), writeGrants: new Set() }
    this.turn = turn
    try {
      await this.launch(content, turn)
    } catch (error) {
      if (this.turn !== turn) return
      if (!turn.cancelled) this.emit('notice', { tone: 'error', text: this.redactor.text((error as Error).message) })
      this.finish(turn)
    }
  }

  private async launch(content: string | unknown[], turn: Turn): Promise<void> {
    const signal = turn.controller.signal
    const settings = this.settings
    const mcp = await prepare(this.options.mcpConfig?.(settings), signal)
    const mcpConfig = typeof mcp === 'object' && mcp ? mcp.config : mcp
    const mcpEnv = typeof mcp === 'object' && mcp ? mcp.env : {}
    const writeTools = typeof mcp === 'object' && mcp ? mcp.writeTools : undefined
    this.redactor.addSecrets(Object.values(mcpEnv))
    if (typeof mcp === 'object' && mcp) for (const text of mcp.notices) this.emit('notice', { tone: 'info', text })
    const providerEnv = (await prepare(this.options.extraEnv?.(settings.effort, settings.model, signal), signal)) ?? {}
    signal.throwIfAborted()
    this.redactor.addSecrets(Object.entries(providerEnv).filter(([key]) => /TOKEN|API_KEY|CUSTOM_HEADERS/.test(key)).map(([, value]) => value))
    requireInferenceEndpoint(providerEnv.ANTHROPIC_BASE_URL)
    const model = providerEnv.ANTHROPIC_MODEL ?? settings.model
    if (!model) throw new Error('Choisissez un modèle dans les paramètres du fournisseur.')
    const contextWindow = Number(providerEnv.DESKTOP_MODEL_CONTEXT) || 131072
    const id = this.options.distribution ?? distribution(this.options.appRoot)
    await configureBackend(this.options.configDir, model, contextWindow)
    const relay = await inferenceRelay(providerEnv, signal)
    this.redactor.addSecrets([relay.key])
    turn.cleanup = relay.close
    turn.protocol = new WhiteCodeProtocol(contextWindow)
    turn.delivery = new DesktopFileDelivery(name => this.emit('notice', { tone: 'info', text: `Fichier disponible dans les fichiers transmis : ${name}` }))
    turn.mcp = new McpSession((server, name, input) => new Promise(resolve => {
      if (turn.permissionMode === 'dontAsk' || turn.permissionMode === 'plan') { resolve(false); return }
      const grant = JSON.stringify([server, name, input])
      if (turn.writeGrants.delete(grant)) { resolve(true); return }
      const requestId = 'connector-write-' + crypto.randomUUID()
      this.enqueuePermission(turn, requestId, { type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: 'cnx_' + server + '_' + name, tool_use_id: requestId, input, title: 'Confirmer cette écriture du connecteur ?' } }, decision => resolve(decision.behavior === 'allow'))
    }), writeTools, id.product)
    await turn.mcp.open(mcpConfig, { ...process.env, ...providerEnv, ...mcpEnv } as Record<string, string>, signal, text => this.emit('notice', { tone: 'info', text: this.redactor.text(text) }))
    signal.throwIfAborted()
    const plugins = (await prepare(this.options.pluginDirs?.(), signal)) ?? []
    const extensionDirs = await whiteCodeExtensions(plugins, this.options.configDir)
    signal.throwIfAborted()
    turn.permissionMode = this.settings.permissionMode
    const args = backendArguments({ ...settings, tools: settings.tools ? [...whiteCodeTools(settings.tools), ...turn.mcp.toolNames] : null, permissionMode: turn.permissionMode },
      { resume: this.sessionId, fork: this.forkNext, sourceProject: this.forkSource, chat: this.options.chat })
    const instructions = extensionDirs.length ? DESKTOP_DELIVERY_INSTRUCTIONS : ''
    if (instructions) {
      const index = args.indexOf('--add-system-instructions')
      if (index < 0) args.push('--add-system-instructions', instructions)
      else args[index + 1] += '\n\n' + instructions
    }
    for (const directory of extensionDirs) args.push('--extension-dir', directory)
    args.push('--model', model)
    const command = this.options.backendCommand ?? backendCommand(this.options.engineRoot, id)
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !/^(ANTHROPIC_|OPENAI_|CLAUDE_|OFFICE_|AWS_|ELECTRON_RUN_AS_NODE$)|TOKEN|PASSWORD|SECRET|API_KEY/i.test(key)))
    const child = spawn(command.file, [...command.args, ...args], {
      cwd: this.options.cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
      env: { ...environment, ...backendEnvironment(id, this.options.configDir, relay.baseUrl, relay.key),
        ...(providerEnv.OFFICE_NODE ? { OFFICE_NODE: providerEnv.OFFICE_NODE } : {}), ...(providerEnv.OFFICE_RUNTIME ? { OFFICE_RUNTIME: providerEnv.OFFICE_RUNTIME } : {}) },
    })
    this.forkNext = false
    this.forkSource = undefined
    turn.child = child
    this.buffered = ''; this.stderrBuffer = ''; this.stderrDiscarding = false
    child.stdout!.setEncoding('utf8'); child.stderr!.setEncoding('utf8')
    child.stdout!.on('data', chunk => { if (this.turn === turn) this.ingest(chunk, turn) })
    child.stderr!.on('data', chunk => {
      if (this.turn !== turn) return
      if (this.stderrDiscarding) {
        const newline = chunk.indexOf('\n')
        if (newline === -1) return
        chunk = chunk.slice(newline + 1); this.stderrDiscarding = false
      }
      this.stderrBuffer += chunk; this.flushStderr()
    })
    child.on('close', code => { if (this.turn !== turn) return; if (code !== 0) turn.result = false; this.flushStderr(true); this.finish(turn) })
    child.on('error', error => { if (this.turn !== turn) return; this.emit('notice', { tone: 'error', text: this.redactor.text(error.message) }); this.finish(turn) })
    child.stdin!.on('error', error => { if (this.turn !== turn || turn.cancelled) return; this.emit('notice', { tone: 'error', text: this.redactor.text(error.message) }); this.stop() })
    this.write({ type: 'control_init', protocolVersion: '1.0', decisionAuthority: true,
      demands: ['approval_request', 'confirm_escalation', 'request_user_choice', 'notify', 'deliver_file', ...(turn.mcp.servers.length ? ['sdk_mcp_request'] : [])],
      responseTimeoutMs: 600000, ...(turn.mcp.servers.length ? { sdkServers: turn.mcp.servers } : {}) })
    this.write({ type: 'control_request', id: 'desktop-state', request: 'get_state', params: {} })
    this.write({ type: 'control_request', id: 'desktop-commands', request: 'list_commands', params: {} })
    this.write({ type: 'user', content: whiteCodeContent(content) })
  }

  private enqueuePermission(turn: Turn, id: string, message: EngineMessage, reply: (decision: PermissionDecision) => void): void {
    if (this.turn !== turn || turn.cancelled) { reply({ behavior: 'deny', message: 'Tour interrompu.' }); return }
    turn.replies.set(id, { message, reply })
    this.presentPermission(turn)
  }

  private presentPermission(turn: Turn): void {
    if (this.turn !== turn || turn.cancelled || turn.activePermission) return
    const next = turn.replies.entries().next().value
    if (!next) return
    turn.activePermission = next[0]
    this.emit('message', next[1].message)
  }

  /** Répond à une demande de permission en attente. */
  respondToPermission(requestId: string, decision: PermissionDecision): void {
    const turn = this.turn
    if (!turn || turn.cancelled || turn.activePermission !== requestId) return
    const pending = turn.replies.get(requestId)
    if (!pending) return
    turn.replies.delete(requestId); turn.activePermission = undefined
    pending.reply(decision)
    queueMicrotask(() => this.presentPermission(turn))
  }

  /** Interrompt le tour en cours. */
  interrupt(): void {
    const turn = this.turn
    if (!turn || turn.cancelled) return
    turn.cancelled = true
    turn.permissions.clear()
    turn.controller.abort()
    if (!turn.child) { this.finish(turn); return }
    this.emit('notice', { tone: 'info', text: 'Arrêt demandé…' })
    this.write({
      type: 'control_request',
      id: `interrupt-${Date.now()}`,
      request: 'cancel_turn', params: {},
    })
    // Allow the CLI to abort HTTP/tools and save the partial transcript first.
    turn.timer = setTimeout(() => {
      if (this.turn !== turn) return
      this.record('>>', { type: 'interrupt_timeout', timeout_ms: 2000 })
      this.terminate(turn)
    }, 2000)
  }

  /** Abandonne la session courante ; le prochain envoi en ouvrira une neuve. */
  reset(): void {
    this.stop()
    this.sessionId = null
  }

  /**
   * Rattache les prochains tours à une session existante.
   *
   * Le contexte n'est pas rechargé ici : c'est `--reopen` qui s'en charge, du
   * côté du moteur, au prochain envoi. L'application n'a qu'à retenir
   * l'identifiant.
   */
  adoptSession(sessionId: string): void {
    this.stop()
    this.sessionId = sessionId
  }

  /** Termine le sous-processus s'il tourne encore. */
  stop(): void {
    const turn = this.turn
    if (!turn) return
    turn.cancelled = true
    turn.controller.abort()
    this.terminate(turn)
    this.finish(turn)
  }

  private terminate(turn: Turn): void {
    const child = turn.child
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) {
      this.finish(turn)
      return
    }
    const fallback = (error?: Error | null) => { if (error) child.kill('SIGKILL') }
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, fallback)
    } else {
      // The CLI already uses this dependency to terminate tools and descendants.
      treeKill(child.pid, 'SIGKILL', fallback)
    }
  }

  private finish(turn: Turn): void {
    if (this.turn !== turn) return
    clearTimeout(turn.timer)
    this.turn = null
    turn.controller.abort()
    turn.cleanup?.(); void turn.mcp?.close()
    turn.delivery?.close()
    for (const pending of turn.replies.values()) pending.reply({ behavior: 'deny', message: 'Tour terminé.' })
    turn.replies.clear()
    this.record('<<', { type: 'turn_end', cancelled: turn.cancelled })
    if (turn.cancelled) this.emit('notice', { tone: 'info', text: 'Tour interrompu.' })
    this.emit('turn-end', { cancelled: turn.cancelled, failed: turn.result !== true })
  }

  private flushStderr(final = false): void {
    const lines = this.stderrBuffer.split('\n')
    this.stderrBuffer = final ? '' : lines.pop() ?? ''
    for (const line of lines) {
      const text = this.redactor.text(line.trim())
      if (text && !isNoise(text)) {
        this.log?.write('stderr', { session: this.options.diagnosticSessionId, error: text })
        if (/^(Options levant une protection actives : --allow-unrestricted-mode\.|Extension de développement active :|avertissement : capacités du modèle .* lues dans models\.extraCatalog)/.test(text)) continue
        this.emit('notice', { tone: /^(avertissement|Options levant|Consolidation de la mémoire :|Tâches de fond arrêtées à la fin de la session :)/i.test(text) ? 'info' : 'error', text })
      }
    }
    if (this.stderrBuffer.length > 65536) {
      this.stderrBuffer = ''
      this.stderrDiscarding = true
      this.log?.write('stderr', { session: this.options.diagnosticSessionId, truncated: true, reason: 'stderr line exceeds 64 KiB' })
    }
  }

  private write(message: unknown): void {
    const stdin = this.child?.stdin
    this.record('>>', message)
    if (!stdin || stdin.destroyed || stdin.writableEnded) {
      // Cas exact du bug de la phase 2 : une réponse de permission écrite
      // après fermeture disparaissait sans bruit, et le moteur restait à
      // attendre. Mieux vaut le dire tout de suite.
      this.record('>>', { error: 'stdin fermé, message perdu' })
      this.emit('notice', {
        tone: 'error',
        text: 'Le canal vers le moteur est fermé : message non transmis.',
      })
      return
    }
    stdin.write(`${JSON.stringify(message)}\n`)
  }

  /**
   * Découpe le flux en lignes.
   *
   * Le découpage se fait sur les sauts de ligne et non par bloc reçu : un
   * message peut arriver en plusieurs morceaux, et plusieurs messages peuvent
   * arriver ensemble.
   */
  private ingest(chunk: string, turn: Turn): void {
    this.buffered += chunk
    const lines = this.buffered.split('\n')
    this.buffered = lines.pop() ?? ''

    for (const line of lines) {
      if (this.turn !== turn) return
      const trimmed = line.trim()
      if (!trimmed) continue
      let message: EngineMessage
      try {
        message = JSON.parse(trimmed) as EngineMessage
      } catch {
        this.record('<<', { unparsed: this.redactor.text(trimmed).slice(0, 2000) })
        this.emit('notice', { tone: 'error', text: this.redactor.text(trimmed).slice(0, 400) })
        continue
      }

      this.handleWhiteCode(message as Record<string, any>, turn)
    }
  }

  private handleWhiteCode(event: Record<string, any>, turn: Turn): void {
    this.record('<<', event.type === 'assistant' && event.partial ? { type: 'assistant', partial: true } : event)
    if (event.type === 'error' && /Message de contrôle invalide/.test(String(event.message))) {
      this.emit('notice', { tone: 'error', text: 'Le backend refuse une déclaration du canal de contrôle : ' + this.redactor.text(String(event.message)) })
      turn.failed = true; this.terminate(turn); this.finish(turn); return
    }
    if (event.type === 'control_init' && !/^1\./.test(String(event.protocolVersion))) { this.emit('notice', { tone: 'error', text: 'Version du protocole WhiteCode incompatible.' }); this.stop(); return }
    if (event.type === 'session') { this.sessionId = event.sessionId; turn.initialization = event }
    if (event.type === 'turn_completed' || event.type === 'command_output') {
      if (event.type === 'command_output') this.emit('notice', { tone: 'info', text: event.output ?? '' })
      this.write({ type: 'control_request', id: 'shutdown-' + crypto.randomUUID(), request: 'shutdown', params: {} })
    }
    if (event.type === 'run_completed') turn.result = !turn.failed && event.exitCode === 0 && event.haltReason === 'completed'
    if (event.type === 'error' && ['invalid_command', 'invalid_input_line'].includes(event.code)) {
      turn.failed = true
      this.write({ type: 'control_request', id: 'shutdown-' + crypto.randomUUID(), request: 'shutdown', params: {} })
    }
    if (event.type === 'error') this.emit('notice', { tone: event.code === 'warning' ? 'info' : 'error', text: this.redactor.text(String(event.message ?? event.code)) })
    if (event.type === 'control_response') {
      if (event.ok && turn.initialization && ['desktop-state', 'desktop-commands'].includes(event.id)) {
        if (event.id === 'desktop-state') turn.initialization = { ...turn.initialization, ...event.result }
        else turn.initialization = { ...turn.initialization, commands: event.result?.commands?.map((entry: any) => entry.name) }
        for (const message of turn.protocol!.messages(turn.initialization!)) this.emit('message', message)
      }
      const change = turn.modeChanges.get(event.id)
      if (change) {
        turn.modeChanges.delete(event.id)
        if (event.ok) turn.permissionMode = change
        else this.emit('notice', { tone: 'error', text: 'Changement de mode refusé : ' + this.redactor.text(String(event.error?.message ?? 'refus du moteur')) })
        if (!turn.modeChanges.size && this.settings.permissionMode !== turn.permissionMode) { this.settings = { ...this.settings, permissionMode: turn.permissionMode }; this.emit('settings', this.settings) }
      }
    }
    if (event.type === 'control_request') {
      const respond = (result: unknown) => { if (this.turn === turn && !turn.cancelled) this.write({ type: 'control_response', id: event.id, ok: true, result }) }
      if (event.request === 'deliver_file') { respond(turn.delivery!.receive(event.params ?? {})); return }
      if (event.request === 'sdk_mcp_request') {
        // Known credentials remain masked; Git object IDs are evidence for the model.
        void turn.mcp!.call(event.params, turn.controller.signal).then(result => respond(this.redactor.value(result, false)), error => { if (this.turn === turn && !turn.cancelled) this.write({ type: 'control_response', id: event.id, ok: false, error: { code: 'mcp_error', message: this.redactor.text(String(error)) } }) })
        return
      }
      if (event.request === 'notify') { if (event.params?.kind === 'warning') this.emit('notice', { tone: 'info', text: event.params.message }); respond({}); return }
      if (event.request === 'confirm_escalation' || event.request === 'request_user_choice') {
        const choice = event.request === 'request_user_choice'
        this.enqueuePermission(turn, event.id, { type: 'control_request', request_id: event.id, request: { subtype: 'can_use_tool', tool_name: choice ? 'request_user_choice' : 'permission_escalation', tool_use_id: event.id, input: event.params, title: choice ? event.params.question ?? 'Votre choix est nécessaire' : event.params.question ?? 'Confirmer le changement de permissions ?' } }, decision => {
          respond(choice ? decision.behavior === 'allow' ? decision.updatedInput : { cancelled: true } : { decision: decision.behavior === 'allow' ? 'confirm' : 'deny', escalationId: event.params.escalationId })
        })
        return
      }
      if (event.request !== 'approval_request') { this.write({ type: 'control_response', id: event.id, ok: false, error: { code: 'unsupported', message: 'Demande non prise en charge par l’application.' } }); return }
      if (turn.permissionMode === 'dontAsk') { respond({ decision: 'deny', reason: 'Action refusée en mode sans demande.' }); return }
      const message = turn.protocol!.messages(event)[0]!
      this.enqueuePermission(turn, event.id, message, decision => {
        if (decision.behavior === 'allow') {
          const name = String(event.params.toolName)
          const tool = turn.mcp!.toolForName(name)
          if (tool) turn.writeGrants.add(JSON.stringify([tool.server, tool.name, decision.updatedInput]))
        }
        respond(decision.behavior === 'allow' ? { decision: 'allow_modified', input: decision.updatedInput } : { decision: 'deny', reason: decision.message })
      })
      return
    }
    for (const message of turn.protocol!.messages(event)) this.emit('message', message)
  }
}
