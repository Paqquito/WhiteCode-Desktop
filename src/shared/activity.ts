import type { ThreadEntry } from '#desktop/session-protocol'
export type ToolEntry = Extract<ThreadEntry, { kind: 'tool' }>
export type ToolState = 'working' | 'done' | 'failed' | 'denied' | 'interrupted' | 'unknown'
export const TOOL_STATE_LABELS: Record<ToolState, string> = {
  working: 'En cours', done: 'Terminé', failed: 'Échec', denied: 'Refusé', interrupted: 'Interrompu', unknown: 'Issue inconnue',
}
/** Libellé d'un état après un nombre : « 2 terminés », « 1 en échec ». */
export function toolStateCount(state: ToolState, count: number): string {
  const s = count > 1 ? 's' : ''
  const label = { working: 'en cours', done: `terminé${s}`, failed: 'en échec', denied: `refusé${s}`, interrupted: `interrompu${s}`, unknown: 'à l’issue inconnue' }[state]
  return `${count} ${label}`
}

const TOOL_LABELS: Record<string, string> = {
  Task: 'Sous-tâche', Agent: 'Sous-tâche', spawn_agent: 'Sous-tâche',
  Bash: 'Commande', PowerShell: 'Commande', Read: 'Lecture', Write: 'Écriture', Edit: 'Modification', MultiEdit: 'Modification',
  NotebookEdit: 'Modification', Grep: 'Recherche', Glob: 'Recherche de fichiers', LS: 'Dossier',
  WebSearch: 'Recherche web', WebFetch: 'Page web', TodoWrite: 'Liste de tâches',
}

/**
 * Nom d'outil lisible : le fil s'adresse à l'utilisateur, pas au protocole.
 * Le nom technique reste disponible en infobulle. Un outil MCP
 * (`mcp__serveur__outil`) s'affiche « outil (serveur) ».
 */
export function toolLabel(name: string): string {
  const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name)
  if (mcp) return `${TOOL_LABELS[mcp[2]!] ?? mcp[2]} (${mcp[1]})`
  return TOOL_LABELS[name] ?? name
}

export function toolState(entry: ToolEntry): ToolState {
  if (entry.decision === 'deny') return 'denied'
  if (entry.interrupted) return 'interrupted'
  if (entry.unresolved) return 'unknown'
  if (entry.isError) return 'failed'
  return entry.result === undefined ? 'working' : 'done'
}
export function toolDescription(entry: ToolEntry): string {
  if (!entry.input || typeof entry.input !== 'object') return entry.name
  const input = entry.input as Record<string, unknown>
  const value = input.description ?? input.file_path ?? input.path ?? input.pattern ?? input.command ?? input.query
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').slice(0, 180) : entry.name
}
export type Turn = { id: string; user?: Extract<ThreadEntry, { kind: 'user' }>; entries: ThreadEntry[] }
export function conversationTurns(entries: ThreadEntry[]): Turn[] {
  const turns: Turn[] = []
  for (const entry of entries) {
    if (entry.kind === 'user') turns.push({ id: entry.id, user: entry, entries: [] })
    else {
      if (!turns.length) turns.push({ id: entry.id, entries: [] })
      turns[turns.length - 1]!.entries.push(entry)
    }
  }
  return turns
}
/** Group only adjacent activity. Assistant messages keep their original position. */
export function activityBlocks(entries: ThreadEntry[]): ThreadEntry[][] {
  const blocks: ThreadEntry[][] = []
  const activity = (entry: ThreadEntry) => entry.kind === 'tool' || entry.kind === 'thinking'
  for (const entry of entries) {
    const previous = blocks.at(-1)
    if (activity(entry) && previous && activity(previous[0]!)) previous.push(entry)
    else blocks.push([entry])
  }
  return blocks
}
