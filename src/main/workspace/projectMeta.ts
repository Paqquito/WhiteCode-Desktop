/**
 * Nom choisi, épingle, dossiers sources et retrait, sur disque.
 *
 * Même forme que `session/sessionMeta.ts` : un fichier par projet, nommé par
 * l'empreinte du chemin, écrit par fichier temporaire puis renommé, et
 * supprimé quand il ne reste rien à retenir.
 *
 * La clé est le **chemin du dossier** et non un identifiant : c'est la seule
 * chose stable qu'un projet possède, et deux chemins qui ne diffèrent que par
 * la casse désignent le même dossier sous Windows.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isEmptyProjectMeta, type ProjectMeta } from '../../shared/projectMeta.js'

const NAME_MAX = 80
/** Au-delà, ce n'est plus une liste de sources, c'est une erreur de saisie. */
const SOURCES_MAX = 32

export class ProjectMetaStore {
  constructor(private readonly root: string) {}

  private file(cwd: string): string {
    const path = resolve(cwd)
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    return join(this.root, `${createHash('sha256').update(key).digest('hex')}.json`)
  }

  read(cwd: string): ProjectMeta | undefined {
    let value: unknown
    try {
      value = JSON.parse(readFileSync(this.file(cwd), 'utf8'))
    } catch {
      return undefined
    }
    if (!value || typeof value !== 'object') return undefined
    const raw = value as Record<string, unknown>
    const meta: ProjectMeta = {}
    if (typeof raw.name === 'string' && raw.name.trim()) {
      meta.name = raw.name.trim().slice(0, NAME_MAX)
    }
    if (typeof raw.instructions === 'string' && raw.instructions.trim()) meta.instructions = raw.instructions.trim().slice(0, 16000)
    if (raw.pinned === true) meta.pinned = true
    if (raw.removed === true) meta.removed = true
    if (Array.isArray(raw.sources)) {
      const sources = raw.sources
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .slice(0, SOURCES_MAX)
      if (sources.length) meta.sources = sources
    }
    return isEmptyProjectMeta(meta) ? undefined : meta
  }

  /** Retouche partielle : ce qui n'est pas dans `patch` n'est pas touché. */
  update(cwd: string, patch: ProjectMeta): ProjectMeta | undefined {
    const next: ProjectMeta = { ...this.read(cwd) }
    if ('name' in patch) {
      const name = patch.name?.trim().slice(0, NAME_MAX)
      // Un nom vide rend celui du dossier, au lieu d'en poser un vide.
      if (name) next.name = name
      else delete next.name
    }
    if ('instructions' in patch) {
      const instructions = patch.instructions?.trim().slice(0, 16000)
      if (instructions) next.instructions = instructions
      else delete next.instructions
    }
    if ('pinned' in patch) {
      if (patch.pinned) next.pinned = true
      else delete next.pinned
    }
    if ('removed' in patch) {
      if (patch.removed) next.removed = true
      else delete next.removed
    }
    if ('sources' in patch) {
      const sources = (patch.sources ?? [])
        .map(s => s.trim())
        .filter(Boolean)
        // Deux fois le même dossier ne l'ouvre pas deux fois au moteur.
        .filter((s, i, all) => all.indexOf(s) === i)
        .slice(0, SOURCES_MAX)
      if (sources.length) next.sources = sources
      else delete next.sources
    }

    const file = this.file(cwd)
    if (isEmptyProjectMeta(next)) {
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
