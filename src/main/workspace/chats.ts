import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'

/** Files created by a standalone chat live in the desktop profile. */
export class ChatWorkspaces {
  private readonly root: string

  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    if (!lstatSync(root).isDirectory()) throw Error('Le dossier des chats est invalide.')
    this.root = realpathSync(root)
  }

  create(): string {
    const cwd = join(this.root, randomUUID())
    mkdirSync(cwd, { mode: 0o700 })
    return cwd
  }

  owns(cwd: string): boolean {
    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(relative(this.root, cwd))
  }
}
