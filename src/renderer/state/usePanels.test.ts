import { expect, test } from 'bun:test'
import { availablePanel, panelLabel } from './usePanels.js'
import type { PluginPanelManifest } from '../../shared/pluginPanel.js'

test('plugin panels have their own namespace and disappear when their plugin is disabled', () => {
  const panels = [{ id: 'tickets', title: 'Tickets' }] as PluginPanelManifest[]
  expect(availablePanel('plugin:tickets', panels)).toBe(true)
  expect(availablePanel('plugin:tickets', [])).toBe(false)
  expect(availablePanel('tickets', panels)).toBe(false)
  expect(availablePanel('terminal', panels)).toBe(true)
  expect(panelLabel('plugin:tickets', panels)).toBe('Tickets')
  expect(panelLabel('files', panels)).toBe('Fichiers')
})
