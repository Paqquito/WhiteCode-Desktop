/**
 * Panneau Agents.
 *
 * Qui travaille en ce moment, sous quel appel, et où il en est.
 *
 * Le fil montre déjà chaque sous-agent sous l'appel qui l'a lancé, mais dans
 * un tour chargé ces appels défilent : savoir lequel tourne encore suppose de
 * remonter la conversation pendant qu'elle s'allonge. Épinglée à droite, la
 * liste répond d'un coup d'œil — et c'est pendant l'exécution que la question
 * se pose, pas après.
 *
 * Le panneau ne détient aucun état : tout est dérivé du fil (`agents.ts`),
 * comme le plan et les modifications. Un état parallèle finirait par diverger.
 */

import * as React from 'react'
import {
  agentsFromEntries,
  type AgentStatus,
  type AgentView,
} from '../../shared/agents.js'
import type { ThreadEntry } from '../../shared/protocol.js'
import { Panel, PanelEmpty } from '../ui/Panel.js'

const LIBELLE: Record<AgentStatus, string> = {
  working: 'en cours',
  done: 'terminé',
  failed: 'échec',
  unknown: 'issue inconnue', interrupted: 'interrompu', denied: 'refusé',
}

function AgentRow({ agent }: { agent: AgentView }): React.ReactNode {
  return (
    <li className={`agent-row ${agent.status}`}>
      <div className="agent-head">
        <span className="agent-tool">{agent.tool}</span>
        <span className={`agent-status ${agent.status}`}>
          {LIBELLE[agent.status]}
        </span>
        <span className="agent-steps">{agent.steps} pas</span>
      </div>

      {agent.description && (
        <p className="agent-description">{agent.description}</p>
      )}

      {/* Le dernier mot n'est montré que tant qu'il informe : une fois l'agent
          terminé, c'est son résultat qui compte, et il est dans le fil. */}
      {agent.status === 'working' && agent.lastText && (
        <p className="agent-last">{agent.lastText}</p>
      )}
    </li>
  )
}

export function AgentsPanel({
  entries,
  onClose,
}: {
  entries: ThreadEntry[]
  onClose: () => void
}): React.ReactNode {
  const agents = React.useMemo(() => agentsFromEntries(entries), [entries])

  return (
    <Panel title="Sous-tâches" icon="branch" onClose={onClose}>
      {agents.length === 0 ? (
        <PanelEmpty>Aucune sous-tâche lancée dans cette conversation.</PanelEmpty>
      ) : (
        <ul className="agent-list">
          {agents.map(agent => (
            <AgentRow key={agent.id} agent={agent} />
          ))}
        </ul>
      )}
    </Panel>
  )
}
