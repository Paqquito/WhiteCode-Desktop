/** Personal desktop settings, independent of model/session permissions. */
export type Preferences = {
  theme: 'system' | 'light' | 'dark'
  interfaceFont: 'system' | 'sans'
  codeFont: 'system' | 'mono'
  textSize: 13 | 15 | 17
  codeSize: 12 | 14 | 16
  reducedMotion: boolean
  sendMode: 'enter' | 'mod-enter'
  /** Mode de permission d'une nouvelle conversation ; `inherit` reprend celui de la conversation affichée. */
  newSessionMode: 'inherit' | 'default' | 'acceptEdits' | 'plan' | 'dontAsk'
  contextGauge: boolean
  /** Shell des nouveaux terminaux locaux ; `system` suit COMSPEC ou SHELL. */
  terminalShell: 'system' | 'powershell' | 'pwsh' | 'cmd' | 'bash'
  launchAtLogin: boolean
  confirmClose: 'never' | 'busy' | 'always'
  shortcuts: boolean
  modules: { activity: boolean }
  notifications: { enabled: boolean; backgroundOnly: boolean; done: boolean; waiting: boolean; failed: boolean; sound: boolean }
}
export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system', interfaceFont: 'system', codeFont: 'system', textSize: 15, codeSize: 12,
  reducedMotion: false, sendMode: 'enter', shortcuts: true,
  newSessionMode: 'inherit', contextGauge: true, terminalShell: 'system', launchAtLogin: false, confirmClose: 'busy',
  modules: { activity: false },
  notifications: { enabled: true, backgroundOnly: true, done: true, waiting: true, failed: true, sound: false },
}
export function normalizePreferences(value: unknown): Preferences {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const n = raw.notifications && typeof raw.notifications === 'object' ? raw.notifications as Record<string, unknown> : {}
  const modules = raw.modules && typeof raw.modules === 'object' ? raw.modules as Record<string, unknown> : {}
  const pick = <T>(candidate: unknown, choices: readonly T[], fallback: T): T => choices.includes(candidate as T) ? candidate as T : fallback
  const bool = (candidate: unknown, fallback: boolean) => typeof candidate === 'boolean' ? candidate : fallback
  return {
    theme: pick(raw.theme, ['system','light','dark'], DEFAULT_PREFERENCES.theme),
    interfaceFont: pick(raw.interfaceFont, ['system','sans'], 'system'), codeFont: pick(raw.codeFont, ['system','mono'], 'system'),
    textSize: pick(raw.textSize, [13,15,17], 15), codeSize: pick(raw.codeSize, [12,14,16], 12),
    reducedMotion: bool(raw.reducedMotion, false), sendMode: pick(raw.sendMode, ['enter','mod-enter'], 'enter'), shortcuts: bool(raw.shortcuts, true),
    newSessionMode: pick(raw.newSessionMode, ['inherit','default','acceptEdits','plan','dontAsk'], 'inherit'), contextGauge: bool(raw.contextGauge, true),
    terminalShell: pick(raw.terminalShell, ['system','powershell','pwsh','cmd','bash'], 'system'), launchAtLogin: bool(raw.launchAtLogin, false),
    confirmClose: pick(raw.confirmClose, ['never','busy','always'], 'busy'),
    modules: { activity: bool(modules.activity, false) },
    notifications: { enabled: bool(n.enabled, true), backgroundOnly: bool(n.backgroundOnly, true), done: bool(n.done, true), waiting: bool(n.waiting, true), failed: bool(n.failed, true), sound: bool(n.sound, false) },
  }
}
export function sendsMessage(event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey?: boolean; isComposing?: boolean }, mode: Preferences['sendMode']) {
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing && (mode === 'enter' || event.ctrlKey || event.metaKey)
}
