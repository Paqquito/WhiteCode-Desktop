/** A permission belongs to its conversation; it never blocks the other panels. */
import * as React from 'react'
import type { PendingPermission } from '../../shared/protocol.js'
import { asFileChange, FileChangeView } from '../thread/Diff.js'

export function PermissionCard({ pending, onDecide, onInterrupt }: {
  pending: PendingPermission
  onDecide: (allow: boolean, input?: Record<string, unknown>) => void
  onInterrupt: () => void
}): React.ReactNode {
  const change = asFileChange(pending.toolName, pending.input)
  const name = pending.toolName.split('__').at(-1) ?? pending.toolName
  const label = ({ WebSearch: 'Recherche web', WebFetch: 'Lecture web', Bash: 'Terminal', PowerShell: 'Terminal', Write: 'Écriture de fichier', Edit: 'Modification de fichier', Read: 'Lecture de fichier', write_file: 'Écriture de fichier', edit_file: 'Modification de fichier', read_file: 'Lecture de fichier', run_shell: 'Terminal', run_powershell: 'Terminal', permission_escalation: 'Permissions' } as Record<string, string>)[name] ?? name
  const target = pending.input.command ?? pending.input.query ?? pending.input.file_path ?? pending.input.path ?? pending.input.url
  const summary = typeof target === 'string' ? target : pending.description ?? label
  const title = pending.title ?? `Autoriser : ${label.toLowerCase()} ?`
  const heading = React.useId()
  if (pending.toolName === 'request_user_choice') return <UserChoiceCard pending={pending} onDecide={onDecide} onInterrupt={onInterrupt} />

  return (
    <section className="permission-card" aria-labelledby={heading} onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onDecide(false) }
    }}>
      <span className="permission-kind">{label}</span>
      <p id={heading} className="permission-title" role="status">{title}</p>
      <code className="permission-summary" title={summary}>{summary.length > 240 ? `${summary.slice(0, 240)}…` : summary}</code>
      <details className="permission-details">
        <summary>Voir les détails</summary>
        <div className="permission-detail-body">
          {pending.description && <p>{pending.description}</p>}
          {pending.reason && <p>{pending.reason}</p>}
          <p className="permission-kind">{pending.toolName}</p>
          {change ? <FileChangeView change={change} /> : <pre>{JSON.stringify(pending.input, null, 2)}</pre>}
        </div>
      </details>
      <div className="permission-actions">
        <button type="button" className="permission-stop" onClick={onInterrupt}>Arrêter la réponse</button>
        <button type="button" onClick={() => onDecide(false)}>Refuser</button>
        <button type="button" className="primary" onClick={() => onDecide(true)}>Autoriser une fois</button>
      </div>
    </section>
  )
}

function UserChoiceCard({ pending, onDecide, onInterrupt }: { pending: PendingPermission; onDecide: (allow: boolean, input?: Record<string, unknown>) => void; onInterrupt: () => void }): React.ReactNode {
  const questions = (Array.isArray(pending.input.questions) ? pending.input.questions : []) as { question: string; options: { label: string; description?: string; preview?: string }[]; allow_multiple?: boolean }[]
  const [answers, setAnswers] = React.useState<Record<number, { labels?: string[]; other?: string }>>({})
  return <section className="permission-card" aria-label="Questions de l’assistant">
    {questions.map((question, index) => <fieldset key={index}>
      <legend>{question.question}</legend>
      {question.options.map(option => <label key={option.label} className="toggle">
        <input type={question.allow_multiple ? 'checkbox' : 'radio'} name={pending.requestId + '-' + index} checked={answers[index]?.labels?.includes(option.label) ?? false} onChange={event => setAnswers(previous => ({ ...previous, [index]: { labels: question.allow_multiple ? event.target.checked ? [...(previous[index]?.labels ?? []), option.label] : (previous[index]?.labels ?? []).filter(label => label !== option.label) : [option.label] } }))} />
        <span>{option.label}{option.description && <small className="field-hint">{option.description}</small>}{option.preview && <pre>{option.preview}</pre>}</span>
      </label>)}
      <label>Autre réponse<textarea value={answers[index]?.other ?? ''} onChange={event => setAnswers(previous => ({ ...previous, [index]: { other: event.target.value } }))} /></label>
    </fieldset>)}
    <div className="permission-actions"><button type="button" onClick={onInterrupt}>Arrêter la réponse</button><button type="button" onClick={() => onDecide(false)}>Passer</button><button type="button" className="primary" disabled={!questions.length || questions.some((_question, index) => !answers[index]?.labels?.length && !answers[index]?.other?.trim())} onClick={() => onDecide(true, { answers: questions.map((_question, index) => answers[index]) })}>Répondre</button></div>
  </section>
}
