import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { SessionOrigin } from '../../shared/sessionOrigin.js'


/** Métadonnées desktop séparées des transcripts écrits par le moteur. */
export class SessionOrigins {
  constructor(private readonly root: string) {}

  private file(cwd: string, sessionId: string): string {
    const path = resolve(cwd)
    const key = JSON.stringify([process.platform === 'win32' ? path.toLowerCase() : path, sessionId])
    return join(this.root, `${createHash('sha256').update(key).digest('hex')}.json`)
  }

  read(cwd: string, sessionId: string): SessionOrigin | undefined {
    try {
      const value = JSON.parse(readFileSync(this.file(cwd, sessionId), 'utf8'))
      if (value?.kind === 'routine' && typeof value.routineId === 'string' && value.routineId
        && typeof value.cron === 'string' && value.cron && Number.isFinite(value.firedAt)
        && value.firedAt >= 0 && value.firedAt <= 8.64e15) return value
    } catch { /* Une métadonnée absente ou abîmée ne bloque pas la conversation. */ }
    return undefined
  }

  write(cwd: string, sessionId: string, origin: SessionOrigin): void {
    mkdirSync(this.root, { recursive: true })
    const file = this.file(cwd, sessionId)
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(origin), { mode: 0o600 })
      renameSync(temporary, file)
    } finally { rmSync(temporary, { force: true }) }
  }
}
