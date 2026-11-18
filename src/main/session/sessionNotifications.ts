import { DEFAULT_PREFERENCES, type Preferences } from '../../shared/preferences.js'
import type { EventEmitter } from 'node:events'
import type { SessionSnapshot } from '#desktop/conversation-manager'

type NativeNotice = EventEmitter & { show(): void; close(): void }
type NoticeOptions = { title: string; body: string; silent: boolean }

/** One toast per new attention event. Notification bodies never include conversation content. */
export class SessionNotifications {
  private delivered = new Map<string, number>()
  private visible = new Map<string, NativeNotice>()
  private receive = (session: SessionSnapshot) => {
    const { attention, id } = session
    const body = attention.phase === 'waiting' ? 'Une conversation attend votre autorisation.'
      : attention.phase === 'done' ? 'Une conversation a terminé son tour.'
      : attention.phase === 'failed' ? 'Une conversation a rencontré une erreur.' : null
    if (!body || !attention.unread) { this.close(id); return }
    if (this.delivered.get(id) === attention.eventId) return
    this.delivered.set(id, attention.eventId)
    this.close(id)
    const prefs = this.preferences()
    const allowed = attention.phase === 'done' ? prefs.done : attention.phase === 'waiting' ? prefs.waiting : prefs.failed
    if (!prefs.enabled || !allowed || (prefs.backgroundOnly && this.focused())) return
    try {
      const notice = this.create({ title: '', body: `${body}\nSession ${id.slice(0, 8)} — cliquer pour ouvrir.`, silent: !prefs.sound })
      this.visible.set(id, notice)
      notice.once('click', () => { if (this.visible.get(id) === notice) this.open(id) })
      notice.on('failed', () => { if (this.visible.get(id) === notice) { this.close(id); this.unavailable() } })
      notice.show()
    } catch { this.close(id); this.unavailable() }
  }

  constructor(private readonly source: EventEmitter,
    private readonly create: (options: NoticeOptions) => NativeNotice,
    private readonly open: (id: string) => void,
    private readonly unavailable: () => void,
    private readonly preferences: () => Preferences['notifications'] = () => DEFAULT_PREFERENCES.notifications,
    private readonly focused: () => boolean = () => false) {
    source.on('session', this.receive)
  }

  private close(id: string): void {
    const notice = this.visible.get(id)
    this.visible.delete(id)
    try { notice?.close() } catch { /* A dismissed OS notification may already be gone. */ }
  }

  dismissAll(): void { for (const id of this.visible.keys()) this.close(id) }

  dispose(): void {
    this.source.off('session', this.receive)
    for (const id of this.visible.keys()) this.close(id)
    this.delivered.clear()
  }
}
