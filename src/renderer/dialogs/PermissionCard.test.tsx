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
  expect(html).toContain('<legend>Quelle branche ?</legend>')
  expect(html).toContain('type="radio"')
  expect(html).not.toContain('checked=""')
  expect(html).toContain('Autre réponse')
  expect(html).toContain('disabled=""')
})
