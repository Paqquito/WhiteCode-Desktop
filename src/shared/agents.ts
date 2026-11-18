/**
 * Sous-agents d'une session, reconstitués depuis le fil.
 *
 * Même parti que le panneau Plan : le fil est déjà la source de vérité, et un
 * état parallèle finirait par diverger. Un sous-agent est donc simplement un
 * appel d'outil qui en a lancé un — le réducteur lui attache l'activité de son
 * enfant sous `child` (`thread.ts`, `reduceSubAgent`).
 *
 * Ce que la vue apporte que le fil n'apporte pas : la **position**. Dans un
 * tour chargé, les appels défilent ; savoir lequel travaille encore suppose de
 * remonter la conversation. Épinglés à droite, ils restent lisibles pendant
 * l'exécution — c'est exactement le moment où la question se pose.
 */

import { toolState, type ToolState } from './activity.js'
import type { ThreadEntry } from './protocol.js'

/**
 * État d'un sous-agent, tel que le fil permet de l'établir.
 *
 * Le même état que l’appel parent : actif, terminé, échoué, refusé,
 * interrompu ou inconnu. Une absence de résultat historique ne prouve
 * jamais qu’un sous-agent travaille encore.
 */
export type AgentStatus = ToolState

export type AgentView = {
  /** Identifiant de l'appel d'outil qui a lancé l'agent. */
  id: string
  /** Nom de l'outil lanceur — `Task` et ses semblables. */
  tool: string
  /**
   * Description lisible, quand l'appel en porte une.
   *
   * Récupérée de l'entrée de l'outil : les lanceurs d'agents portent presque
   * tous un champ de description, mais aucun contrat ne l'impose — d'où
   * l'optionnalité plutôt qu'une chaîne vide qui se ferait passer pour un
   * libellé.
   */
  description?: string
  status: AgentStatus
  /** Pas accomplis : réponses et appels d'outils du sous-agent. */
  steps: number
  /** Dernier mot du sous-agent, pour dire où il en est. */
  lastText?: string
}

/** Champs de description rencontrés sur les outils qui lancent un agent. */
const CHAMPS_DESCRIPTION = ['description', 'prompt', 'task'] as const

function descriptionDe(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const objet = input as Record<string, unknown>
  for (const champ of CHAMPS_DESCRIPTION) {
    const valeur = objet[champ]
    if (typeof valeur === 'string' && valeur.trim()) return valeur.trim()
  }
  return undefined
}

/**
 * Les sous-agents de ce fil, dans l'ordre où ils ont été lancés.
 *
 * Seuls les appels ayant réellement produit une activité sont retenus. Un
 * `Task` dont aucun message enfant n'est encore arrivé n'apparaît pas : le
 * montrer à zéro pas laisserait croire à un agent bloqué alors qu'il démarre.
 */
export function agentsFromEntries(entries: ThreadEntry[]): AgentView[] {
  const agents: AgentView[] = []
  for (const entry of entries) {
    if (entry.kind !== 'tool' || !entry.child && entry.name !== 'spawn_agent') continue
    agents.push({
      id: entry.id,
      tool: entry.name,
      description: descriptionDe(entry.input),
      status: toolState(entry),
      steps: entry.child?.steps ?? 0,
      lastText: entry.child?.lastText,
    })
  }
  return agents
}

/** Combien travaillent encore — le seul chiffre utile sur une pastille. */
export function workingCount(agents: AgentView[]): number {
  return agents.filter(a => a.status === 'working').length
}
