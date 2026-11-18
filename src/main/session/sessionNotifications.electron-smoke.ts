/**
 * T10 — test de fumée des notifications natives. Passage manuel.
 *
 *   bun build desktop/src/sessionNotifications.electron-smoke.ts --target=node \
 *     --external electron --outfile /tmp/notif.js
 *   npx electron /tmp/notif.js     # Linux : xvfb-run -a ./electron/electron --no-sandbox
 *
 * Ce qui s'automatise l'est déjà dans `sessionNotifications.test.ts` : la
 * déduplication, la confidentialité du corps, la fermeture à la consultation,
 * le repli quand la remise échoue. Ce qui reste ne peut pas l'être — qu'une
 * bannière du système apparaisse vraiment, qu'un clic physique dessus atteigne
 * l'application, et que la fenêtre revienne au premier plan. D'où ce passage
 * manuel, conçu pour tout couvrir en une fois.
 *
 * ## Ce qu'il faut observer
 *
 * 1. La fenêtre est **réduite** avant l'envoi : c'est l'état où le clic sert
 *    réellement à quelque chose.
 * 2. **Deux** notifications arrivent, pour deux conversations distinctes —
 *    l'équivalent de deux cellules côte à côte.
 * 3. Cliquer l'une d'elles doit restaurer la fenêtre **et** ouvrir la bonne
 *    conversation, pas l'autre.
 *
 * Chaque étape s'écrit sur la sortie standard en JSON, et la fenêtre affiche
 * le résultat une fois le clic reçu.
 */
import { app, BrowserWindow, Notification } from 'electron'
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionNotifications } from './sessionNotifications.js'
import { INITIAL_ATTENTION } from '../../shared/sessionAttention.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { initialThreadState } from '../../shared/thread.js'
import type { SessionSnapshot } from '../engine/engineManager.js'

app.setPath('userData', mkdtempSync(join(tmpdir(), 'sample-notification-smoke-')))
if (process.platform === 'win32') app.setAppUserModelId('test.whitecode.desktop')

const trace = (value: unknown) => console.log(JSON.stringify(value))
const page = (title: string, body: string) =>
  'data:text/html;charset=utf-8,' + encodeURIComponent(`<title>WhiteCode — test notifications</title><h1>${title}</h1><p>${body}</p>`)

const source = new EventEmitter()
let window: BrowserWindow
let notifications: SessionNotifications

function snapshot(id: string, phase: 'done' | 'waiting'): SessionSnapshot {
  return {
    id, cwd: tmpdir(), revision: 1, updatedAt: Date.now(),
    settings: DEFAULT_SESSION_SETTINGS, state: initialThreadState,
    attention: { ...INITIAL_ATTENTION, phase, unread: true, eventId: 1 },
  }
}

app.whenReady().then(() => {
  trace({ supported: Notification.isSupported(), platform: process.platform })
  window = new BrowserWindow({ width: 680, height: 320, show: true, webPreferences: { contextIsolation: true, nodeIntegration: false } })
  void window.loadURL(page('Test des notifications', 'Deux notifications vont arriver, fenêtre réduite. Cliquer celle de la session ALPHA doit rouvrir ALPHA.'))

  notifications = new SessionNotifications(source, options => {
    const notification = new Notification(options)
    notification.on('show', () => trace({ shown: options.body.split('\n')[1] }))
    notification.on('failed', (_event, error) => trace({ failed: error }))
    return notification
  }, id => {
    // Le même enchaînement que `openNotificationSession` dans `main.ts` : c'est
    // la restauration depuis l'état réduit qui est éprouvée ici.
    const wasMinimized = window.isMinimized()
    if (wasMinimized) window.restore()
    window.show()
    window.focus()
    trace({ clickedSession: id, wasMinimized, restored: !window.isMinimized(), focused: window.isFocused() })
    void window.loadURL(page(`Session ${id}`, `Clic natif reçu. Fenêtre réduite avant le clic : ${wasMinimized ? 'oui' : 'non'}. Restaurée : ${!window.isMinimized() ? 'oui' : 'non'}.`))
  }, () => trace({ unavailable: true }))

  // Réduire avant d'émettre : une bannière cliquée alors que la fenêtre est
  // déjà au premier plan ne prouverait rien de la restauration.
  setTimeout(() => {
    window.minimize()
    trace({ minimizedBeforeNotifying: window.isMinimized() })
    const alpha = snapshot('ALPHA-test', 'done')
    const beta = snapshot('BETA-test', 'waiting')
    source.emit('session', alpha)
    source.emit('session', beta)
    // Réémission à l'identique : elle ne doit produire aucune bannière de plus.
    source.emit('session', alpha)
    trace({ awaitingClick: true, seconds: 90 })
  }, 1500)

  setTimeout(() => { notifications.dispose(); app.quit() }, 90000)
})
app.on('window-all-closed', () => app.quit())
