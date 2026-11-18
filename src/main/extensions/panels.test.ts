import { expect, test } from 'bun:test'
import { parsePanel } from './panels.js'
import { bindPanelArgs, panelText } from '../../shared/pluginPanel.js'

const panel = { version: 1, id: 'tickets', connector: 'tickets', title: 'Tickets',
  views: [{ id: 'mine', label: 'Mes tickets', request: { tool: 'list', args: { mine: true } }, rows: { items: 'issues', id: 'id', title: '{item.title}', empty: 'Aucun ticket.' } }],
  detail: { request: { tool: 'get', args: { id: { $path: 'selection' } } }, title: '#{record.id} {record.title}', blocks: [] },
}

test('a declarative panel binds data without interpreting scripts or user text', () => {
  expect(parsePanel(panel).title).toBe('Tickets')
  const context = { selection: 12, record: { id: 12 }, form: { note: '{record.id} <script>alert(1)</script>', private: false } }
  expect(bindPanelArgs({ ids: [{ $path: 'record.id' }], changes: { note: { $path: 'form.note' }, private: { $path: 'form.private' } } }, context))
    .toEqual({ ids: [12], changes: { note: context.form.note, private: false } })
  expect(panelText('#{record.id} {record.title}', { record: { id: 12, title: 'Titre <b>brut</b>' } })).toBe('#12 Titre <b>brut</b>')
  expect(() => bindPanelArgs({ id: { $path: 'record.missing' } }, context)).toThrow()
})

test('a plugin panel refuses scripts, unsafe paths, excessive nesting and undeclared tools', () => {
  expect(() => parsePanel({ ...panel, javascript: 'alert(1)' })).toThrow()
  expect(() => parsePanel({ ...panel, detail: { ...panel.detail, request: { tool: 'get', args: { id: { $path: '__proto__.id' } } } } })).toThrow()
  expect(() => parsePanel({ ...panel, views: [] })).toThrow()
  expect(() => parsePanel(panel, { id: 'other', tools: { names: ['list', 'get'] } })).toThrow()
  expect(() => parsePanel(panel, { id: 'tickets', tools: { names: ['list'] } })).toThrow()
  let block: unknown = { kind: 'text', value: '{record.description}' }
  for (let i = 0; i < 12; i++) block = { kind: 'group', blocks: [block] }
  expect(() => parsePanel({ ...panel, detail: { ...panel.detail, blocks: [block] } })).toThrow()
})
