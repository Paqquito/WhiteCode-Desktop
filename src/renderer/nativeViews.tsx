import * as React from 'react'
import { nativeEntries } from './nativeEntries.js'

export const nativePanels = nativeEntries.filter(entry => entry.views.Panel)
export const nativeSettings = nativeEntries.filter(entry => entry.views.Settings)
export const nativeId = (id: string) => `module:${id}` as const
export function nativeLabel(key: string): string | undefined {
  return nativeEntries.find(entry => nativeId(entry.id) === key)?.views.label
}
export function NativeSettings({ id }: { id: string }) {
  const Settings = nativeSettings.find(entry => entry.id === id)?.views.Settings
  return Settings ? <Settings call={(method, input) => window.engine.invokeModule(id, method, input)} /> : null
}
export function NativePanel({ id, ...props }: Omit<import('../../packages/desktop-modules/index.js').ModulePanelProps, 'call'> & { id: string }) {
  const Panel = nativePanels.find(entry => entry.id === id)?.views.Panel
  return Panel ? <Panel {...props} call={(method, input) => window.engine.invokeModule(id, method, input)} /> : null
}
