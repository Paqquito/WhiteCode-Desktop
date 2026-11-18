import * as React from 'react'
import type { ThreadEntry } from '../../shared/protocol.js'
import { toolDescription, toolLabel, toolState, toolStateCount, type ToolState } from '../../shared/activity.js'
import { ToolCall } from './ToolCall.js'

/**
 * Résumé d'un bloc d'activité, en phrase : « 3 outils : 2 terminés, 1 en
 * échec ». L'ancienne forme alignait des points médians (« 3 outils 2 ·
 * Terminé 1 · Échec ») qui se lisaient mal et laissaient deviner à quoi se
 * rapportait chaque chiffre.
 */
export function ActivityGroup({ entries, onShowAgents }: { entries: ThreadEntry[]; onShowAgents?: () => void }) {
  const tools = entries.filter(e => e.kind === 'tool')
  const counts = new Map<ToolState, number>()
  for (const tool of tools) { const state = toolState(tool); counts.set(state, (counts.get(state) ?? 0) + 1) }
  const active = tools.findLast(e => toolState(e) === 'working')
  const thinking = entries.some(e => e.kind === 'thinking' && e.streaming)
  const running = Boolean(active || thinking)
  const states = [...counts]
  // Un seul état pour tous : « 3 outils terminés » plutôt que « 3 outils : 3 terminés ».
  const uniform = states.length === 1
  return <details className={`activity-group${running ? ' running' : ''}`}>
    <summary>
      <span className="activity-heading">{tools.length > 0 ? `${tools.length} outil${tools.length > 1 ? 's' : ''}` : thinking ? 'Réflexion en cours' : 'Réflexion'}{states.length > 1 ? ' :' : ''}</span>
      {states.length > 0 && <span className="activity-counts">{states.map(([state, count], index) => <span key={state} className={`activity-count ${state}`}>
        {uniform ? toolStateCount(state, count).replace(/^\d+ /, '') : toolStateCount(state, count)}{index < states.length - 1 ? ',' : ''}
      </span>)}</span>}
      {active && <span className="activity-preview">{activeLine(active)}</span>}
    </summary>
    {active && <p className="activity-current">{toolDescription(active)}</p>}
    <div className="activity-entries">{entries.map(entry => entry.kind === 'tool'
      ? <ToolCall key={entry.id} entry={entry} />
      : entry.kind === 'thinking' ? <details className="entry thinking" key={entry.id}><summary>Réflexion{entry.streaming ? ' en cours' : ''}</summary><pre>{entry.text}</pre></details> : null)}</div>
    {tools.some(e => e.child || e.name === 'spawn_agent') && onShowAgents && <button type="button" className="activity-agents" onClick={onShowAgents}>Voir les sous-tâches</button>}
  </details>
}

/** « Sous-tâche : Vérifier l'accessibilité (2 étapes) », « Commande : npm test ». */
function activeLine(entry: Extract<ThreadEntry, { kind: 'tool' }>): string {
  const label = toolLabel(entry.name)
  const description = toolDescription(entry)
  const steps = entry.child ? ` (${entry.child.steps} étape${entry.child.steps > 1 ? 's' : ''})` : ''
  return (description === entry.name ? label : `${label} : ${description}`) + steps
}
