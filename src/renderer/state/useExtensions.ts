import * as React from 'react'
import type { ExtensionProgress, ExtensionState, ExtensionSource } from '../../main/preload.js'

export function useExtensions() {
  const [sources, setSources] = React.useState<ExtensionSource[]>([])
  const [extensions, setExtensions] = React.useState<ExtensionState[]>([])
  const [activity, setActivity] = React.useState<Record<string, ExtensionProgress>>({})
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const lock = React.useRef(false)
  const refresh = React.useCallback(async () => {
    setLoading(true)
    // `displayName` vient du catalogue (« Bureautique ») ; `name` reste
    // l'identifiant technique côté processus principal. Le rendu n'affiche
    // que le premier et n'agit que par `id`.
    try { const [entries, sources] = await Promise.all([window.engine.listExtensions(), window.engine.listExtensionSources()]); setExtensions(entries.map(entry => ({ ...entry, name: entry.displayName ?? entry.name }))); setSources(sources); setError(null) }
    catch (error) { setError(String(error)) }
    finally { setLoading(false) }
  }, [])
  React.useEffect(() => { void refresh() }, [refresh])
  React.useEffect(() => window.engine.onExtensionProgress(progress => {
    setActivity(current => ({ ...current, [progress.id]: progress }))
    // Le catalogue officiel s'ajoute en arrière-plan au lancement : la liste
    // se relit quand il progresse, pour montrer la Bureautique réinstallée.
    if (progress.id === 'catalogue') void refresh()
  }), [refresh])
  const action = async (id: string, run: () => Promise<unknown>) => {
    if (lock.current) return false
    lock.current = true; setBusy(id); setError(null)
    try {
      const result = await run()
      await refresh()
      if (result === false) setError('L’opération a échoué. Consultez le détail sous l’extension, puis réessayez.')
      return result !== false
    } catch (error) { setError(String(error)); return false }
    finally { lock.current = false; setBusy(null) }
  }
  const panels = extensions.flatMap(entry => entry.installed && entry.enabled && !entry.problem && entry.panel ? [entry.panel] : [])
  return { sources, extensions, panels, activity, busy, error, loading, refresh,
    install: (id: string, ref?: string) => action(id, () => window.engine.installExtension(id, ref)),
    update: (id: string, ref?: string) => action(id, () => window.engine.updateExtension(id, ref)),
    addSource: (repository: string, ref: string) => action('sources', () => window.engine.addExtensionSource(repository, ref)),
    refreshSource: (id: string, ref: string) => action(id, () => window.engine.refreshExtensionSource(id, ref)),
    removeSource: (id: string) => action(id, () => window.engine.removeExtensionSource(id)),
    diagnose: (id: string) => action(id, async () => { const message = await window.engine.diagnoseExtension(id); setActivity(current => ({ ...current, [id]: { id, message, failed: false } })) }),
    remove: (id: string) => action(id, async () => { await window.engine.removeExtension(id); setActivity(current => { const next = { ...current }; delete next[id]; return next }) }),
    setEnabled: (id: string, enabled: boolean) => action(id, () => window.engine.enableExtension(id, enabled)),
  }
}
