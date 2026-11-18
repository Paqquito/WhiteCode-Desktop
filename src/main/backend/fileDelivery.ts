import { createHash } from 'node:crypto'

/** The desktop already presents workspace files; acknowledge only verified attachments. */
export class DesktopFileDelivery {
  private pending = new Map<string, { name: string; size: number; digest: string; offset: number; hash: ReturnType<typeof createHash>; timer: ReturnType<typeof setTimeout> }>()
  constructor(private readonly present: (name: string) => void) {}
  close(): void { for (const value of this.pending.values()) clearTimeout(value.timer); this.pending.clear() }
  receive(value: Record<string, any>): Record<string, unknown> {
    const id = value.id
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return { accepted: false }
    if (value.phase === 'start') {
      if (this.pending.size >= 2 || this.pending.has(id) || value.mode !== 'attach' || typeof value.name !== 'string' || !value.name || value.name.length > 255 || /[\\/\p{Cc}]/u.test(value.name) || !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 50 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(value.digest)) return { accepted: false }
      const timer = setTimeout(() => this.pending.delete(id), 30000); timer.unref()
      this.pending.set(id, { name: value.name, size: value.size, digest: value.digest, offset: 0, hash: createHash('sha256'), timer })
      return { accepted: true }
    }
    const pending = this.pending.get(id)
    if (!pending) return { accepted: false }
    if (value.phase === 'chunk') {
      if (value.offset !== pending.offset || typeof value.dataBase64 !== 'string' || value.dataBase64.length > 65536) return { accepted: false }
      const bytes = Buffer.from(value.dataBase64, 'base64')
      if (!bytes.length || bytes.toString('base64') !== value.dataBase64 || pending.offset + bytes.length > pending.size) return { accepted: false }
      pending.hash.update(bytes); pending.offset += bytes.length; pending.timer.refresh()
      return { accepted: true, nextOffset: pending.offset }
    }
    if (!['complete', 'cancel'].includes(value.phase)) return { accepted: false }
    clearTimeout(pending.timer); this.pending.delete(id)
    if (value.phase === 'cancel') return { accepted: true }
    if (pending.offset !== pending.size || pending.hash.digest('hex') !== pending.digest) return { delivered: false }
    this.present(pending.name)
    return { delivered: true, rendered: false }
  }
}
