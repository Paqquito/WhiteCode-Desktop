import * as React from 'react'
import type { PendingPermission } from '#desktop/session-protocol'
import { Icon } from '../ui/Icon.js'
import { TimeSlotSelect, type ChoiceOption, type TimeSlotOption } from './TimeSlotSelect.js'

interface Question { header?: string; question: string; options: ChoiceOption[]; allow_multiple?: boolean }
interface Answer { labels: string[]; draft: string; writing: boolean }
const empty: Answer = { labels: [], draft: '', writing: false }

// Keep the original order and associate a shared description only with the options it describes.
function optionGroups(options: ChoiceOption[]) {
  const groups: [ChoiceOption, ...ChoiceOption[]][] = []
  for (const option of options) {
    const last = groups.at(-1)
    if (last && last[0].description === option.description) last.push(option)
    else groups.push([option])
  }
  return groups
}

function ChoiceField({ question, answer, onChange }: {
  question: Question; answer: Answer; onChange: (answer: Answer) => void
}): React.ReactNode {
  const id = React.useId()
  const field = React.useRef<HTMLTextAreaElement>(null)
  const useSlotList = !question.allow_multiple && question.options.some(option => option.slot?.requested_day === false)
  const inlineOptions = useSlotList ? question.options.filter(option => !option.slot) : question.options
  React.useEffect(() => { if (answer.writing) field.current?.focus() }, [answer.writing])
  function select(label: string, checked: boolean) {
    const labels = question.allow_multiple && !answer.writing ? answer.labels.filter(value => value !== label) : []
    if (checked) labels.push(label)
    onChange({ ...answer, writing: false, labels })
  }

  return <fieldset className="choice-field">
    <legend className="choice-legend">
      <span className="choice-heading"><span className="choice-icon"><Icon name="options" size={17} /></span>{question.header || question.question}</span>
      {question.header && <span className="choice-prompt">{question.question}</span>}
    </legend>
    {useSlotList && <TimeSlotSelect options={question.options.filter((option): option is TimeSlotOption => !!option.slot)}
      value={answer.writing ? undefined : answer.labels[0]} onSelect={label => select(label, true)} />}
    {optionGroups(inlineOptions).map((group, index) => {
      const description = group[0].description
      const hintId = description ? id + '-hint-' + index : undefined
      const shared = group.length > 1
      return <div className="choice-group" key={group[0].label}>
        <div className="choice-options">
          {group.map((option, j) => {
            const labelId = id + '-label-' + index + '-' + j
            return <label className="choice-option" key={option.label}>
              <input type={question.allow_multiple ? 'checkbox' : 'radio'} name={id}
                checked={!answer.writing && answer.labels.includes(option.label)}
                aria-labelledby={labelId} aria-describedby={[hintId, option.preview && labelId + '-preview'].filter(Boolean).join(' ') || undefined}
                onChange={event => select(option.label, event.target.checked)} />
              <span className="choice-content">
                <span id={labelId} className="choice-label">{option.label}</span>
                {!shared && description && <span id={hintId} className="choice-detail">{description}</span>}
                {option.preview && <pre id={labelId + '-preview'}>{option.preview}</pre>}
              </span>
            </label>
          })}
        </div>
        {shared && description && <p className="choice-hint" id={hintId}><Icon name="comment" size={14} />{description}</p>}
      </div>
    })}
    <button type="button" className="choice-write ghost" aria-expanded={answer.writing} aria-controls={id + '-other'}
      onClick={() => onChange({ ...answer, writing: !answer.writing })}>
      <Icon name="edit" size={14} />Autre réponse<Icon name={answer.writing ? 'chevron-down' : 'chevron-right'} size={12} />
    </button>
    <div id={id + '-other'} hidden={!answer.writing}>
      <textarea className="choice-text" ref={field} rows={2} aria-label="Autre réponse" placeholder="Écrivez votre réponse…"
        value={answer.draft} onChange={event => onChange({ ...answer, draft: event.target.value })} />
    </div>
  </fieldset>
}

export function UserChoiceCard({ pending, onDecide, onInterrupt }: {
  pending: PendingPermission
  onDecide: (allow: boolean, input?: Record<string, unknown>) => void
  onInterrupt: () => void
}): React.ReactNode {
  const questions = (Array.isArray(pending.input.questions) ? pending.input.questions : []) as Question[]
  const [answers, setAnswers] = React.useState<Record<number, Answer>>({})
  const ready = questions.length > 0 && questions.every((_, index) => {
    const answer = answers[index]
    return answer?.writing ? answer.draft.trim().length > 0 : !!answer?.labels.length
  })
  function submit() {
    if (ready) onDecide(true, { answers: questions.map((_, index) => {
      const answer = answers[index] ?? empty
      return answer.writing ? { other: answer.draft } : { labels: answer.labels }
    }) })
  }
  return <section className="permission-card choice-card" aria-label="Questions de l’assistant">
    <div className="choice-fields">{questions.map((question, index) =>
      <ChoiceField key={index} question={question} answer={answers[index] ?? empty}
        onChange={answer => setAnswers(previous => ({ ...previous, [index]: answer }))} />)}</div>
    <div className="permission-actions choice-actions">
      <button type="button" className="ghost permission-stop" onClick={onInterrupt}>Arrêter la réponse</button>
      <button type="button" className="ghost" onClick={() => onDecide(false)}>Passer</button>
      <button type="button" className="primary" disabled={!ready} onClick={submit}>Valider mon choix</button>
    </div>
  </section>
}
