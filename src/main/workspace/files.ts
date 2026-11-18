/**
 * Exploration du répertoire de travail.
 *
 * Lecture d'un niveau à la fois, jamais récursive : un dossier de projet
 * contient `node_modules`, et le parcourir entièrement bloquerait
 * l'application plusieurs secondes pour un contenu que personne ne déplie.
 * L'arborescence se construit donc à mesure que l'utilisateur ouvre.
 */

import { readdir, readFile, stat, writeFile, realpath, rename, unlink, chmod } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join, relative, resolve, sep, isAbsolute } from 'node:path'

export type DirEntry = {
  name: string
  path: string
  kind: 'dir' | 'file'
  /** Taille en octets ; absente pour un dossier. */
  bytes?: number
}

/**
 * Dossiers écartés d'office.
 *
 * Ni cachés ni interdits : simplement sans intérêt de lecture, et si
 * volumineux qu'ils noieraient le reste. L'utilisateur peut toujours ouvrir
 * un fichier par son chemin.
 */
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  '__pycache__',
])

/**
 * Vérifie qu'un chemin reste sous la racine.
 *
 * Le rendu envoie le chemin à ouvrir ; sans cette borne, un chemin forgé
 * (`../../..`) lirait n'importe où sur le disque. Le processus principal ne
 * fait jamais confiance à ce qui vient du rendu.
 */
function within(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep) && !isAbsolute(rel))
}

/** Contenu d'un dossier : sous-dossiers d'abord, puis fichiers, par nom. */
export async function readDirectory(
  root: string,
  target?: string,
): Promise<DirEntry[]> {
  const dir = target ?? root
  if (!within(root, dir)) return []

  let names: string[]
  try {
    if (!within(await realpath(root), await realpath(dir))) return []
    names = await readdir(dir)
  } catch {
    return []
  }

  const entries = await Promise.all(
    names.map(async (name): Promise<DirEntry | null> => {
      if (name.startsWith('.') || SKIP.has(name)) return null
      const path = join(dir, name)
      try {
        const info = await stat(path)
        return info.isDirectory()
          ? { name, path, kind: 'dir' }
          : { name, path, kind: 'file', bytes: info.size }
      } catch {
        return null
      }
    }),
  )

  return entries
    .filter((e): e is DirEntry => e !== null)
    .sort((a, b) =>
      a.kind === b.kind
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : a.kind === 'dir'
          ? -1
          : 1,
    )
}

/** Au delà, le fichier n'est plus lisible à l'écran — inutile de le charger. */
const MAX_FILE_BYTES = 1024 * 1024

/** Extensions traitées comme binaires : les afficher n'a aucun sens. */
const BINARY = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.pdf', '.zip', '.gz', '.7z', '.exe', '.dll', '.node',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.mp3', '.wav',
])

export type FileContent =
  | { ok: true; path: string; text: string; truncated: boolean }
  | { ok: false; path: string; reason: 'binary' | 'too-large' | 'unreadable' }

/** Contenu d'un fichier texte, borné. */
export async function readFileContent(
  root: string,
  target: string,
): Promise<FileContent> {
  if (!within(root, target)) {
    return { ok: false, path: target, reason: 'unreadable' }
  }
  if (BINARY.has(extname(target).toLowerCase())) {
    return { ok: false, path: target, reason: 'binary' }
  }

  try {
    if (!within(await realpath(root), await realpath(target))) return { ok: false, path: target, reason: 'unreadable' }
    const info = await stat(target)
    if (info.size > MAX_FILE_BYTES) {
      return { ok: false, path: target, reason: 'too-large' }
    }
    const raw = await readFile(target, 'utf8')
    // Un octet nul trahit un binaire dont l'extension ne disait rien.
    if (raw.includes(String.fromCharCode(0))) {
      return { ok: false, path: target, reason: 'binary' }
    }
    return { ok: true, path: target, text: raw, truncated: false }
  } catch {
    return { ok: false, path: target, reason: 'unreadable' }
  }
}

/**
 * Réécrit un fichier de l'espace de travail.
 *
 * Le confinement est vérifié ici et non dans l'interface : c'est le seul
 * endroit qui compte. Un chemin forgé depuis le rendu — `..\..\..` — doit
 * échouer même si l'arborescence affichée ne l'a jamais proposé.
 *
 * Écriture par remplacement atomique, avec contrôle du contenu de référence.
 */
const writes = new Map<string, Promise<unknown>>()
export async function writeFileContent(root: string, target: string, text: string, expectedText?: string): Promise<{ ok: boolean; reason?: string }> {
  const key = resolve(target)
  const previous = writes.get(key) ?? Promise.resolve()
  const next = previous.then(() => writeChecked(root, target, text, expectedText))
  writes.set(key, next)
  try { return await next } finally { if (writes.get(key) === next) writes.delete(key) }
}

async function writeChecked(
  root: string,
  target: string,
  text: string,
  expectedText?: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!within(root, target)) {
    return { ok: false, reason: "Chemin hors de l'espace de travail." }
  }
  if (BINARY.has(extname(target).toLowerCase())) {
    return { ok: false, reason: 'Fichier binaire : écriture refusée.' }
  }
  try {
    if (!within(await realpath(root), await realpath(target))) {
      return { ok: false, reason: "Chemin hors de l'espace de travail." }
    }
    if (expectedText !== undefined && await readFile(target, 'utf8') !== expectedText) {
      return { ok: false, reason: 'Le fichier a été modifié sur le disque. Votre brouillon est conservé. Rechargez le fichier avant de réessayer.' }
    }
    const destination = await realpath(target)
    const temporary = `${destination}.${randomUUID()}.tmp`
    try {
      const info = await stat(destination)
      await writeFile(temporary, text, { encoding: 'utf8', flag: 'wx', mode: info.mode })
      await chmod(temporary, info.mode)
      // Recheck after preparing the replacement; a missing file is not recreated.
      if (expectedText !== undefined && await readFile(destination, 'utf8') !== expectedText) {
        return { ok: false, reason: 'Le fichier a changé sur le disque. Votre brouillon est conservé ; rechargez avant de réessayer.' }
      }
      await rename(temporary, destination)
    } finally { await unlink(temporary).catch(() => {}) }
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: String((error as Error).message ?? error) }
  }
}

/**
 * Cherche des fichiers de l'espace de travail, pour la mention « @ ».
 *
 * Parcours borné et non exhaustif : un dépôt compte des centaines de milliers
 * de fichiers avec ses dépendances, et une liste complète serait à la fois
 * lente à produire et inutilisable. Sans requête, on rend le premier niveau —
 * c'est ce qu'on veut voir en tapant « @ » sur un dossier qu'on connaît.
 *
 * Le filtrage est un sous-séquençage : « bts » retrouve « build.ts », comme
 * dans les palettes de commandes auxquelles la frappe est habituée.
 */
export async function searchFiles(
  root: string,
  query: string,
  limit = 40,
): Promise<Array<{ path: string; relative: string; kind: 'file' | 'dir' }>> {
  if (!root) return []
  const needle = query.trim().toLowerCase()

  if (!needle) {
    const entries = await readDirectory(root, undefined)
    return entries.slice(0, limit).map(entry => ({
      path: entry.path,
      relative: entry.name,
      kind: entry.kind,
    }))
  }

  const out: Array<{ path: string; relative: string; kind: 'file' | 'dir' }> = []
  // Plafond de parcours : au-delà, la frappe suivante rendra la recherche
  // caduque de toute façon, et l'utilisateur préfère une réponse immédiate et
  // partielle à une réponse complète en trois secondes.
  let visited = 0

  const walk = async (dir: string, prefix: string, depth: number) => {
    if (out.length >= limit || visited > 20000 || depth > 8) return
    let entries: DirEntry[]
    try {
      entries = await readDirectory(root, dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= limit) return
      visited++
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (matches(relative.toLowerCase(), needle)) {
        out.push({ path: entry.path, relative, kind: entry.kind })
      }
      if (entry.kind === 'dir') await walk(entry.path, relative, depth + 1)
    }
  }

  await walk(root, '', 0)
  // Les correspondances courtes d'abord : elles sont presque toujours celles
  // qu'on visait.
  out.sort((a, b) => a.relative.length - b.relative.length)
  return out
}

/** Sous-séquençage : les lettres de la requête, dans l'ordre, pas forcément voisines. */
function matches(haystack: string, needle: string): boolean {
  let index = 0
  for (const character of needle) {
    index = haystack.indexOf(character, index)
    if (index === -1) return false
    index++
  }
  return true
}
