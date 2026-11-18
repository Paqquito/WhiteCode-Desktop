import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { ProviderConfig } from './index.js'

/** Electron safeStorage is injected so storage can also be tested without Electron. */
export type SecretVault = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}

export class ProviderStorage<T extends object = ProviderConfig> {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly file: string

  constructor(private readonly root: string, private readonly vault?: SecretVault,
    private readonly options: { fileName: string; hasSecrets: (value: T) => boolean; requireEncryption?: boolean } = { fileName: 'provider.json', hasSecrets: value => hasCredentials(value as ProviderConfig) }) {
    this.file = join(root, options.fileName)
  }

  private requireVault(): SecretVault {
    if (!this.vault?.isEncryptionAvailable() || this.vault.getSelectedStorageBackend?.() === 'basic_text') {
      throw new Error('Le coffre système est indisponible. Déverrouillez-le pour enregistrer ou migrer vos identifiants. Aucun secret ne sera écrit en clair.')
    }
    return this.vault
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => {})
    return result
  }

  read(): Promise<T | null> {
    return this.serial(() => this.readStored())
  }

  private async readStored(): Promise<T | null> {
    let raw: string
    try { raw = await readFile(this.file, 'utf8') }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('Impossible de lire les réglages du fournisseur. Le fichier a été conservé.')
    }
    let stored: Record<string, unknown>
    try {
      stored = JSON.parse(raw.replace(/^\uFEFF/, ''))
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error()
    } catch { throw new Error('Réglages du fournisseur invalides. Le fichier a été conservé.') }
    if ('version' in stored || 'encrypted' in stored) {
      if (stored.version !== 1 || typeof stored.encrypted !== 'string') {
        throw new Error('Format des identifiants inconnu. Le fichier a été conservé.')
      }
      const vault = this.requireVault()
      try {
        const config = JSON.parse(vault.decryptString(Buffer.from(stored.encrypted, 'base64')))
        if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error()
        return config as T
      } catch { throw new Error('Impossible de déchiffrer les identifiants avec ce compte système. Le fichier a été conservé.') }
    }
    if (this.options.requireEncryption) throw new Error('Session non chiffrée refusée. Le fichier a été conservé.')
    const config = stored as T
    if (this.options.hasSecrets(config)) await this.writeFile(config)
    return config
  }

  write(config: T): Promise<void> {
    const snapshot = structuredClone(config)
    return this.serial(async () => {
      // A failed load must not let a later UI edit overwrite unreadable secrets.
      await this.readStored()
      await this.writeFile(snapshot)
    })
  }

  private async writeFile(config: T): Promise<void> {
    let contents = JSON.stringify(config, null, 2)
    if (this.options.hasSecrets(config)) {
      const vault = this.requireVault()
      try { contents = JSON.stringify({ version: 1, encrypted: vault.encryptString(contents).toString('base64') }) }
      catch { throw new Error('Le coffre système ne peut pas chiffrer les identifiants. Les anciens réglages sont conservés.') }
    }
    await mkdir(this.root, { recursive: true })
    const temporary = join(this.root, `.provider-${randomUUID()}.tmp`)
    try {
      const handle = await open(temporary, 'wx', 0o600)
      try { await handle.writeFile(contents, 'utf8'); await handle.sync() }
      finally { await handle.close() }
      // Same-directory replacement: no plaintext backup, old file intact on failure.
      await rename(temporary, this.file)
    } catch {
      throw new Error('Impossible d’enregistrer les réglages du fournisseur. Les anciens réglages sont conservés.')
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }
}

function hasCredentials(config: ProviderConfig): boolean {
  return Boolean(config.token || config.openaiApiKey)
}
