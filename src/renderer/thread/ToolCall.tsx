/**
 * Appel d'outil.
 *
 * Replié par défaut : dans un tour chargé, une trentaine d'appels dépliés
 * noieraient la réponse. Le bloc d’activité expose les échecs ; ouvrir
 * un appel affiche ses arguments, son diff demandé et son résultat réel.
 */

import * as React from 'react'
import type { ThreadEntry } from '../../shared/protocol.js'
import { toolState, TOOL_STATE_LABELS, toolDescription, toolLabel } from '../../shared/activity.js'
import { Icon } from '../ui/Icon.js'
import { asFileChange, FileChangeView } from './Diff.js'

type ToolEntry = Extract<ThreadEntry, { kind: 'tool' }>

export function ToolCall({ entry }: { entry: ToolEntry }): React.ReactNode {
  const change = asFileChange(entry.name, entry.input)
  const state = toolState(entry)
  const failed = state === 'failed'

  return (
    <details className={`tool-call${failed ? ' failed' : ''}`} >
      <summary>
        <Icon name="chevron-right" size={12} className="disclosure" />
        <span className="tool-name" title={entry.name}>{toolLabel(entry.name)}</span>
        <span className={`tool-state ${state}`}>{TOOL_STATE_LABELS[state]}</span>
        <span className="tool-description" title={toolDescription(entry)}>{toolDescription(entry)}</span>
        {/* Un sous-agent travaille sous cet appel. Son détail n'a pas sa place
            dans le fil — il y passerait pour la réponse principale — mais son
            avancement, si : sans lui, un `Task` de plusieurs minutes est
            indiscernable d'un outil figé. */}
        {entry.child && (
          <span className="tool-state">{entry.child.steps} étape{entry.child.steps > 1 ? 's' : ''}</span>
        )}
      </summary>

      {entry.child?.lastText && (
        <p className="tool-child-last">{entry.child.lastText}</p>
      )}

      {change && state !== 'done' && <p className="tool-proposal">Modification demandée ; son application n’est pas confirmée.</p>}
      {change ? (
        <FileChangeView change={change} />
      ) : (
        <pre className="tool-input">{JSON.stringify(entry.input, null, 2)}</pre>
      )}

      {/* Une modification réussie n'a pas de sortie utile : le diff dit déjà
          tout. Le résultat n'apparaît que s'il porte une erreur. */}
      {entry.result !== undefined && (!change || failed) && (
        <pre className="tool-result">{entry.result}</pre>
      )}
    </details>
  )
}
