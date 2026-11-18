/**
 * Agrégation du flux du moteur en fil de conversation affichable.
 *
 * Réducteur pur : il ne touche ni au DOM ni à Electron, ce qui le rend
 * vérifiable seul — c'est la partie où se logent les erreurs subtiles
 * d'affichage.
 *
 * ## Pourquoi une agrégation est nécessaire
 *
 * Le moteur émet, pour un seul paragraphe de réponse, une dizaine de messages :
 * un `content_block_start`, N `content_block_delta`, un `content_block_stop`,
 * puis le message `assistant` complet. Les rendre tels quels donnerait un
 * affichage haché et du texte en double.
 *
 * ## La règle qui évite le doublon
 *
 * Avec `--include-partial-messages`, le texte arrive **deux fois** : en
 * fragments puis dans le message final. On construit donc le texte à partir
 * des fragments, et le message final ne sert qu'à deux choses : récupérer les
 * appels d'outils (dont l'entrée arrive en JSON fragmenté, pénible à
 * recomposer), et rattraper les blocs de texte qu'aucun fragment n'a couverts.
 */

import type {
  ContentBlock,
  EngineMessage,
  PendingPermission,
  PermissionMode,
  SessionStatus,
  ThreadEntry,
} from '#desktop/session-protocol'

/**
 * Fenêtre de contexte du modèle, à défaut de mieux.
 *
 * Reproduit la règle du moteur (`utils/context.ts`) : le suffixe `[1m]` vaut
 * un million de jetons, tout le reste deux cent mille. N'est utilisée que tant
 * que le moteur n'a pas parlé — dès le premier `result`, il annonce la vraie
 * valeur dans `modelUsage`, et c'est celle-là qui prime.
 */
function contextWindowFor(model: string): number {
  return /\[1m\]/i.test(model) ? 1_000_000 : 200_000
}

export type ThreadState = {
  entries: ThreadEntry[]
  pending: PendingPermission | null
  cancelling: boolean
  status: SessionStatus
  /**
   * Entrées en cours de diffusion, par index de bloc.
   *
   * Réinitialisé à chaque message assistant : les index sont relatifs au
   * message courant, pas au fil.
   */
  streamingByIndex: Record<number, string>
}

export const initialThreadState: ThreadState = {
  entries: [],
  pending: null,
  cancelling: false,
  status: {
    sessionId: null,
    model: null,
    toolCount: 0,
    busy: false,
    lastCostUsd: null,
    totalCostUsd: 0,
    contextTokens: null,
    contextLimit: null,
    commands: [],
    permissionMode: null,
  },
  streamingByIndex: {},
}

/** Entrée de transcript relue depuis le disque, à réafficher. */
export type LoadedEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; text: string; isError: boolean }

export type ThreadAction =
  | { type: 'user-submit'; text: string }
  | { type: 'engine-message'; message: EngineMessage }
  | { type: 'notice'; tone: 'info' | 'error'; text: string }
  | { type: 'turn-end'; outcome?: 'done' | 'failed' | 'interrupted' }
  | { type: 'interrupt-requested' }
  | { type: 'permission-resolved'; decision: 'allow' | 'deny' }
  | { type: 'reset' }
  | { type: 'load-transcript'; entries: LoadedEntry[]; sessionId: string }

let counter = 0
const nextId = (prefix: string) => `${prefix}-${++counter}`

/** Remplace une entrée par sa version modifiée, sans muter le tableau. */
function patchEntry(
  entries: ThreadEntry[],
  id: string,
  patch: (entry: ThreadEntry) => ThreadEntry,
): ThreadEntry[] {
  return entries.map(entry => (entry.id === id ? patch(entry) : entry))
}

/** Rend lisible un contenu de résultat d'outil, quelle que soit sa forme. */
function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part =>
        part && typeof part === 'object' && 'text' in part
          ? String((part as { text: unknown }).text)
          : JSON.stringify(part),
      )
      .join('\n')
  }
  return JSON.stringify(content, null, 2)
}

export function threadReducer(
  state: ThreadState,
  action: ThreadAction,
): ThreadState {
  switch (action.type) {
    case 'reset':
      return { ...initialThreadState, entries: [] }

    case 'load-transcript': {
      // Le fil est reconstruit, pas complété : on affiche une session
      // archivée, pas la suite de celle en cours.
      const entries: ThreadEntry[] = []
      for (const loaded of action.entries) {
        if (loaded.kind === 'tool-result') {
          // Le résultat rejoint son appel, émis plus tôt dans le transcript.
          const target = entries.find(e => e.id === loaded.id)
          if (target?.kind === 'tool') {
            target.result = loaded.text
            target.isError = loaded.isError
          }
          continue
        }
        if (loaded.kind === 'tool') {
          entries.push({
            kind: 'tool',
            id: loaded.id,
            name: loaded.name,
            input: loaded.input,
          })
          continue
        }
        entries.push(
          loaded.kind === 'user'
            ? { kind: 'user', id: nextId('user'), text: loaded.text }
            : {
                kind: 'assistant',
                id: nextId('assistant'),
                text: loaded.text,
                streaming: false,
              },
        )
      }
      // Ce qui n'a pas trouvé son résultat dans le transcript n'en aura plus :
      // le fil est reconstruit, aucun outil ne tourne. Marquer l'issue comme
      // inconnue plutôt que de laisser l'absence de résultat passer pour une
      // exécution en cours.
      for (const entry of entries) {
        if (entry.kind === 'tool' && entry.result === undefined) {
          entry.unresolved = true
        }
      }
      return {
        ...initialThreadState,
        entries,
        status: { ...initialThreadState.status, sessionId: action.sessionId },
      }
    }

    case 'user-submit':
      return {
        ...state,
        cancelling: false,
        status: { ...state.status, busy: true },
        entries: [
          ...state.entries,
          { kind: 'user', id: nextId('user'), text: action.text },
        ],
      }

    case 'notice':
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            kind: 'notice',
            id: nextId('notice'),
            text: action.text,
            tone: action.tone,
          },
        ],
      }

    case 'interrupt-requested':
      return { ...state, pending: null, cancelling: true }

    case 'turn-end': {
      const lastUser = state.entries.findLast(e => e.kind === 'user')
      const start = lastUser ? state.entries.indexOf(lastUser) : 0
      const interrupted = state.cancelling || action.outcome === 'interrupted'
      return {
        ...state,
        pending: null,
              cancelling: false,
        status: { ...state.status, busy: false },
        streamingByIndex: {},
        // Un tour peut se terminer alors qu'un bloc n'a jamais reçu son
        // `content_block_stop` — interruption, erreur réseau. Sans ce
        // nettoyage, le curseur de frappe resterait affiché indéfiniment.
        entries: state.entries.map((entry, index) => {
          if (index < start) return entry
          if (entry.kind === 'user') return { ...entry, outcome: interrupted ? 'interrupted' as const : action.outcome ?? entry.outcome ?? 'unknown' as const }
          if ((entry.kind === 'assistant' || entry.kind === 'thinking') && entry.streaming) return { ...entry, streaming: false }
          if (entry.kind === 'tool' && entry.result === undefined && !entry.unresolved && entry.decision !== 'deny') return interrupted ? { ...entry, interrupted: true as const } : { ...entry, unresolved: true as const }
          return entry
        }),
      }
    }

    case 'permission-resolved': {
      const pending = state.pending
      if (!pending) return state
      return {
        ...state,
        pending: null,
        entries: state.entries.map(entry =>
          entry.kind === 'tool' && entry.id === pending.toolUseId
            ? { ...entry, decision: action.decision }
            : entry,
        ),
      }
    }

    case 'engine-message':
      return reduceEngineMessage(state, action.message)
  }
}

function reduceEngineMessage(
  state: ThreadState,
  message: EngineMessage,
): ThreadState {
  // --- Messages d'un sous-agent --------------------------------------------
  //
  // Le moteur marque d'un `parent_tool_use_id` tout ce que produit un agent
  // lancé par un outil. Ces messages ont exactement la forme des autres : sans
  // ce détour, le texte et les appels d'outils d'un sous-agent étaient versés
  // dans le fil principal, où ils se donnaient pour des réponses de l'agent
  // principal — et son bavardage repoussait la vraie conversation hors de
  // l'écran.
  //
  // Ils sont donc rattachés à l'appel qui les a lancés, et n'apparaissent plus
  // au premier niveau.
  const parent = (message as { parent_tool_use_id?: string | null })
    .parent_tool_use_id
  if (parent) {
    return reduceSubAgent(state, message, parent)
  }

  // --- Initialisation de session -------------------------------------------
  // --- Limite d'usage atteinte ---------------------------------------------
  //
  // Le moteur réessaie en silence, en espaçant les tentatives. Sans un mot, un
  // tour semble simplement figé pendant plusieurs minutes — et c'est le cas le
  // plus déroutant, parce que rien ne distingue une limite d'usage d'une panne.
  if (
    message.type === 'system' &&
    (message as { subtype?: string }).subtype === 'api_retry'
  ) {
    const retry = message as unknown as {
      attempt?: number
      max_retries?: number
      retry_delay_ms?: number
      error_status?: number
      error?: string
    }
    if (retry.error_status !== 429) return state

    const seconds = Math.round((retry.retry_delay_ms ?? 0) / 1000)
    const when = new Date(Date.now() + (retry.retry_delay_ms ?? 0))
    const heure = when.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    const text =
      `Limite d'usage atteinte sur votre compte. Nouvelle tentative dans ` +
      `${seconds} s, vers ${heure} — essai ${retry.attempt ?? '?'} sur ` +
      `${retry.max_retries ?? '?'}.`

    // Une seule ligne, réécrite : dix tentatives produiraient dix messages
    // identiques et pousseraient la conversation hors de l'écran.
    const last = state.entries[state.entries.length - 1]
    if (last?.kind === 'notice' && last.text.startsWith("Limite d'usage")) {
      return {
        ...state,
        entries: patchEntry(state.entries, last.id, entry =>
          entry.kind === 'notice' ? { ...entry, text } : entry,
        ),
      }
    }
    return {
      ...state,
      entries: [
        ...state.entries,
        { kind: 'notice', id: nextId('notice'), text, tone: 'error' },
      ],
    }
  }

  if (message.type === 'system' && (message as { subtype?: string }).subtype === 'init') {
    const init = message as unknown as {
      session_id: string
      tools?: string[]
      model?: string
      permissionMode?: PermissionMode
      /** Commandes acceptées en tête de message, plugins compris. */
      slash_commands?: string[]
      context_limit?: number
    }
    const model = init.model ?? state.status.model
    return {
      ...state,
      status: {
        ...state.status,
        sessionId: init.session_id,
        model,
        toolCount: init.tools?.length ?? state.status.toolCount,
        commands: init.slash_commands ?? state.status.commands,
        contextLimit: init.context_limit ?? (model ? contextWindowFor(model) : state.status.contextLimit),
        permissionMode: init.permissionMode ?? state.status.permissionMode,
      },
    }
  }

  // --- Fragments de diffusion ----------------------------------------------
  if (message.type === 'stream_event') {
    return reduceStreamEvent(state, (message as { event: RawEvent }).event)
  }

  // --- Message assistant complet -------------------------------------------
  if (message.type === 'assistant') {
    const blocks =
      (message as { message?: { content?: ContentBlock[] } }).message?.content ??
      []
    let entries = state.entries

    for (const block of blocks) {
      if (block.type === 'tool_use') {
        const toolBlock = block as {
          id: string
          name: string
          input: unknown
        }
        // Clé sur l'identifiant d'appel : c'est lui que portera le
        // `tool_result` correspondant, plus tard et dans un autre message.
        if (!entries.some(e => e.id === toolBlock.id)) {
          entries = [
            ...entries,
            {
              kind: 'tool',
              id: toolBlock.id,
              name: toolBlock.name,
              input: toolBlock.input,
            },
          ]
        }
      } else if (block.type === 'text') {
        const text = (block as { text: string }).text
        if (!text.trim()) continue

        // Un bloc ouvert par la diffusion mais resté vide : certains
        // fournisseurs annoncent le bloc puis n'envoient aucun fragment, et
        // ne livrent le texte qu'ici, dans le message complet. Compter cette
        // coquille comme « déjà affiché » faisait disparaître la réponse
        // entière — l'utilisateur voyait les appels d'outils, puis rien.
        const streamedId = Object.values(state.streamingByIndex).find(id =>
          entries.some(e => e.id === id && e.kind === 'assistant'),
        )
        const streamed = streamedId
          ? entries.find(e => e.id === streamedId)
          : undefined
        const empty =
          streamed && streamed.kind === 'assistant' && !streamed.text.trim()

        if (empty && streamedId) {
          entries = patchEntry(entries, streamedId, entry =>
            entry.kind === 'assistant' ? { ...entry, text, streaming: false } : entry,
          )
        } else if (!streamed) {
          entries = [
            ...entries,
            { kind: 'assistant', id: nextId('assistant'), text, streaming: false },
          ]
        }
      }
    }

    return { ...state, entries, streamingByIndex: {} }
  }

  // --- Résultat d'outil ----------------------------------------------------
  if (message.type === 'user') {
    const blocks =
      (message as { message?: { content?: ContentBlock[] } }).message?.content ??
      []
    let entries = state.entries
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue
      const resultBlock = block as {
        tool_use_id: string
        content: unknown
        is_error?: boolean
      }
      entries = patchEntry(entries, resultBlock.tool_use_id, entry =>
        entry.kind === 'tool'
          ? {
              ...entry,
              result: stringifyToolResult(resultBlock.content),
              isError: resultBlock.is_error ?? false,
            }
          : entry,
      )
    }
    return { ...state, entries }
  }

  // --- Demande de permission -----------------------------------------------
  if (message.type === 'control_request') {
    if (state.cancelling) return state
    const request = (message as { request: { subtype: string } }).request
    if (request.subtype !== 'can_use_tool') return state
    const permission = request as unknown as {
      tool_name: string
      input: Record<string, unknown>
      tool_use_id: string
      title?: string
      description?: string
      decision_reason?: string
    }
    return {
      ...state,
      pending: {
        requestId: (message as { request_id: string }).request_id,
        toolName: permission.tool_name,
        input: permission.input,
        toolUseId: permission.tool_use_id,
        title: permission.title,
        description: permission.description,
        reason: permission.decision_reason,
      },
    }
  }

  // --- Fin de tour ---------------------------------------------------------
  if (message.type === 'result') {
    const result = message as {
      is_error?: boolean
      result?: string
      total_cost_usd?: number
      subtype?: string
      usage?: {
        input_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
      /** Par modèle sollicité ; porte la taille réelle de la fenêtre. */
      modelUsage?: Record<string, { contextWindow?: number }>
    }
    const cost = result.total_cost_usd ?? null
    // Taille du contexte réellement envoyé : la mise en cache change la
    // facturation, pas le volume. Les trois postes s'additionnent donc.
    const usage = result.usage
    const contextTokens = usage
      ? (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
      : state.status.contextTokens

    // Le moteur annonce la fenêtre du modèle qu'il a réellement employé —
    // valeur d'autorité, qui tient compte des bascules internes et des
    // configurations de fournisseur que le nom du modèle ne trahit pas.
    const announced = Object.values(result.modelUsage ?? {}).find(
      entry => typeof entry.contextWindow === 'number',
    )?.contextWindow
    const lastUser = state.entries.findLast(e => e.kind === 'user')
    const outcome = state.cancelling ? 'interrupted' as const : result.is_error ? 'failed' as const : result.subtype === 'success' ? 'done' as const : 'unknown' as const
    const settled = state.entries.map(e => e === lastUser && e.kind === 'user' ? { ...e, outcome } : e)
    const entries =
      result.is_error && result.subtype !== 'success' && !state.cancelling
        ? [
            ...settled,
            {
              kind: 'notice' as const,
              id: nextId('notice'),
              text: result.result ?? `Turn ended: ${result.subtype ?? 'error'}`,
              tone: 'error' as const,
            },
          ]
        : settled

    return {
      ...state,
      entries,
      status: {
        ...state.status,
        lastCostUsd: cost,
        totalCostUsd: state.status.totalCostUsd + (cost ?? 0),
        contextTokens,
        contextLimit: announced ?? state.status.contextLimit,
      },
    }
  }

  return state
}

type RawEvent = {
  type: string
  index?: number
  content_block?: { type: string }
  delta?: { type: string; text?: string; thinking?: string }
}

/**
 * Rattache l'activité d'un sous-agent à l'appel d'outil qui l'a lancé.
 *
 * Seuls les messages `assistant` comptent : les fragments de diffusion
 * (`stream_event`) répètent le même texte morceau par morceau et feraient
 * gonfler le compteur d'un pas par syllabe. Les `result` et les `system`
 * relèvent de la session entière, pas du sous-agent.
 *
 * Un message dont le parent est introuvable est **ignoré**, pas ajouté au fil.
 * Le cas se produit sur une session reprise, où le transcript rechargé n'a pas
 * recréé l'appel d'origine : le montrer au premier niveau serait exactement le
 * défaut que cette fonction corrige.
 */
function reduceSubAgent(
  state: ThreadState,
  message: EngineMessage,
  parentId: string,
): ThreadState {
  if (message.type !== 'assistant') return state

  const parent = state.entries.find(
    e => e.id === parentId && e.kind === 'tool',
  )
  if (!parent) return state

  const blocks =
    (message as { message?: { content?: ContentBlock[] } }).message?.content ??
    []

  let pas = 0
  let dernierTexte: string | undefined
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      pas += 1
    } else if (block.type === 'text') {
      const texte = (block as { text: string }).text.trim()
      if (!texte) continue
      pas += 1
      dernierTexte = texte
    }
  }
  if (pas === 0) return state

  return {
    ...state,
    entries: patchEntry(state.entries, parentId, entry =>
      entry.kind === 'tool'
        ? {
            ...entry,
            child: {
              steps: (entry.child?.steps ?? 0) + pas,
              lastText: dernierTexte ?? entry.child?.lastText,
            },
          }
        : entry,
    ),
  }
}

function reduceStreamEvent(state: ThreadState, event: RawEvent): ThreadState {
  const index = event.index ?? 0

  if (event.type === 'content_block_start') {
    const blockType = event.content_block?.type
    // Les appels d'outils sont ignorés ici : leur entrée arrive en JSON
    // fragmenté, coûteux à recomposer, alors que le message assistant final
    // la livre entière.
    if (blockType !== 'text' && blockType !== 'thinking') return state

    const id = nextId(blockType)
    return {
      ...state,
      streamingByIndex: { ...state.streamingByIndex, [index]: id },
      entries: [
        ...state.entries,
        blockType === 'text'
          ? { kind: 'assistant', id, text: '', streaming: true }
          : { kind: 'thinking', id, text: '', streaming: true },
      ],
    }
  }

  if (event.type === 'content_block_delta') {
    const id = state.streamingByIndex[index]
    if (!id) return state
    const chunk = event.delta?.text ?? event.delta?.thinking
    if (!chunk) return state
    return {
      ...state,
      entries: patchEntry(state.entries, id, entry =>
        entry.kind === 'assistant' || entry.kind === 'thinking'
          ? { ...entry, text: entry.text + chunk }
          : entry,
      ),
    }
  }

  if (event.type === 'content_block_stop') {
    const id = state.streamingByIndex[index]
    if (!id) return state
    return {
      ...state,
      entries: patchEntry(state.entries, id, entry =>
        entry.kind === 'assistant' || entry.kind === 'thinking'
          ? { ...entry, streaming: false }
          : entry,
      ),
    }
  }

  return state
}
