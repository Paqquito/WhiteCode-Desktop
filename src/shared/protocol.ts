/**
 * Types du protocole de contrôle, côté client.
 *
 * Sous-ensemble de ce que le moteur émet et accepte, limité à ce que la
 * coquille applicative consomme réellement. La source de vérité reste
 * `src/entrypoints/sdk/controlSchemas.ts` dans le moteur ; ces types en sont
 * la vue client, tenue à la main pour que l'application reste indépendante du
 * paquet du moteur.
 */

/** Bloc de contenu d'un message assistant. */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [key: string]: unknown }

/** Message entrant, une ligne JSON du flux sortant du moteur. */
export type EngineMessage =
  | {
      type: 'system'
      subtype: 'init'
      session_id: string
      cwd: string
      tools: string[]
      model?: string
    }
  | { type: 'system'; subtype: string; [key: string]: unknown }
  | {
      type: 'assistant'
      message: { id: string; model: string; content: ContentBlock[] }
    }
  | { type: 'user'; message: { content: ContentBlock[] } }
  | {
      /**
       * Fragment de réponse en cours de diffusion.
       *
       * Émis seulement avec `--include-partial-messages`. Sans lui, les
       * messages `assistant` n'arrivent qu'une fois le bloc terminé : le
       * texte apparaîtrait d'un coup, ce qui donne une impression de blocage
       * sur les réponses longues.
       */
      type: 'stream_event'
      event: RawStreamEvent
    }
  | { type: 'control_request'; request_id: string; request: ControlRequestInner }
  | {
      type: 'result'
      subtype: string
      is_error: boolean
      result?: string
      duration_ms?: number
      total_cost_usd?: number
      session_id?: string
    }
  | { type: 'rate_limit_event'; [key: string]: unknown }
  | { type: string; [key: string]: unknown }

/** Événement brut de diffusion, tel que rendu par l'API. */
export type RawStreamEvent =
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | {
      type: 'content_block_delta'
      index: number
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: string; [key: string]: unknown }
    }
  | { type: 'content_block_stop'; index: number }
  | { type: string; [key: string]: unknown }

/** Demande de contrôle émise par le moteur. */
export type ControlRequestInner =
  | {
      subtype: 'can_use_tool'
      tool_name: string
      input: Record<string, unknown>
      tool_use_id: string
      title?: string
      description?: string
      decision_reason?: string
      blocked_path?: string
    }
  | { subtype: string; [key: string]: unknown }

/** Décision rendue par le client sur une demande de permission. */
export type PermissionDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string }

// ---------------------------------------------------------------------------
// Modèle d'affichage
// ---------------------------------------------------------------------------

/**
 * Une entrée du fil de conversation.
 *
 * Volontairement distinct des messages du protocole : le fil agrège
 * (un `tool_use` et son `tool_result` forment une seule entrée) et accumule
 * (les fragments de texte se concatènent). Les rendre tels quels produirait
 * un affichage haché et des appels d'outils séparés de leurs résultats.
 */

export type ThreadEntry =
  | { kind: 'user'; id: string; text: string; outcome?: 'done' | 'failed' | 'interrupted' | 'unknown' }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'thinking'; id: string; text: string; streaming: boolean }
  | {
      kind: 'tool'
      id: string
      name: string
      input: unknown
      /** `undefined` tant que l'outil n'a pas rendu son résultat. */
      result?: string
      isError?: boolean
      /** Décision prise, quand l'outil a demandé une permission. */
      decision?: 'allow' | 'deny'
      /**
       * Restauré d'un transcript sans résultat enregistré.
       *
       * L'issue est **inconnue** : la session a pu être interrompue, l'outil
       * échouer sans trace, ou le résultat n'avoir jamais été écrit. Un appel
       * sans résultat se donnait jusqu'ici pour un appel *en cours*, ce qui
       * annonçait une activité dans une conversation archivée où plus rien ne
       * tourne (constat D06 de l'audit du 14 septembre 2026).
       */
      unresolved?: true
      /** Arrêt demandé pendant cet appel ; aucun résultat inventé. */
      interrupted?: true
      /**
       * Activité du sous-agent lancé par cet appel.
       *
       * Présent uniquement sur les appels qui en lancent un — `Task` et ses
       * semblables. Le moteur marque chaque message produit par un sous-agent
       * d'un `parent_tool_use_id` désignant cet appel ; sans ce champ, ces
       * messages étaient versés dans le fil principal, où ils se donnaient
       * pour des réponses de l'agent principal.
       */
      child?: {
        /** Nombre de pas du sous-agent : réponses et appels d'outils. */
        steps: number
        /** Dernier texte produit, pour montrer où il en est. */
        lastText?: string
      }
    }
  | { kind: 'notice'; id: string; text: string; tone: 'info' | 'error' }

/** Demande de permission en attente d'arbitrage par l'utilisateur. */
export type PendingPermission = {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  toolUseId: string
  title?: string
  description?: string
  reason?: string
}

// ---------------------------------------------------------------------------
// Réglages de session
// ---------------------------------------------------------------------------

/**
 * Mode de permission.
 *
 * Reprend `EXTERNAL_PERMISSION_MODES` du moteur. Ce ne sont pas des
 * préférences d'affichage : chacun change ce que le moteur fait sans
 * demander.
 */
export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions'
  | 'dontAsk'

/** Niveau d'effort, tel que l'accepte `--effort`. */
export type EffortLevel = 'low' | 'medium' | 'high' | 'max'

/**
 * Réglages appliqués au prochain tour.
 *
 * Le moteur tourne en mode `--print` : un sous-processus par tour, qui se
 * termine sur `result`. Il n'y a donc pas de processus permanent à
 * reconfigurer — ces réglages deviennent des **drapeaux de lancement**. Un
 * changement en cours de tour est en plus poussé par requête de contrôle, le
 * sous-processus étant alors vivant.
 */
export type SessionSettings = {
  /** Copie des consignes du projet, ajoutée au prompt système à chaque tour. */
  projectInstructions?: string
  /** null/undefined: enabled registry entries; []: no MCP servers for this session. */
  mcpServers?: string[] | null
  permissionMode: PermissionMode
  /**
   * Dossiers accessibles en plus de l'espace de travail.
   *
   * Sans eux, tout chemin hors du dossier ouvert déclenche une demande — quel
   * que soit le mode, puisque le moteur la classe comme indécise. En mode
   * « sans interruption » elle devient même un refus, ce qui fait croire à
   * une panne. Les autoriser une fois vaut mieux que répondre à chaque appel.
   */
  extraDirs: string[]
  /**
   * Restreint les outils offerts au modèle.
   *
   * `null` : tous. Sinon, une liste de noms. Ce n'est pas un réglage de
   * confort : la définition des trente-cinq outils occupe l'essentiel de
   * l'invite système, et un modèle local la relit intégralement à chaque tour.
   * La réduire est le seul levier qui change vraiment le temps de réponse.
   */
  tools: string[] | null
  /** `null` : le fournisseur choisit une route explicite dans son catalogue. */
  model: string | null
  /** `null` : l'effort par défaut du moteur. */
  effort: EffortLevel | null
}

/**
 * Outils indispensables.
 *
 * De quoi lire, écrire et exécuter — ce dont un agent de code ne peut pas se
 * passer. Les autres outils intégrés (web, notebooks, sous-agents) sortent du
 * jeu réduit. Les serveurs MCP se sélectionnent séparément par conversation.
 * Retirer les définitions d'outils inutilisées allège l'invite système
 * de plusieurs milliers de jetons, ce qui se voit directement sur le temps de
 * réponse d'un modèle local.
 */
export const ESSENTIAL_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'TodoWrite',
]

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  permissionMode: 'default',
  extraDirs: [],
  tools: null,
  model: null,
  effort: null,
}

/** État de session affiché en pied de fenêtre. */
export type SessionStatus = {
  sessionId: string | null
  model: string | null
  toolCount: number
  /**
   * Commandes que le moteur accepte en tête de message, sans la barre.
   *
   * Annoncées à l'initialisation, et non fixées ici : elles dépendent des
   * plugins chargés pour la session. Une liste écrite en dur proposerait des
   * commandes absentes et tairait celles qu'une extension vient d'apporter.
   */
  commands: string[]
  busy: boolean
  lastCostUsd: number | null
  totalCostUsd: number
  /**
   * Jetons occupés par le contexte au dernier appel.
   *
   * Somme des entrées du dernier `result` : saisie, écriture de cache et
   * lecture de cache. C'est bien la taille du contexte envoyé, la mise en
   * cache ne changeant que la facturation, pas le volume.
   */
  contextTokens: number | null
  /** Taille de la fenêtre, déduite du nom du modèle. */
  contextLimit: number | null
  /** Mode rapporté par le moteur à l'initialisation. */
  permissionMode: PermissionMode | null
}
