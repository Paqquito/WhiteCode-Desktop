/**
 * Panneaux ouverts.
 *
 * Un simple ensemble ordonné : les panneaux s'empilent dans la colonne de
 * droite dans l'ordre où on les ouvre, et se referment indépendamment. Le
 * garder ici plutôt que dans chaque panneau permet à la barre d'outils de
 * refléter l'état sans que les panneaux se connaissent entre eux.
 */

import { nativeId, nativeLabel, nativePanels } from '../nativeViews.js'
import * as React from 'react'
import { useSessionState } from './useSessionState.js'
import type { PluginPanelManifest } from '../../shared/pluginPanel.js'

export type BuiltinPanelId = 'plan' | 'agents' | 'files' | 'terminal' | 'changes' | 'browser'
export type PanelId = BuiltinPanelId | `module:${string}` | `plugin:${string}`

export const PANEL_LABELS: Record<BuiltinPanelId, string> = {
  plan: 'Plan',
  agents: 'Sous-tâches',
  files: 'Fichiers',
  terminal: 'Terminal',
  changes: 'Modifications',
  browser: 'Navigateur',
}

const EMPTY_PANELS: PanelId[] = []
const NO_PLUGINS: PluginPanelManifest[] = []
export function availablePanel(id: string, plugins: readonly PluginPanelManifest[]): id is PanelId {
  return Object.hasOwn(PANEL_LABELS, id) || nativePanels.some(entry => nativeId(entry.id) === id) || plugins.some(panel => id === `plugin:${panel.id}`)
}
export function panelLabel(id: PanelId, plugins: readonly PluginPanelManifest[] = NO_PLUGINS): string {
  if (id.startsWith('module:')) return nativeLabel(id) ?? 'Module indisponible'
  return id.startsWith('plugin:') ? plugins.find(panel => id === `plugin:${panel.id}`)?.title ?? 'Plugin indisponible' : PANEL_LABELS[id as BuiltinPanelId]
}
export function usePanels(sessionId: string | null = null, plugins: readonly PluginPanelManifest[] = NO_PLUGINS) {
  const [saved, setOpen] = useSessionState(sessionId, EMPTY_PANELS, 'panels')
  // Old sessions must not reopen the retired manual source explorers.
  const open = React.useMemo(() => saved.filter(id => availablePanel(id, plugins)), [saved, plugins])

  const toggle = React.useCallback((id: PanelId) => {
    setOpen(saved => {
      const current = saved.filter(id => availablePanel(id, plugins))
      return current.includes(id)
        ? current.filter(p => p !== id)
        : // Ajouté en fin de pile : le dernier ouvert apparaît en bas, à
          // l'endroit où le regard vient de cliquer.
          [...current, id]
    })
  }, [setOpen, plugins])

  const close = React.useCallback((id: PanelId) => {
    setOpen(current => current.filter(p => p !== id))
  }, [setOpen])

  const isOpen = React.useCallback(
    (id: PanelId) => open.includes(id),
    [open],
  )

  return { open, toggle, close, isOpen }
}
