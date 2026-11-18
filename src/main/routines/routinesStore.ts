/**
 * Lecture et écriture du fichier des routines.
 *
 * Séparé de `routines.ts` pour une raison mesurée : le dialogue du rendu a
 * besoin du calcul d'échéance, et importer ce calcul depuis un module qui
 * touche au disque a fait passer le paquet du rendu de 1469 à 2001 Ko — un
 * demi-mégaoctet de cales `node:fs` embarquées dans un navigateur, où elles
 * n'ont rien à faire. Le calcul est donc pur et partagé, l'entrée-sortie reste
 * ici, dans le processus principal.
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { parseCronExpression } from '../../shared/cron.js'
import type { Routine } from './routines.js'
import { projectDataDirectory } from '../backend/paths.js'

/** Routines de l'application dans le dossier de données de projet de l’application. */
export function routinesFilePath(cwd: string): string {
  return join(projectDataDirectory(cwd), 'scheduled_tasks.json')
}

/**
 * Les routines d'un projet.
 *
 * L'absence signifie une liste vide. Une erreur de lecture ou de format est
 * signalée : une mutation ne doit jamais écraser un fichier endommagé.
 */
export async function readRoutines(cwd: string): Promise<Routine[]> {
  let brut: string
  try {
    brut = await readFile(routinesFilePath(cwd), 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  let analyse: unknown
  try {
    analyse = JSON.parse(brut)
  } catch {
    throw new Error(
      'Le fichier des routines est illisible ; corrigez-le avant de le modifier.',
    )
  }
  const taches = (analyse as { tasks?: unknown })?.tasks
  if (!Array.isArray(taches))
    throw new Error('Format du fichier des routines invalide.')

  const valid = taches.every((t) => {
    const c = t as Partial<Routine>
    return (
      typeof c?.id === 'string' &&
      typeof c?.cron === 'string' &&
      typeof c?.prompt === 'string' &&
      typeof c?.createdAt === 'number' &&
      Number.isFinite(c.createdAt) &&
      (c.paused === undefined || typeof c.paused === 'boolean') &&
      parseCronExpression(c.cron) !== null
    )
  })
  if (!valid)
    throw new Error('Une routine est mal formée ; le fichier a été conservé.')
  return taches as Routine[]
}

/**
 * Réécrit le fichier d'un projet.
 *
 * Même forme que le moteur — `{ tasks: [...] }`, indenté à deux espaces, saut
 * de ligne final — pour qu'un fichier écrit ici reste lisible là-bas, et que
 * le diff d'un dépôt versionné ne s'agite pas à chaque tir.
 */
export async function writeRoutines(
  cwd: string,
  routines: Routine[],
): Promise<void> {
  const chemin = routinesFilePath(cwd)
  await mkdir(dirname(chemin), { recursive: true })
  const temporary = `${chemin}.${randomUUID()}.tmp`
  await writeFile(
    temporary,
    `${JSON.stringify({ tasks: routines }, null, 2)}\n`,
    'utf-8',
  )
  await rename(temporary, chemin)
}

/**
 * Ajoute une routine à un projet.
 *
 * Refuse plutôt que de corriger : une expression cron illisible, une invite
 * vide. Le silence serait pire que l'erreur — une routine acceptée qui ne
 * partira jamais est indiscernable d'une routine oubliée, et son auteur ne
 * l'apprendrait qu'en ne voyant rien se produire.
 */
export async function addRoutine(
  cwd: string,
  draft: { cron: string; prompt: string; recurring?: boolean },
): Promise<Routine> {
  const cron = draft.cron.trim()
  const prompt = draft.prompt.trim()
  if (!parseCronExpression(cron)) {
    throw new Error(`Expression cron invalide : ${cron || '(vide)'}`)
  }
  if (!prompt) throw new Error('Une routine sans invite ne ferait rien.')

  const routine: Routine = {
    id: randomUUID(),
    cron,
    prompt,
    createdAt: Date.now(),
    recurring: draft.recurring ?? true,
  }
  await mutateRoutines(cwd, (tasks) => [...tasks, routine])
  return routine
}

/** Retire une routine. Silencieux si elle n'existe plus. */
export async function removeRoutine(cwd: string, id: string): Promise<void> {
  await mutateRoutines(cwd, (tasks) => tasks.filter((r) => r.id !== id))
}

const queues = new Map<string, Promise<unknown>>()
export async function mutateRoutines(
  cwd: string,
  update: (tasks: Routine[]) => Routine[],
): Promise<void> {
  const previous = queues.get(cwd) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(async () => {
      const current = await readRoutines(cwd)
      const updated = update(current)
      if (JSON.stringify(current) !== JSON.stringify(updated))
        await writeRoutines(cwd, updated)
    })
  queues.set(cwd, next)
  try {
    await next
  } finally {
    if (queues.get(cwd) === next) queues.delete(cwd)
  }
}
export async function updateRoutine(
  cwd: string,
  id: string,
  patch: {
    cron?: string
    prompt?: string
    recurring?: boolean
    paused?: boolean
  },
): Promise<void> {
  if (patch.cron !== undefined && !parseCronExpression(patch.cron))
    throw new Error('Expression cron invalide.')
  if (patch.prompt !== undefined && !patch.prompt.trim())
    throw new Error('Une routine sans invite ne ferait rien.')
  await mutateRoutines(cwd, (tasks) => {
    if (!tasks.some((t) => t.id === id))
      throw new Error('Cette routine n’existe plus.')
    return tasks.map((t) =>
      t.id !== id
        ? t
        : {
            ...t,
            ...patch,
            ...(patch.prompt !== undefined
              ? { prompt: patch.prompt.trim() }
              : {}),
            ...((patch.cron !== undefined && patch.cron !== t.cron) ||
            (patch.paused === false && t.paused)
              ? { lastFiredAt: Date.now() }
              : {}),
          },
    )
  })
}
