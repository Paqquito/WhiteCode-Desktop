/**
 * Épingle, archive et titre choisi, sur disque.
 *
 * Même forme que `sessionOrigins.ts`, et pour les mêmes raisons : un fichier
 * par session, nommé par l'empreinte du couple dossier + identifiant, écrit
 * par fichier temporaire puis renommé. Le rename est atomique sur le même
 * volume — une coupure de courant laisse l'ancien état, jamais un demi-fichier.
 *
 * Le fichier est **supprimé** quand il ne reste rien à retenir. Sans cela,
 * renommer puis remettre le titre d'origine laisserait un fichier vide par
 * session, et le dossier grossirait au rythme des hésitations.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isEmptyMeta, type SessionMeta } from '../../shared/sessionMeta.js'

/** Au-delà, ce n'est plus un titre : c'est un message collé par mégarde. */
const TITLE_MAX = 120

export class SessionMetaStore {
  constructor(private readonly root: string) {}

  private file(cwd: string, sessionId: string): string {
    const path = resolve(cwd)
    const key = JSON.stringify([
      process.platform === 'win32' ? path.toLowerCase() : path,
      sessionId,
    ])
    return join(this.root, `${createHash('sha256').update(key).digest('hex')}.json`)
  }

  /**
   * Ce qui est retenu pour cette session, ou rien.
   *
   * Tout champ douteux est ignoré individuellement plutôt que de faire tomber
   * la lecture : une archive mal écrite ne doit pas faire disparaître le titre
   * choisi de la même session.
   */
  read(cwd: string, sessionId: string): SessionMeta | undefined {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(this.file(cwd, sessionId), 'utf8'))
    } catch {
      // Métadonnée absente ou abîmée : la conversation s'ouvre quand même.
      return undefined
    }
    if (!value || typeof value !== 'object') return undefined
    const raw = value as Record<string, unknown>
    const meta: SessionMeta = {}
    if (typeof raw.title === 'string' && raw.title.trim()) {
      meta.title = raw.title.trim().slice(0, TITLE_MAX)
    }
    if (raw.pinned === true) meta.pinned = true
    if (raw.archived === true) meta.archived = true
    if (raw.unread === true) meta.unread = true
    return isEmptyMeta(meta) ? undefined : meta
  }

  /**
   * Applique un changement partiel.
   *
   * Partiel et non total : épingler ne doit pas effacer un titre choisi, et
   * l'appelant n'a pas à relire l'état pour le réécrire en entier — deux
   * fenêtres le feraient à contretemps.
   */
  update(cwd: string, sessionId: string, patch: SessionMeta): SessionMeta | undefined {
    const next: SessionMeta = { ...this.read(cwd, sessionId) }
    if ('title' in patch) {
      const title = patch.title?.trim().slice(0, TITLE_MAX)
      // Un titre vide **rend** le titre déduit du transcript au lieu de poser
      // un nom vide : c'est la seule façon d'annuler un renommage.
      if (title) next.title = title
      else delete next.title
    }
    if ('pinned' in patch) {
      if (patch.pinned) next.pinned = true
      else delete next.pinned
    }
    if ('archived' in patch) {
      if (patch.archived) next.archived = true
      else delete next.archived
    }
    if ('unread' in patch) {
      if (patch.unread) next.unread = true
      else delete next.unread
    }

    const file = this.file(cwd, sessionId)
    if (isEmptyMeta(next)) {
      rmSync(file, { force: true })
      return undefined
    }
    mkdirSync(this.root, { recursive: true })
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 })
      renameSync(temporary, file)
    } finally {
      rmSync(temporary, { force: true })
    }
    return next
  }
}
