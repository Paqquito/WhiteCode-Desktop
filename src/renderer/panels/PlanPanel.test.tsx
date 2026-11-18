import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PlanPanel } from './PlanPanel.js'

test('WhiteCode task lists and submitted plans remain visible in the desktop plan panel', () => {
  const html = renderToStaticMarkup(<PlanPanel onClose={() => {}} entries={[
    { kind: 'tool', id: 'tasks', name: 'update_todo_list', input: { items: [{ content: 'Lire les sources', status: 'completed' }, { content: 'Raccorder le moteur', progress_label: 'Raccordement en cours', status: 'in_progress' }] }, result: 'updated' },
    { kind: 'tool', id: 'plan', name: 'submit_plan', input: { plan_text: 'Vérifier le raccordement et les permissions.' }, result: 'Plan submitted' },
  ]} />)
  expect(html).toContain('Lire les sources')
  expect(html).toContain('Raccordement en cours')
  expect(html).toContain('Vérifier le raccordement et les permissions.')
})
