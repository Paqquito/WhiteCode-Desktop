/**
 * Fil de conversation.
 *
 * Chaque nature d'entrée a son composant. L'aiguillage se fait sur le
 * discriminant `kind` : ajouter une nature revient à ajouter une branche et
 * un composant, sans toucher au reste.
 */

import * as React from 'react'
import type { ThreadEntry } from '#desktop/session-protocol'
import { Icon } from '../ui/Icon.js'
import { LinkedText } from './fileLink.js'
import { Markdown } from './Markdown.js'
import { conversationTurns, activityBlocks } from '#desktop/tool-activity'
import { ActivityGroup } from './ActivityGroup.js'
import { TurnSummary } from '#desktop/turn-summary'
import { ToolCall } from './ToolCall.js'

export function Thread({ entries, onEdit, onFork, busy = false, cancelling = false, waiting = false, waitingLabel, onPermission, onReview, onShowAgents }: {
  entries: ThreadEntry[]; onEdit?: (text: string) => void; onFork?: (text: string) => void;
  busy?: boolean; cancelling?: boolean; waiting?: boolean; waitingLabel?: string; onPermission?: () => void;
  onReview?: () => void; onShowAgents?: () => void;
}): React.ReactNode {
  const threadRef = React.useRef<HTMLDivElement>(null)
  const follow = React.useRef(true)
  const lastUser = React.useRef<string | undefined>(undefined)
  const [atBottom, setAtBottom] = React.useState(true)
  const turns = React.useMemo(() => conversationTurns(entries), [entries])
  const bottom = React.useCallback(() => {
    follow.current = true; setAtBottom(true)
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [])
  React.useLayoutEffect(() => {
    const user = turns.at(-1)?.user?.id
    if (user !== lastUser.current) { follow.current = true; lastUser.current = user }
    if (follow.current) bottom()
  }, [entries, bottom, turns])
  React.useEffect(() => {
    const observer = new ResizeObserver(() => { if (follow.current) bottom() })
    if (threadRef.current) observer.observe(threadRef.current)
    return () => observer.disconnect()
  }, [bottom])
  return <div className="thread-shell">
    <div className="thread" ref={threadRef} onScroll={event => {
      const node = event.currentTarget
      follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
      setAtBottom(follow.current)
    }}>
      {turns.map((turn, index) => {
        const active = index === turns.length - 1
        const finalResponse = !busy || !active ? turn.entries.findLast(e => e.kind === 'assistant')?.id : undefined
        return <section className="thread-turn" key={turn.id} aria-label={`Demande ${index + 1}`}>
          {turn.user && <Entry entry={turn.user} onEdit={onEdit} onFork={onFork} />}
          {activityBlocks(turn.entries).map(block => block[0]!.kind === 'tool' || block[0]!.kind === 'thinking'
            ? <ActivityGroup key={block[0]!.id} entries={block} onShowAgents={onShowAgents} />
            : <Entry key={block[0]!.id} entry={block[0]!} finalResponse={block[0]!.id === finalResponse} />)}
          {turn.user && <TurnSummary turn={turn} busy={active && busy} cancelling={active && cancelling} waiting={active && waiting} waitingLabel={waitingLabel}
            onPermission={onPermission} onEdit={onEdit} onReview={onReview} />}
        </section>
      })}
    </div>
    {!atBottom && <button type="button" className="thread-latest" onClick={bottom}>Revenir aux derniers messages ↓</button>}
  </div>
}

/**
 * Actions d'un message envoyé.
 *
 * Sous le message plutôt qu'à côté : la colonne de droite est étroite, et des
 * boutons flottants masqueraient le texte au moment précis où l'on cherche à
 * le relire. Ils n'apparaissent qu'au survol — trois icônes permanentes sur
 * chaque message rendraient la conversation bruyante.
 */
function MessageActions({
  text,
  onEdit,
  onFork,
}: {
  text: string
  onEdit?: (text: string) => void
  onFork?: (text: string) => void
}): React.ReactNode {
  const [copied, setCopied] = React.useState(false)
  const [copyError, setCopyError] = React.useState(false)

  const copy = React.useCallback(() => {
    setCopyError(false)
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      // La coche revient à l'icône d'origine : un état qui ne retombe pas
      // laisserait croire que le bouton a changé de fonction.
      window.setTimeout(() => setCopied(false), 1200)
    }).catch(() => setCopyError(true))
  }, [text])

  return (
    <div className="entry-actions">
      <button type="button" onClick={copy} title="Copier le message" aria-label="Copier le message">
        <Icon name={copied ? 'check' : 'copy'} size={13} />
      </button>
      {copyError && <span role="alert">Copie impossible.</span>}
      {onEdit && (
        <button
          type="button"
          onClick={() => onEdit(text)}
          title="Reprendre ce message dans la zone de saisie"
          aria-label="Modifier ce message"
        >
          <Icon name="edit" size={13} />
        </button>
      )}
      {onFork && (
        <button
          type="button"
          onClick={() => onFork(text)}
          title="Repartir d’ici dans une nouvelle conversation"
          aria-label="Forker la conversation ici"
        >
          <Icon name="branch" size={13} />
        </button>
      )}
    </div>
  )
}

function Entry({
  entry,
  finalResponse = false,
  onEdit,
  onFork,
}: {
  entry: ThreadEntry
  finalResponse?: boolean
  onEdit?: (text: string) => void
  onFork?: (text: string) => void
}): React.ReactNode {
  switch (entry.kind) {
    case 'user':
      return (
        <article className="entry user">
          <pre>
            <LinkedText text={entry.text} />
          </pre>
          <MessageActions text={entry.text} onEdit={onEdit} onFork={onFork} />
        </article>
      )

    case 'assistant':
      return (
        <article className={`entry assistant${finalResponse ? ' final-response' : ''}`}>
          {finalResponse && <span className="response-label">Réponse</span>}
          <Markdown text={entry.text} />
          {entry.streaming && <span className="four-square-loader" role="status" aria-label="Réponse en cours"><span /><span /><span /><span /></span>}
          {!entry.streaming && <MessageActions text={entry.text} />}
        </article>
      )

    case 'thinking':
      return (
        <details className="entry thinking">
          <summary>
            <Icon name="chevron-right" size={12} className="disclosure" />
            <span>Raisonnement</span>
          </summary>
          <pre>{entry.text}</pre>
        </details>
      )

    case 'tool':
      return (
        <div className="entry">
          <ToolCall entry={entry} />
        </div>
      )

    case 'notice':
      return (
        <article className={`entry notice ${entry.tone}`}>{entry.text}</article>
      )
  }
}
