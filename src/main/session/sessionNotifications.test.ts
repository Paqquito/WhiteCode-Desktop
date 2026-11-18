import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { SessionNotifications } from './sessionNotifications.js'
import { INITIAL_ATTENTION } from '../../shared/sessionAttention.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { initialThreadState } from '../../shared/thread.js'
import type { SessionSnapshot } from '../engine/engineManager.js'

class Toast extends EventEmitter {
  shown = 0; closed = 0
  show() { this.shown++ }
  close() { this.closed++ }
}
const snapshot = (id: string, eventId = 1): SessionSnapshot => ({ id, cwd: '/project', revision: 1, updatedAt: 1,
  settings: DEFAULT_SESSION_SETTINGS, state: initialThreadState,
  attention: { ...INITIAL_ATTENTION, phase: 'done', eventId, unread: true } })

test('background notifications are deduplicated, private, clickable and closed on consultation', () => {
  const source = new EventEmitter(), toasts: Toast[] = [], opened: string[] = [], bodies: string[] = []
  const notifications = new SessionNotifications(source, options => {
    bodies.push(options.body); const toast = new Toast(); toasts.push(toast); return toast
  }, id => opened.push(id), () => {})
  try {
    source.emit('session', snapshot('a'))
    source.emit('session', snapshot('a'))
    const b = snapshot('b'); b.state = { ...initialThreadState, entries: [{ id: 'secret', kind: 'user', text: 'secret token in conversation title' }] }
    source.emit('session', b)
    expect(toasts).toHaveLength(2)
    expect(bodies.join(' ')).not.toContain('secret')
    toasts[1]!.emit('click')
    expect(opened).toEqual(['b'])
    source.emit('session', { ...b, attention: { ...b.attention, unread: false } })
    expect(toasts[1]!.closed).toBe(1)
    toasts[1]!.emit('click')
    expect(opened).toHaveLength(1)
    source.emit('session', snapshot('a', 2))
    expect(toasts[0]!.closed).toBe(1)
    expect(toasts).toHaveLength(3)
  } finally { notifications.dispose() }
  expect(source.listenerCount('session')).toBe(0)
})

test('viewed results, running turns and explicit interruption do not notify; delivery failures do not retry in a loop', () => {
  const source = new EventEmitter(); let attempts = 0, failures = 0
  const notifications = new SessionNotifications(source, () => { attempts++; throw new Error('OS unavailable') }, () => {}, () => { failures++ })
  try {
    for (const phase of ['working', 'idle', 'interrupted'] as const) {
      const s = snapshot(phase); source.emit('session', { ...s, attention: { ...s.attention, phase } })
    }
    const viewed = snapshot('viewed'); source.emit('session', { ...viewed, attention: { ...viewed.attention, unread: false } })
    expect(attempts).toBe(0)
    source.emit('session', snapshot('failed'))
    source.emit('session', snapshot('failed'))
    expect(attempts).toBe(1)
    expect(failures).toBe(1)
  } finally { notifications.dispose() }
})

test('permission resolves before a coalesced snapshot without a stale toast; old failure cannot close a newer notification', () => {
  const source = new EventEmitter(), toasts: Toast[] = []
  let failures = 0
  const notifications = new SessionNotifications(source, () => { const toast = new Toast(); toasts.push(toast); return toast }, () => {}, () => failures++)
  try {
    const a = snapshot('a')
    source.emit('session', { ...a, attention: { ...a.attention, phase: 'waiting' } })
    source.emit('session', { ...a, attention: { ...a.attention, phase: 'working', unread: false } })
    expect(toasts[0]!.closed).toBe(1)
    source.emit('session', { ...a, attention: { ...a.attention, phase: 'failed', eventId: 2 } })
    toasts[0]!.emit('failed')
    expect(toasts[1]!.closed).toBe(0)
    expect(failures).toBe(0)
    toasts[1]!.emit('failed')
    expect(failures).toBe(1)
    source.emit('session', { ...a, attention: { ...a.attention, phase: 'failed', eventId: 2 } })
    expect(toasts).toHaveLength(2)
  } finally { notifications.dispose() }
})

test('personal preferences filter event types, focus and sound without replaying suppressed notices', () => {
  const source = new EventEmitter(), options: Array<{ title: string; body: string; silent: boolean }> = []
  let focused = true
  let prefs = { enabled: true, backgroundOnly: true, done: true, waiting: false, failed: true, sound: true }
  const notifications = new SessionNotifications(source, option => { options.push(option); return new Toast() }, () => {}, () => {}, () => prefs, () => focused)
  try {
    source.emit('session', snapshot('foreground'))
    expect(options).toHaveLength(0)
    focused = false
    source.emit('session', snapshot('foreground'))
    expect(options).toHaveLength(0)
    source.emit('session', snapshot('background'))
    expect(options).toEqual([{ title: '', body: 'Une conversation a terminé son tour.\nSession backgrou — cliquer pour ouvrir.', silent: false }])
    const waiting = snapshot('waiting'); source.emit('session', { ...waiting, attention: { ...waiting.attention, phase: 'waiting' } })
    expect(options).toHaveLength(1)
    prefs = { ...prefs, enabled: false }
    source.emit('session', snapshot('muted'))
    expect(options).toHaveLength(1)
    prefs = { ...prefs, enabled: true, backgroundOnly: false, sound: false }; focused = true
    source.emit('session', snapshot('all-windows'))
    expect(options.at(-1)?.silent).toBe(true)
  } finally { notifications.dispose() }
})
