import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PluginPanelBlocks } from './PluginPanelBlocks.js'
import type { PanelBlock } from '../../shared/pluginPanel.js'

test('nested plugin lists share a global render budget and service HTML stays escaped', () => {
  let block: PanelBlock = { kind: 'text', value: '{item}' }
  for (let index = 0; index < 3; index++) block = { kind: 'list', items: 'record.items', blocks: [block] }
  const html = renderToStaticMarkup(<PluginPanelBlocks blocks={[block]} context={{ record: { items: Array.from({ length: 20 }, () => '<script>alert(1)</script>') } }} onAction={() => {}} busy={false} />)
  expect((html.match(/<li>/g) ?? []).length).toBeLessThanOrEqual(1000)
  expect(html).toContain('Affichage limité')
  expect(html).not.toContain('<script>')
  expect(html).toContain('&lt;script&gt;')
})
