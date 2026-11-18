import * as React from 'react'
import type { FileContent } from '../../main/preload.js'
import { useSessionState } from '../state/useSessionState.js'
import { ask } from '../ui/confirm.js'

export type FileTab = { path: string; token: string; content: FileContent | null; draft: string | null; saving: boolean; error: string | null; saved: boolean }
const EMPTY: FileTab[] = []
export const isDirty = (tab: FileTab) => tab.draft !== null && tab.content?.ok === true && tab.draft !== tab.content.text

/** Each async operation owns a document incarnation, even after switching sessions. */
export function useFileTabs(sessionId: string | null, root: string) {
  const [tabs, setTabs] = useSessionState(sessionId, EMPTY, `files:${root}`)
  const [selected, setSelected] = useSessionState<string | null>(sessionId, null, `file-active:${root}`)
  const patch = (tab: FileTab, update: (current: FileTab) => FileTab) => setTabs(all => all.map(current => current.token === tab.token ? update(current) : current))
  const read = async (tab: FileTab) => {
    try {
      const content = await window.engine.readFile(root, tab.path)
      patch(tab, current => ({ ...current, content }))
    } catch (error) {
      patch(tab, current => ({ ...current, content: { ok: false, path: tab.path, reason: 'unreadable' }, error: String(error) }))
    }
  }
  const openFile = async (path: string) => {
    setSelected(path)
    if (tabs.some(tab => tab.path === path)) return
    const tab: FileTab = { path, token: crypto.randomUUID(), content: null, draft: null, saving: false, error: null, saved: false }
    setTabs(all => [...all.filter(item => item.path !== path), tab])
    await read(tab)
  }
  const active = tabs.find(tab => tab.path === selected)
  const save = async () => {
    if (!active || !isDirty(active) || active.saving || !active.content?.ok) return
    const text = active.draft!
    patch(active, tab => ({ ...tab, saving: true, error: null, saved: false }))
    try {
      const result = await window.engine.writeFile(root, active.path, text, active.content.text)
      patch(active, tab => result.ok ? { ...tab, saving: false, saved: true, content: { ok: true, path: tab.path, text, truncated: false }, draft: tab.draft === text ? null : tab.draft } : { ...tab, saving: false, error: result.reason ?? 'Écriture refusée.' })
    } catch (error) {
      patch(active, tab => ({ ...tab, saving: false, error: String(error) }))
    }
  }
  const reload = async () => {
    if (!active || active.saving) return
    if (isDirty(active) && !await ask({ title: 'Recharger le fichier ?', message: 'Vos modifications non enregistrées seront perdues.', confirmLabel: 'Recharger sans enregistrer', danger: true })) return
    const replacement = { ...active, token: crypto.randomUUID(), content: null, draft: null, error: null, saved: false }
    patch(active, () => replacement)
    await read(replacement)
  }
  const close = async (tab: FileTab) => {
    if (tab.saving || (isDirty(tab) && !await ask({ title: `Fermer ${tab.path.split(/[\\/]/).pop()} sans enregistrer ?`, message: 'Ses modifications non enregistrées seront perdues.', confirmLabel: 'Fermer sans enregistrer', danger: true }))) return
    setTabs(all => all.filter(item => item.token !== tab.token))
    if (selected === tab.path) setSelected(tabs.find(item => item.token !== tab.token)?.path ?? null)
  }
  return { tabs, selected, active, openFile, save, reload, close, setDraft: (draft: string) => { if (active) patch(active, tab => ({ ...tab, draft, saved: false })) } }
}
