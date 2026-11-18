/** Read-only history view of native WhiteCode JSONL sessions and file snapshots. */
import { projectKey, desktopTranscript } from '../backend/transcript.js'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { readTranscriptSummary, promptTextOf, textOf } from '#desktop/transcript-reader'
export { promptTextOf } from '#desktop/transcript-reader'

export type SessionSummary = {
  id: string
  /** Première parole de l'utilisateur, tronquée. */
  title: string
  /** Horodatage du dernier prompt utilisateur. */
  updatedAt: number
  /** Taille du transcript, indicateur grossier de longueur. */
  bytes: number
}

/**
 * Dépôt des transcriptions.
 *
 * Sous les données de l'application, et non dans `~/.claude` : ce dernier
 * appartient au client en ligne de commande et à son compte. Les
 * conversations qu'on y trouve ne sont pas celles de l’application, et les mêler
 * afficherait à l'utilisateur des discussions qu'il n'a jamais tenues ici.
 * Le moteur écrit sous son CONFIG_HOME dédié.
 */
export function setProjectsRoot(root: string): void {
  projectsRoot = root
}

let projectsRoot = join(homedir(), '.desktop', 'engine', 'sessions')

function projectDirFor(cwd: string): string {
  return join(projectsRoot, projectKey(cwd))
}

export function readSessionSummary(cwd: string, sessionId: string) {
  return readTranscriptSummary(join(projectDirFor(cwd), sessionId + '.jsonl'))
}

/** Sessions d'un répertoire de travail, la plus récente en tête. */
export async function listSessions(cwd: string): Promise<SessionSummary[]> {
  const dir = projectDirFor(cwd)

  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    // Aucun projet enregistré pour ce répertoire : liste vide, pas une erreur.
    return []
  }

  const summaries = await Promise.all(
    names
      .filter(name => name.endsWith('.jsonl'))
      .map(async name => {
        const file = join(dir, name)
        try {
          const info = await readTranscriptSummary(file)
          return {
            id: name.replace(/\.jsonl$/, ''),
            title: info.title,
            updatedAt: info.updatedAt,
            bytes: info.bytes,
          }
        } catch {
          return null
        }
      }),
  )

  return summaries
    .filter((s): s is SessionSummary => s !== null)
    // Les sessions vides sont des amorces avortées : les lister brouillerait
    // l'historique sans rien apporter.
    .filter(s => s.bytes > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Une entrée de transcript, réduite à ce que l'affichage consomme. */
export type TranscriptEntry =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; input: unknown }
  | { kind: 'tool-result'; id: string; text: string; isError: boolean }

/**
 * Relit un transcript pour réafficher une session reprise.
 *
 * Le moteur restaure le contexte de son côté via `--resume` ; cette lecture ne
 * sert qu'à remplir la fenêtre, pour que l'utilisateur retrouve la
 * conversation telle qu'il l'a laissée au lieu d'un fil vide.
 */
export async function readTranscript(
  cwd: string,
  sessionId: string,
): Promise<TranscriptEntry[]> {
  const file = join(projectDirFor(cwd), `${sessionId}.jsonl`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return []
  }

  const entries: TranscriptEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: {
      type?: string
      isSidechain?: boolean
      message?: { role?: string; content?: unknown }
    }
    try {
      record = desktopTranscript(JSON.parse(line), resolve(dirname(file), '..', '..', 'content'))
    } catch {
      continue
    }
    const content = record.message?.content
    if (!content) continue

    if (record.type === 'user') {
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as {
            type?: string
            tool_use_id?: string
            content?: unknown
            is_error?: boolean
          }
          if (b.type === 'tool_result' && b.tool_use_id) {
            entries.push({
              kind: 'tool-result',
              id: b.tool_use_id,
              text: textOf(b.content) || JSON.stringify(b.content),
              isError: Boolean(b.is_error),
            })
          }
        }
      }
      const text = promptTextOf(record)
      if (text) entries.push({ kind: 'user', text })
      continue
    }

    if (record.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        const b = block as {
          type?: string
          text?: string
          id?: string
          name?: string
          input?: unknown
        }
        if (b.type === 'text' && b.text?.trim()) {
          entries.push({ kind: 'assistant', text: b.text })
        } else if (b.type === 'tool_use' && b.id && b.name) {
          entries.push({ kind: 'tool', id: b.id, name: b.name, input: b.input })
        }
      }
    }
  }
  return entries
}

/** Un tour auquel l'utilisateur peut demander de revenir. */
export type RestorePoint = {
  /** `uuid` du message utilisateur : c'est lui que le moteur attend. */
  messageId: string
  /** L'invite elle-même, seul repère lisible pour choisir où revenir. */
  text: string
  /** Horodatage ISO du message, tel que le moteur l'a consigné. */
  at: string
}

/**
 * Liste les tours auxquels le disque peut être ramené.
 *
 * Le moteur ne restaure que par `uuid` de message utilisateur, et cet
 * identifiant n'existe nulle part ailleurs : il n'apparaît pas dans le flux
 * du tour, où seuls les résultats d'outils en portent un. Le transcript est
 * donc la seule source, pour une session reprise comme pour celle en cours.
 *
 * Un tour n'est proposé que si le moteur a consigné un instantané pour lui —
 * c'est la condition exacte que `fileHistoryCanRestore` vérifie de son côté.
 * Cette liste ne dit pas si quelque chose a changé depuis : seule la
 * prévisualisation du moteur le sait, et elle coûte un appel.
 */
export async function listRestorePoints(
  cwd: string,
  sessionId: string,
): Promise<RestorePoint[]> {
  const file = join(projectDirFor(cwd), `${sessionId}.jsonl`)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return []
  }

  const prompts: RestorePoint[] = []
  const withSnapshot = new Set<string>()
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let record: {
      type?: string
      uuid?: string
      timestamp?: string
      isSidechain?: boolean
      messageId?: string
      message?: { content?: unknown }
    }
    try {
      record = desktopTranscript(JSON.parse(line), resolve(dirname(file), '..', '..', 'content'))
    } catch {
      continue
    }

    // Un même message reçoit plusieurs instantanés au fil de ses éditions ;
    // seule leur existence compte ici, pas leur nombre ni leur contenu.
    if (record.type === 'file-history-snapshot' && record.messageId) {
      withSnapshot.add(record.messageId)
      continue
    }
    if (record.type !== 'user' || !record.uuid) continue
    const text = promptTextOf(record)
    if (text) prompts.push({ messageId: record.uuid, text, at: record.timestamp ?? '' })
  }

  return prompts.filter(prompt => withSnapshot.has(prompt.messageId))
}
