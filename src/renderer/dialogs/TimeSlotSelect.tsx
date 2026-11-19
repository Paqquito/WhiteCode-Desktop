import * as React from 'react'

export interface ChoiceOption {
  label: string
  description?: string
  preview?: string
  slot?: { day: string; hours: string; requested_day: boolean }
}

export type TimeSlotOption = ChoiceOption & { slot: NonNullable<ChoiceOption['slot']> }

export function TimeSlotSelect({ options, value, onSelect }: {
  options: TimeSlotOption[]; value?: string; onSelect: (label: string) => void
}): React.ReactNode {
  const id = React.useId()
  const days = new Map<string, TimeSlotOption[]>()
  for (const option of options) {
    const group = days.get(option.slot.day)
    if (group) group.push(option)
    else days.set(option.slot.day, [option])
  }
  const selected = options.find(option => option.label === value)
  const commonHint = options.every(option => option.description === options[0]?.description) ? options[0]?.description : undefined
  const hint = selected?.description || commonHint
  return <div className="choice-group choice-slots">
    <label htmlFor={id}>Choisir un autre créneau</label>
    <div className="slot-control">
      <select id={id} value={selected?.label ?? ''} onChange={event => onSelect(event.target.value)}
        aria-describedby={hint ? id + '-hint' : undefined}>
        <option value="" hidden disabled>Voir les horaires proposés</option>
        {Array.from(days, ([day, entries]) => <optgroup label={day} key={day}>
          {entries.map(option => <option key={option.label} value={option.label}
            aria-label={[day, option.slot.hours, option.description, option.preview].filter(Boolean).join(', ')}>
            {[option.slot.hours, !commonHint && option.description, option.preview].filter(Boolean).join(' · ')}
          </option>)}
        </optgroup>)}
      </select>
      <span className="slot-value" aria-hidden="true">
        {selected ? <><strong>{selected.slot.day}</strong> · {selected.slot.hours}</> : 'Voir les horaires proposés'}
      </span>
    </div>
    {hint && <p id={id + '-hint'} className="choice-hint">{hint}</p>}
    {selected?.preview && <pre className="slot-preview">{selected.preview}</pre>}
  </div>
}
