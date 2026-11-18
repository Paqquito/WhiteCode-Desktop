/** Project inventory from native session metadata in the isolated desktop profile. */
import { readTranscriptSummary } from '#desktop/transcript-reader'
import type { SessionOrigins } from '../session/sessionOrigins.js'
import type { SessionMetaStore } from '../session/sessionMeta.js'
import type { SessionOrigin } from '../../shared/sessionOrigin.js'
import { compareSessions, displayTitle } from '../../shared/sessionMeta.js'
import type { ProjectMetaStore } from './projectMeta.js'
import { compareProjects, projectName } from '../../shared/projectMeta.js'

import { readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { SessionAttention } from '../../shared/sessionAttention.js'
import type { ChatWorkspaces } from './chats.js'

export type SessionSummary = {
  origin?: SessionOrigin
  attention?: SessionAttention
  activity?: 'running' | 'permission'
  id: string
  /** Le titre choisi s'il y en a un, sinon celui déduit du transcript. */
  title: string
  /**
   * Le titre déduit, conservé à côté.
   *
   * Sert au champ de renommage : proposer le nom en cours plutôt qu'un champ
   * vide, et montrer ce à quoi on revient en effaçant.
   */
  derivedTitle: string
  pinned?: boolean
  archived?: boolean
  unread?: boolean
  updatedAt: number
  bytes: number
}

export type Project = {
  /** Le nom choisi s'il y en a un, sinon celui du dossier. */
  name: string
  /** Le nom du dossier, conservé pour le champ de renommage. */
  derivedName: string
  pinned?: boolean
  /** Dossiers sources ajoutés, repris par les nouvelles sessions d'ici. */
  sources?: string[]
  instructions?: string
  /** Chemin réel, relu depuis un transcript. */
  cwd: string
  chat?: boolean
  /** Dossier de stockage, pour relire les transcripts. */
  storageDir: string
  sessions: SessionSummary[]
  /** Session la plus récente du projet, pour l'ordre d'affichage. */
  updatedAt: number
}

/** Voir `sessions.ts` : le dépôt appartient à l'application, pas au compte. */
export function setProjectsRoot(root: string): void {
  root_ = root
}

let root_ = join(homedir(), '.desktop', 'engine', 'sessions')

function projectsRoot(): string {
  return root_
}

/**
 * Tous les projets connus, chacun avec ses sessions.
 *
 * Trié par activité décroissante, projets comme sessions : ce qu'on a touché
 * en dernier est ce qu'on rouvre le plus souvent. Les sessions épinglées font
 * exception et remontent en tête de leur projet.
 *
 * Les archivées sont **listées** et marquées comme telles. C'est le rendu qui
 * décide de les montrer ou non : les filtrer ici priverait l'interface de tout
 * moyen de les retrouver, et archiver deviendrait une suppression déguisée.
 */
export async function listProjects(
  origins?: SessionOrigins,
  meta?: SessionMetaStore,
  projectMeta?: ProjectMetaStore,
  chats?: ChatWorkspaces,
): Promise<Project[]> {
  const root = projectsRoot()

  let dirs: string[]
  try {
    dirs = await readdir(root)
  } catch {
    return []
  }

  const projects = await Promise.all(
    dirs.map(async (dirName): Promise<Project | null> => {
      const storageDir = join(root, dirName)

      let files: string[]
      try {
        files = (await readdir(storageDir)).filter(n => n.endsWith('.jsonl'))
      } catch {
        return null
      }
      if (files.length === 0) return null

      const sessions: SessionSummary[] = []
      let cwd: string | null = null

      for (const name of files) {
        const file = join(storageDir, name)
        let head: Awaited<ReturnType<typeof readTranscriptSummary>>
        try { head = await readTranscriptSummary(file) } catch { continue }
        if (head.bytes === 0) continue
        if (!cwd && head.cwd) cwd = head.cwd

        const id = name.replace(/\.jsonl$/, '')
        const decided = head.cwd ? meta?.read(head.cwd, id) : undefined
        sessions.push({
          id,
          title: displayTitle(decided, head.title),
          derivedTitle: head.title,
          pinned: decided?.pinned,
          archived: decided?.archived,
          unread: decided?.unread,
          origin: head.cwd ? origins?.read(head.cwd, id) : undefined,
          updatedAt: head.updatedAt,
          bytes: head.bytes,
        })
      }

      if (sessions.length === 0) return null
      sessions.sort(compareSessions)

      const resolved = cwd ?? dirName
      const decided = projectMeta?.read(resolved)
      // Retiré de la liste : les transcripts restent, la liste les ignore.
      if (decided?.removed) return null
      const chat = chats?.owns(resolved)
      const derivedName = chat ? 'Chat' : basename(resolved.replace(/[\\/]+$/, '')) || resolved
      return {
        name: projectName(decided, derivedName),
        derivedName,
        pinned: decided?.pinned,
        sources: decided?.sources,
        instructions: decided?.instructions,
        cwd: resolved,
        ...(chat ? { chat: true } : {}),
        storageDir,
        sessions,
        updatedAt: Math.max(...sessions.map(session => session.updatedAt)),
      }
    }),
  )

  return projects
    .filter((p): p is Project => p !== null)
    .sort(compareProjects)
}
