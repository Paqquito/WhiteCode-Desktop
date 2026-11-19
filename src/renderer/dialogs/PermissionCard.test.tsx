import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermissionCard } from './PermissionCard.js'

test('permission is an inline card with readable context and collapsed technical details', () => {
  const html = renderToStaticMarkup(<PermissionCard pending={{ requestId: 'p1', toolUseId: 't1', toolName: 'mcp__websearch__WebSearch', input: { query: 'llama.cpp latest version', limit: 5 } }} onDecide={() => {}} onInterrupt={() => {}} />)
  expect(html).not.toContain('<dialog')
  expect(html).toContain('Recherche web')
  expect(html).toContain('llama.cpp latest version')
  expect(html).toContain('<details')
  expect(html).toContain('Autoriser une fois')
})

test('file changes remain reviewable without expanding the card by default', () => {
  const html = renderToStaticMarkup(<PermissionCard pending={{ requestId: 'p2', toolUseId: 't2', toolName: 'Write', input: { file_path: 'C:\\projet\\app.ts', content: '<script>unsafe</script>'.repeat(500) } }} onDecide={() => {}} onInterrupt={() => {}} />)
  expect(html).toContain('<details')
  expect(html).not.toContain('<details open')
  expect(html).not.toContain('<script>unsafe')
  expect(html).toContain('C:\\projet\\app.ts')
})

test('WhiteCode questions are selectable and do not submit a preselected answer', () => {
  const html = renderToStaticMarkup(<PermissionCard pending={{ requestId: 'choice', toolUseId: 'c1', toolName: 'request_user_choice', input: { questions: [{ question: 'Quelle branche ?', options: [{ label: 'Main', description: 'Branche principale' }, { label: 'Feature' }] }] } }} onDecide={() => {}} onInterrupt={() => {}} />)
  expect(html).toContain('<legend')
  expect(html).toContain('Quelle branche ?')
  expect(html).toContain('type="radio"')
  expect(html).not.toContain('checked=""')
  expect(html).toContain('Autre réponse')
  expect(html).toContain('disabled=""')
})

test('a shared hint describes only consecutive matching choices', () => {
  const options = [{ label: 'A', description: 'Même condition' }, { label: 'B', description: 'Même condition' }, { label: 'C', description: 'Autre condition' }]
  const html = renderToStaticMarkup(<PermissionCard pending={{ requestId: 'r', toolUseId: 't', toolName: 'request_user_choice',
    input: { questions: [{ header: 'Choix', question: 'Quelle option ?', options, allow_multiple: true }] } }} onDecide={() => {}} onInterrupt={() => {}} />)
  expect(html.split('Même condition')).toHaveLength(2)
  const hints = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map(match => match[1])
  expect(hints).toHaveLength(3)
  expect(hints[0]).toBe(hints[1])
  expect(hints[1]).not.toBe(hints[2])
  expect(html).toContain('type="checkbox"')
  expect(html).toContain('aria-expanded="false"')
})

test('single-choice meeting slots always use one date-grouped selector', () => {
  const slot = (label: string, day: string, requested_day: boolean) => ({
    label, description: 'Disponibilité publiée', slot: { day, hours: '09:00 – 10:00', requested_day },
  })
  const monday = slot('Lundi à neuf heures', 'lundi 23 novembre', true)
  const tuesday = slot('Mardi à neuf heures', 'mardi 24 novembre', false)
  const keep = { label: 'Conserver le créneau demandé' }
  function render(options: (typeof monday | typeof keep)[], allow_multiple = false) {
    return renderToStaticMarkup(<PermissionCard pending={{ requestId: 'r', toolUseId: 't', toolName: 'request_user_choice',
      input: { questions: [{ question: 'Quel horaire ?', options, allow_multiple }] } }} onDecide={() => {}} onInterrupt={() => {}} />)
  }
  const sameDay = render([monday, { ...monday, label: 'Lundi à dix heures', slot: { ...monday.slot, hours: '10:00 – 11:00' } }, keep])
  expect(sameDay.match(/<select\b/g)).toHaveLength(1)
  expect(sameDay.match(/<optgroup\b/g)).toHaveLength(1)
  expect(sameDay).toContain('value="Lundi à neuf heures"')
  expect(sameDay).toContain('value="Lundi à dix heures"')
  expect(sameDay.match(/type="radio"/g)).toHaveLength(1)
  expect(render([monday, keep])).toContain('<select')
  expect(render([keep])).not.toContain('<select')
  expect(render([tuesday, keep], true)).not.toContain('<select')
  expect(render([tuesday, keep])).toContain('<optgroup label="mardi 24 novembre"')
  const mixed = render([monday, tuesday, keep])
  expect(mixed).toContain('<optgroup label="lundi 23 novembre"')
  expect(mixed).toContain('value="Mardi à neuf heures"')
  expect(mixed.match(/type="radio"/g)).toHaveLength(1)
  expect(mixed.indexOf('Conserver le créneau demandé')).toBeGreaterThan(mixed.indexOf('</select>'))
})
