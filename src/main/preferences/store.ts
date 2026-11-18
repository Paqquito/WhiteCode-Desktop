import { readFileSync } from 'node:fs'
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from '../../shared/preferences.js'

export class PreferencesStore {
  private value: Preferences
  private queue: Promise<unknown> = Promise.resolve()
  loadError: string | null
  constructor(private readonly path: string) {
    try { this.value = normalizePreferences(JSON.parse(readFileSync(path, 'utf8'))); this.loadError = null }
    catch (error) {
      this.value = normalizePreferences(DEFAULT_PREFERENCES)
      this.loadError = (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : 'Préférences illisibles : les valeurs par défaut sont utilisées.'
    }
  }
  get(): Preferences { return structuredClone(this.value) }
  save(value: unknown): Promise<Preferences> {
    const next = normalizePreferences(value)
    const operation = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, this.path)
        this.value = next
        this.loadError = null
        return this.get()
      } finally { await unlink(temporary).catch(() => {}) }
    })
    this.queue = operation.catch(() => {})
    return operation
  }
}
