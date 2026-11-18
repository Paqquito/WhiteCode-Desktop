import { OpenAIBridge, openAIEndpoint, boundedJSON } from './openaiBridge.js'
/**
 * Fournisseurs de modèles.
 *
 * Le moteur choisit son fournisseur par variables d'environnement, lues au
 * lancement. Comme il repart en sous-processus à chaque tour, il suffit de
 * composer le bon environnement au moment du `spawn` : aucun redémarrage
 * d'application n'est nécessaire pour changer de fournisseur.
 *
 * ## Deux familles, deux mécanismes
 *
 *  - **Serveur compatible** : le moteur parle son protocole natif (Messages),
 *    on ne fait que déplacer l'adresse et le jeton.
 *  - **Ollama** : le protocole diffère, un pont local traduit. Voir
 *    `ollamaBridge.ts` — l'application s'interpose dans les échanges.
 *  - **Compatible OpenAI** : `openaiBridge.ts` traduit Chat Completions.
 *  - **llama.cpp** : `llama-server` local, mis en service par l'application.
 *
 * Le protocole des Messages reste celui que parle le moteur en interne.
 */

import { join } from 'node:path'
import type { LocalModels, ModelProgress } from '../models/index.js'
import type { EffortLevel } from '../../shared/protocol.js'
import { OllamaBridge } from './ollamaBridge.js'
import { ProviderStorage, type SecretVault } from './storage.js'
import { catalogModels, selectedGatewayModel, LEGACY_MODEL } from '../../shared/modelSelection.js'

import { requireInferenceEndpoint } from '../../shared/inferenceEndpoint.js'
export type ProviderKind = 'compatible' | 'ollama' | 'llamacpp' | 'openai'

export type ProviderConfig = {
  kind: ProviderKind
  /** Compatible OpenAI : réglages propres à ce fournisseur. */
  openaiBaseUrl?: string
  openaiApiKey?: string
  openaiModel?: string
  openaiContext?: number
  /** Serveur compatible : adresse de base. */
  baseUrl?: string
  /** Serveur compatible : jeton d'authentification. */
  token?: string
  /** Ollama : adresse du serveur. */
  ollamaHost?: string
  /** Ollama : modèle employé. */
  ollamaModel?: string
  /** Ollama : fenêtre de contexte déclarée au modèle. */
  ollamaContext?: number
  /** llama.cpp : identifiant du modèle local mis en service. */
  llamacppModel?: string
}

/**
 * Aucun serveur par défaut : l'utilisateur déclare le sien dans les
 * paramètres avant le premier message.
 */
export const DEFAULT_PROVIDER: ProviderConfig = { kind: 'compatible' }

/** Racine d'un serveur compatible, sans `/v1` final. */
export function serverEndpoint(baseUrl: string | undefined): string {
  return requireInferenceEndpoint(baseUrl).replace(/\/v1$/, '')
}

/**
 * Variables communes à tous les fournisseurs.
 *
 * ## Séparation d'avec le compte Anthropic
 *
 * Le CONFIG_HOME propre à WhiteCode déplace ce que le moteur conserve — sessions,
 * réglages, jetons, mémoire — dans les données de cette application. Sans
 * cela, l'application écrirait et lirait dans `~/.claude`, c'est-à-dire dans l'espace du
 * client en ligne de commande : les conversations du compte Anthropic de
 * l'utilisateur apparaissaient dans la liste des discussions, et le jeton de
 * ce compte servait à s'authentifier. Les deux mondes sont désormais
 * disjoints.
 *
 * ## Trafic
 *
 * Le reste coupe ce que le moteur émet de lui-même : télémétrie, mise à jour
 * automatique, notes de version, registre de serveurs, rapports d'erreur. Le
 * moteur ne parle qu'au serveur d'inférence choisi.
 */
export function engineConfigDir(userData: string): string {
  return join(userData, 'engine')
}

export const ISOLATION_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_AUTH_TOKEN: '',
  ANTHROPIC_CUSTOM_HEADERS: '',
  CLAUDE_CODE_OAUTH_TOKEN: '',
  CLAUDE_CODE_USE_BEDROCK: '0',
  CLAUDE_CODE_USE_VERTEX: '0',
  CLAUDE_CODE_USE_FOUNDRY: '0',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_ERROR_REPORTING: '1',
  DISABLE_BUG_COMMAND: '1',
}

/** Un modèle tel qu'Ollama le décrit. */
export type OllamaModel = {
  name: string
  /** Vrai si le modèle sait appeler des outils — condition d'emploi ici. */
  tools: boolean
  vision: boolean
  contextLength: number
  bytes: number
}

/**
 * Interroge le serveur Ollama.
 *
 * Rend une liste vide plutôt que de lever : Ollama arrêté est un cas normal,
 * que l'interface doit pouvoir présenter comme tel.
 */
export async function listOllamaModels(
  host: string,
): Promise<{ ok: true; models: OllamaModel[] } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) {
      return { ok: false, reason: `Ollama a répondu ${response.status}.` }
    }
    const body = (await response.json()) as {
      models?: Array<{
        name: string
        size?: number
        capabilities?: string[]
        details?: { context_length?: number }
      }>
    }
    const models = await Promise.all(
      (body.models ?? []).map(async model => {
        // Les Ollama antérieurs à 0.20 ne publient pas les capacités dans
        // `/api/tags` ; les taire reviendrait à écarter tous leurs modèles
        // comme « sans outils ». `/api/show` les a toujours données.
        const capabilities =
          model.capabilities ?? (await showCapabilities(host, model.name))
        return {
          name: model.name,
          tools: capabilities.includes('tools'),
          vision: capabilities.includes('vision'),
          contextLength: model.details?.context_length ?? 8192,
          bytes: model.size ?? 0,
        }
      }),
    )
    return { ok: true, models }
  } catch (error) {
    const message = String((error as Error)?.message ?? error)
    return {
      ok: false,
      reason: /timeout|abort/i.test(message)
        ? "Ollama ne répond pas. Le serveur est-il démarré ('ollama serve') ?"
        : message,
    }
  }
}

/** Un modèle tel que la passerelle le publie, avec de quoi le nommer. */
export type GatewayModel = {
  /** Nom de route, celui que le moteur demande. */
  id: string
  /** Nom lisible — `display_name` de la passerelle, sinon la route. */
  label: string
  hint?: string
  /** Vrai pour la route que servent les noms Anthropic quand rien n'est choisi. */
  isDefault: boolean
  /**
   * Fenêtre de contexte réelle, telle que la passerelle la déclare.
   *
   * Sans elle l'application afficherait celle d'Anthropic — deux cent mille
   * jetons — alors que le serveur en sert trente-deux mille : la jauge
   * resterait au vert jusqu'à la rupture de la conversation.
   */
  contextLength?: number
  /**
   * Vrai si le modèle sait moduler son effort de réflexion.
   *
   * Un modèle Instruct n'en a pas : lui proposer le réglage afficherait un
   * bouton sans effet, la passerelle écartant le paramètre avant l'appel.
   */
  supportsEffort: boolean
}

/**
 * Modèles exposés par une passerelle compatible.
 *
 * Lus sur `/model/info` (LiteLLM), qui porte pour chaque route le modèle
 * réellement visé et les `model_info` libres de la configuration — c'est là
 * que vivent `display_name` et `description`. La même liste contient les
 * alias Anthropic avec leur cible, ce qui permet de dire à l'utilisateur ce
 * que « Défaut » lui donne vraiment. Repli sur `/v1/models` pour une
 * passerelle qui ne serait pas LiteLLM : des noms de routes, sans plus.
 */
export async function listGatewayModels(
  baseUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ ok: true; models: GatewayModel[] } | { ok: false; reason: string }> {
  const headers: Record<string, string> = token
    ? { authorization: `Bearer ${token}` }
    : {}
  try {
    const root = serverEndpoint(baseUrl)
    const info = await fetch(`${root}/model/info`, {
      headers,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    })
    if (info.ok) {
      const body = (await info.json()) as {
        data?: Array<{
          model_name?: string
          litellm_params?: { model?: string }
          model_info?: {
            display_name?: string
            description?: string
            max_input_tokens?: number
            supports_reasoning?: boolean
          }
        }>
      }
      const entries = (body.data ?? []).filter(e => e.model_name)
      const defaultTarget = entries.find(e => e.model_name === 'claude-sonnet-4-6')
        ?.litellm_params?.model
      return {
        ok: true,
        models: entries
          .filter(e => !LEGACY_MODEL.test(e.model_name!))
          .map(e => ({
            id: e.model_name!,
            label: e.model_info?.display_name ?? e.model_name!,
            hint: e.model_info?.description,
            contextLength: e.model_info?.max_input_tokens,
            // Absent, on suppose que oui : une passerelle qui ne dit rien
            // dessert peut-être un modèle qui en est capable, et masquer le
            // réglage à tort est plus gênant que l'inverse.
            supportsEffort: e.model_info?.supports_reasoning !== false,
            isDefault:
              Boolean(defaultTarget) && e.litellm_params?.model === defaultTarget,
          })),
      }
    }

    // `/model/info` a échoué : soit la clé est refusée, soit ce n'est pas une
    // passerelle. Distinguer les deux évite de renvoyer l'utilisateur vers son
    // jeton alors qu'il s'est trompé de port.
    if (info.status === 400 || info.status === 401) {
      return { ok: false, reason: describeFailure(info.status) }
    }

    const response = await fetch(`${root}/v1/models`, {
      headers,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      return { ok: false, reason: describeFailure(response.status) }
    }
    const body = (await response.json()) as { data?: Array<{ id?: string }> }
    return {
      ok: true,
      models: (body.data ?? [])
        .map(entry => entry.id)
        .filter((id): id is string => Boolean(id) && !LEGACY_MODEL.test(id!))
        // The authenticated gateway deliberately hides the admin model-info route.
        .map(id => ({
          id,
          label: id,
          hint: 'Modèle disponible pour votre compte.',
          isDefault: false,
          supportsEffort: true,
        })),
    }
  } catch (error) {
    const message = String((error as Error)?.message ?? error)
    return {
      ok: false,
      reason: /timeout|abort|fetch failed|ECONNREFUSED/i.test(message)
        ? 'Le serveur ne répond pas. Vérifiez son adresse et qu’il est démarré.'
        : message,
    }
  }
}

/**
 * Traduit un échec HTTP en cause.
 *
 * LiteLLM répond **400** à une clé fausse, pas 401 : afficher le code nu
 * envoyait chercher du côté de la requête alors que seul le jeton est en
 * cause. 401 couvre le jeton absent.
 */
function describeFailure(status: number): string {
  if (status === 400 || status === 401) {
    return 'Jeton refusé par le serveur. Vérifiez-le dans Paramètres → Fournisseur.'
  }
  if (status === 404) {
    return 'Catalogue de modèles introuvable à cette adresse.'
  }
  return `Le serveur a répondu ${status}.`
}

async function showCapabilities(host: string, name: string): Promise<string[]> {
  try {
    const response = await fetch(`${host}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return []
    const body = (await response.json()) as { capabilities?: string[] }
    return body.capabilities ?? []
  } catch {
    return []
  }
}

/** Progression d'un téléchargement de modèle. */
export type PullProgress = {
  name: string
  status: string
  /** Fraction téléchargée, ou `null` quand l'étape n'est pas mesurable. */
  ratio: number | null
  done: boolean
  failed: boolean
}

/**
 * Télécharge un modèle dans Ollama.
 *
 * Le flux de `/api/pull` est du JSON par ligne, une ligne par changement
 * d'état. Un modèle pèse plusieurs gigaoctets : sans ce retour, l'interface
 * resterait figée de longues minutes et l'utilisateur conclurait à une panne.
 */
export async function pullOllamaModel(
  host: string,
  name: string,
  onProgress: (progress: PullProgress) => void,
): Promise<boolean> {
  try {
    const response = await fetch(`${host}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, stream: true }),
    })
    if (!response.ok || !response.body) {
      onProgress({
        name,
        status: `Ollama a répondu ${response.status}.`,
        ratio: null,
        done: true,
        failed: true,
      })
      return false
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        let event: {
          status?: string
          completed?: number
          total?: number
          error?: string
        }
        try {
          event = JSON.parse(line)
        } catch {
          continue
        }
        if (event.error) {
          onProgress({ name, status: event.error, ratio: null, done: true, failed: true })
          return false
        }
        onProgress({
          name,
          status: event.status ?? '',
          ratio:
            event.total && event.completed ? event.completed / event.total : null,
          done: event.status === 'success',
          failed: false,
        })
      }
    }

    onProgress({ name, status: 'Installé.', ratio: 1, done: true, failed: false })
    return true
  } catch (error) {
    onProgress({
      name,
      status: String((error as Error)?.message ?? error),
      ratio: null,
      done: true,
      failed: true,
    })
    return false
  }
}

/**
 * Tient le pont Ollama pour la durée de vie de l'application.
 *
 * Chaque tour Ollama possède son pont : une nouvelle configuration ne peut
 * ni détourner ni interrompre les requêtes d'une autre session.
 */
export class Providers {
  private bridges = new Set<OllamaBridge | OpenAIBridge>()
  private localTurns = new Map<AbortSignal, string>()
  private localStart: { key: string; promise: Promise<unknown> } | null = null
  private config: ProviderConfig = DEFAULT_PROVIDER
  private readonly storage: ProviderStorage

  /**
   * Le choix est conservé sur disque.
   *
   * Il vit ici et non dans le rendu parce que le processus principal en a
   * besoin pour composer l'environnement du moteur, y compris au tout premier
   * tour — avant que l'interface n'ait eu le temps de le lui transmettre. Sans
   * cette persistance, le premier tour pourrait utiliser un autre fournisseur
   * que celui affiché dans les paramètres.
   */
  /**
   * `models` sert au seul fournisseur `llamacpp`, qui doit avoir mis le
   * serveur en service avant que le moteur ne compose sa première requête.
   * Injecté plutôt qu'importé en dur : c'est la même instance que celle des
   * réglages, sinon deux `llama-server` se disputeraient le port.
   */
  constructor(
    root: string,
    private readonly models: LocalModels,
    /** Progression de la mise en service, relayée à l'interface. */
    private readonly onModelProgress: (progress: ModelProgress) => void,
    vault?: SecretVault,
  ) {
    this.storage = new ProviderStorage(root, vault)
  }

  async load(): Promise<ProviderConfig> {
    const parsed = await this.storage.read()
    if (parsed && KINDS.includes(parsed.kind)) this.config = parsed
    else {
      const fallback = { ...DEFAULT_PROVIDER }
      if (parsed) await this.storage.write(fallback)
      this.config = fallback
    }
    return this.config
  }

  get current(): ProviderConfig {
    return this.config
  }

  async set(config: ProviderConfig): Promise<void> {
    validateProvider(config)
    const snapshot = { ...config }
    await this.storage.write(snapshot)
    this.config = snapshot
  }

  /**
   * Variables d'environnement à ajouter au lancement du moteur.
   *
   * Asynchrone parce que le pont Ollama doit écouter avant que le moteur ne
   * démarre : lui donner une adresse qui n'accepte pas encore de connexion
   * produirait un échec au premier appel, difficile à rattacher à sa cause.
   */
  async environment(
    effort?: EffortLevel | null,
    requestedModel: string | null = null,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    signal?.throwIfAborted()
    const config = this.config
    validateProvider(config)
    let gatewayEnv: Record<string, string> = {}
    if (config.kind === 'compatible') {
      const result = await listGatewayModels(config.baseUrl ?? '', config.token ?? '', signal)
      signal?.throwIfAborted()
      if (!result.ok) throw new Error(result.reason)
      const model = selectedGatewayModel(catalogModels(result.models), requestedModel)
      if (!model) throw new Error('Aucun modèle disponible sur ce serveur.')
      gatewayEnv = { ...modelEnvironment(model.id), DESKTOP_MODEL_CONTEXT: String(model.contextLength ?? 131072) }
    }

    switch (config.kind) {
      case 'compatible': {
        const env: Record<string, string> = { ...ISOLATION_ENV, ...gatewayEnv }
        env.ANTHROPIC_BASE_URL = serverEndpoint(config.baseUrl)
        if (config.token) env.ANTHROPIC_AUTH_TOKEN = config.token
        return env
      }

      case 'openai': {
        const model = requestedModel ?? config.openaiModel
        if (!model) throw new Error('Choisissez un modèle compatible OpenAI.')
        const bridge = new OpenAIBridge({ baseUrl: config.openaiBaseUrl ?? '', apiKey: config.openaiApiKey, model })
        this.bridges.add(bridge)
        const release = () => { bridge.stop(); this.bridges.delete(bridge) }
        signal?.addEventListener('abort', release, { once: true })
        try {
          const baseUrl = await bridge.start()
          signal?.throwIfAborted()
          return { ...ISOLATION_ENV, ...modelEnvironment(model), ANTHROPIC_BASE_URL: baseUrl,
            ANTHROPIC_AUTH_TOKEN: bridge.token, ANTHROPIC_API_KEY: '', DISABLE_PROMPT_CACHING: '1' }
        } catch (error) { release(); throw error }
      }
      case 'ollama': {
        const model = requestedModel ?? config.ollamaModel
        if (!model) throw new Error('Choisissez un modèle Ollama.')
        const options = {
          host: config.ollamaHost ?? 'http://127.0.0.1:11434',
          model,
          contextLength: config.ollamaContext ?? 32768,
        }
        const bridge = new OllamaBridge(options)
        this.bridges.add(bridge)
        const release = () => { bridge.stop(); this.bridges.delete(bridge) }
        signal?.addEventListener('abort', release, { once: true })
        let baseUrl: string
        try {
          baseUrl = await bridge.start()
          signal?.throwIfAborted()
        } catch (error) { release(); throw error }

        return {
          ...ISOLATION_ENV,
          ...modelEnvironment(model),
          ANTHROPIC_BASE_URL: baseUrl,
          // Le moteur refuse de démarrer sans identifiant, même quand la cible
          // n'en vérifie aucun. Une valeur fictive suffit et ne quitte jamais
          // la machine — le pont ne la transmet pas à Ollama.
          ANTHROPIC_AUTH_TOKEN: 'ollama-local',
          ANTHROPIC_API_KEY: 'ollama-local',
          // Le pont n'implémente pas la mise en cache de contexte ; l'annoncer
          // évite que le moteur compte sur des économies inexistantes.
          DISABLE_PROMPT_CACHING: '1',
        }
      }

      /**
       * `llama-server` sert `/v1/messages` nativement : aucun pont.
       *
       * C'est toute la différence avec Ollama — le protocole du moteur est
       * déjà celui du serveur, on ne fait que déplacer l'adresse. Reste à
       * s'assurer qu'il écoute : le moteur part en sous-processus dès le
       * retour d'ici, et une adresse qui refuse la connexion produit un échec
       * qu'on ne rattache pas au modèle.
       */
      case 'llamacpp': {
        const id = requestedModel ?? config.llamacppModel ?? this.models.current.serving
        if (!id) throw new Error('Choisissez un modèle llama.cpp.')
        // Le moteur envoie l'effort dans `output_config.effort`, que
        // `llama-server` ignore (vérifié le 5 sept.). Le seul levier qui agit
        // est `--reasoning`, posé au lancement. On traduit donc l'effort de
        // session : « low » coupe la réflexion (réponse directe, plus rapide),
        // tout le reste la laisse au gabarit. Un changement relance le serveur.
        const reasoning = effort === 'low' ? 'off' : 'auto'
        const key = JSON.stringify([id, reasoning])
        if ([...this.localTurns.values()].some(value => value !== key) ||
            (this.localStart && this.localStart.key !== key)) {
          throw new Error('Une autre session utilise llama.cpp avec un modèle ou un effort différent. Attendez sa fin avant de modifier le serveur local.')
        }
        if (signal) {
          this.localTurns.set(signal, key)
          signal.addEventListener('abort', () => this.localTurns.delete(signal), { once: true })
        }
        const status = this.models.status()
        if (
          id &&
          !(
            status.running &&
            status.model === id &&
            status.reasoning === reasoning
          )
        ) {
          this.localStart ??= { key, promise: this.models.start(id, this.onModelProgress, reasoning) }
          const pending = this.localStart
          try { await pending.promise }
          finally { if (this.localStart === pending) this.localStart = null }
        }
        signal?.throwIfAborted()
        return {
          ...ISOLATION_ENV,
          ...modelEnvironment(id),
          ANTHROPIC_BASE_URL: this.models.serverUrl,
          // Le moteur refuse de démarrer sans identifiant, même quand la cible
          // n'en vérifie aucun. Fictif, et il ne quitte pas la machine.
          ANTHROPIC_AUTH_TOKEN: 'llamacpp-local',
          ANTHROPIC_API_KEY: 'llamacpp-local',
          // `llama-server` tient son propre cache de préfixe, automatique et
          // sans rapport avec les marqueurs `cache_control` du moteur. Les
          // laisser envoyer ferait compter des « jetons mis en cache » qui ne
          // correspondent à rien de facturé ni de mesuré ici ; le gain, lui,
          // reste acquis — il ne dépend pas de ce réglage.
          DISABLE_PROMPT_CACHING: '1',
        }
      }
    }
  }

  stop(): void {
    for (const bridge of this.bridges) bridge.stop()
    this.bridges.clear()
  }
}

const KINDS: ProviderKind[] = ['compatible', 'ollama', 'llamacpp', 'openai']

function validateProvider(config: ProviderConfig): void {
  if (!config || !KINDS.includes(config.kind)) throw new Error('Fournisseur inconnu ou supprimé.')
  if (config.openaiBaseUrl) openAIEndpoint(config.openaiBaseUrl)
  if (config.openaiApiKey !== undefined && (typeof config.openaiApiKey !== 'string' || config.openaiApiKey.length > 16384 || /[\r\n]/.test(config.openaiApiKey))) throw new Error('Clé OpenAI invalide.')
  if (config.openaiContext !== undefined && (!Number.isSafeInteger(config.openaiContext) || config.openaiContext < 1024 || config.openaiContext > 10000000)) throw new Error('Contexte OpenAI invalide.')
  if (config.token !== undefined && (typeof config.token !== 'string' || config.token.length > 16384 || /[\r\n]/.test(config.token))) throw new Error('Jeton du serveur invalide.')
}

function modelEnvironment(model: string): Record<string, string> {
  return {
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    ANTHROPIC_SMALL_FAST_MODEL: model,
    CLAUDE_CODE_SUBAGENT_MODEL: model,
  }
}

/** Chat Completions catalog; no capability guesses or filtering of provider model names. */
export async function listOpenAIModels(baseUrl: string, apiKey: string): Promise<{ ok: true; models: GatewayModel[] } | { ok: false; reason: string }> {
  try {
    const response = await fetch(openAIEndpoint(baseUrl) + '/models', { redirect: 'error', signal: AbortSignal.timeout(10000), headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} })
    if (!response.ok) { await response.body?.cancel(); return { ok: false, reason: `Catalogue OpenAI indisponible (HTTP ${response.status}). Vérifiez l’adresse et la clé.` } }
    const body = await boundedJSON(response) as { data?: { id?: unknown }[] }
    if (!Array.isArray(body.data)) throw new Error('Invalid catalog')
    return { ok: true, models: body.data.filter((m): m is { id: string } => typeof m?.id === 'string' && m.id.length > 0 && m.id.length <= 500).slice(0, 1000).map(m => ({ id: m.id, label: m.id, isDefault: false, supportsEffort: false })) }
  } catch { return { ok: false, reason: 'Le catalogue OpenAI ne répond pas ou son format est invalide. Vous pouvez saisir un identifiant de modèle.' } }
}
