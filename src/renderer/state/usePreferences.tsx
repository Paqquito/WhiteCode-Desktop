import * as React from 'react'
import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from '../../shared/preferences.js'

type PersonalSettings = { value: Preferences; ready: boolean; saving: boolean; error: string | null; notificationsSupported: boolean; platform: string; save: (value: Preferences) => Promise<void> }
const Context = React.createContext<PersonalSettings>({ value: DEFAULT_PREFERENCES, ready: false, saving: false, error: null, notificationsSupported: false, platform: 'win32', save: async () => {} })
export const usePreferences = () => React.useContext(Context)

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = React.useState(DEFAULT_PREFERENCES)
  const [ready, setReady] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notificationsSupported, setSupported] = React.useState(false)
  const [platform, setPlatform] = React.useState('win32')
  React.useEffect(() => {
    let alive = true
    if (!window.engine?.getPreferences) { setReady(true); return }
    void window.engine.getPreferences().then(result => {
      if (alive) { setValue(normalizePreferences(result.value)); setSupported(result.notificationsSupported); if (result.platform) setPlatform(result.platform); setError(result.error); setReady(true) }
    }).catch(error => { if (alive) { setError(String(error)); setReady(true) } })
    return () => { alive = false }
  }, [])
  React.useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const root = document.documentElement
      root.dataset.theme = value.theme === 'system' ? media.matches ? 'dark' : 'light' : value.theme
      root.dataset.reducedMotion = String(value.reducedMotion)
      root.style.setProperty('--sans', value.interfaceFont === 'sans' ? 'Arial, Helvetica, sans-serif' : '"Segoe UI", system-ui, sans-serif')
      root.style.setProperty('--mono', value.codeFont === 'mono' ? '"DejaVu Sans Mono", "Courier New", monospace' : 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace')
      root.style.setProperty('--reading-size', `${value.textSize}px`)
      root.style.setProperty('--code-size', `${value.codeSize}px`)
      root.lang = 'fr'
    }
    apply(); media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [value])
  const save = async (next: Preferences) => {
    setSaving(true); setError(null)
    try { setValue(normalizePreferences(await window.engine.savePreferences(next))) }
    catch (error) { setError(String(error)); throw error }
    finally { setSaving(false) }
  }
  return <Context.Provider value={{ value, ready, saving, error, notificationsSupported, platform, save }}>{children}</Context.Provider>
}
