import { test, expect } from 'bun:test'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PreferencesStore } from './store.js'
import { DEFAULT_PREFERENCES, normalizePreferences, sendsMessage } from '../../shared/preferences.js'

test('L11 activity is opt-in, validated and survives restart without retired settings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l11-preferences-'))
  try {
    const path = join(dir, 'preferences.json')
    const store = new PreferencesStore(path)
    expect(store.get().modules).toEqual({ activity: false })
    // Older preference files may still carry removed module keys.
    await writeFile(path, JSON.stringify({ ...store.get(), modules: { activity: true, mascot: true } }))
    const migrated = new PreferencesStore(path)
    expect(migrated.get().modules).toEqual({ activity: true })
    await migrated.save(migrated.get())
    expect(JSON.parse(await readFile(path, 'utf8')).modules).toEqual({ activity: true })
    expect(normalizePreferences({ modules: { activity: 'true', publishing: true } }).modules)
      .toEqual({ activity: false })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('preferences survive restart, serialize saves and recover from malformed input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l07-preferences-')), file = join(dir, 'preferences.json')
  try {
    const store = new PreferencesStore(file)
    expect(store.get()).toEqual(DEFAULT_PREFERENCES)
    await Promise.all([store.save({ ...DEFAULT_PREFERENCES, theme: 'dark' }), store.save({ ...DEFAULT_PREFERENCES, codeSize: 16, notifications: { enabled: false } })])
    expect(new PreferencesStore(file).get()).toEqual(store.get())
    expect(store.get().codeSize).toBe(16)
    expect(store.get().notifications.enabled).toBe(false)
    const clone = store.get(); clone.notifications.enabled = true
    expect(store.get().notifications.enabled).toBe(false)
    await writeFile(file, 'invalid')
    expect(new PreferencesStore(file).loadError).not.toBeNull()
    expect(new PreferencesStore(file).get()).toEqual(DEFAULT_PREFERENCES)
    expect(normalizePreferences({ theme: 'unknown', codeSize: 999, shortcuts: 'false' })).toEqual(DEFAULT_PREFERENCES)
    expect(await readFile(file, 'utf8')).toBe('invalid')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('write failure does not acknowledge preferences that were never saved', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l07-failure-'))
  try {
    await writeFile(join(dir, 'file'), 'keep')
    const store = new PreferencesStore(join(dir, 'file', 'preferences.json'))
    await expect(store.save({ theme: 'dark' })).rejects.toThrow()
    expect(store.get()).toEqual(DEFAULT_PREFERENCES)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('send shortcut respects selection, multiline input and IME composition', () => {
  const enter = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false }
  expect(sendsMessage(enter, 'enter')).toBe(true)
  expect(sendsMessage(enter, 'mod-enter')).toBe(false)
  expect(sendsMessage({ ...enter, metaKey: true }, 'mod-enter')).toBe(true)
  expect(sendsMessage({ ...enter, shiftKey: true }, 'enter')).toBe(false)
  expect(sendsMessage({ ...enter, isComposing: true }, 'enter')).toBe(false)
})

test('general preferences fall back to safe defaults and never default to bypassing permissions', () => {
  const normalized = normalizePreferences({ newSessionMode: 'bypassPermissions', terminalShell: 'zsh', confirmClose: 'sometimes', launchAtLogin: 'yes', contextGauge: 0 })
  expect(normalized.newSessionMode).toBe('inherit')
  expect(normalized.terminalShell).toBe('system')
  expect(normalized.confirmClose).toBe('busy')
  expect(normalized.launchAtLogin).toBe(false)
  expect(normalized.contextGauge).toBe(true)
  expect(normalizePreferences({ newSessionMode: 'plan', terminalShell: 'pwsh', confirmClose: 'always' })).toMatchObject({ newSessionMode: 'plan', terminalShell: 'pwsh', confirmClose: 'always' })
})
