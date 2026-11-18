/** Desktop-owned durable routines, stored under the desktop's project data folder in each project.
 * The imported cron helper preserves the original scheduling semantics. The
 * anchor is lastFiredAt ?? createdAt, so a restart does not move the schedule.
 * Native WhiteCode scheduling is disabled for these desktop sessions.
 */
import { computeNextCronRun, parseCronExpression } from '../../shared/cron.js'

export type Routine = {
  id: string
  /** Expression cron à cinq champs, en heure locale. */
  cron: string
  prompt: string
  /** Millisecondes epoch. Ancre tant que la routine n'a jamais tiré. */
  createdAt: number
  /** Millisecondes epoch du dernier tir. Absent pour un tir unique. */
  lastFiredAt?: number
  /** Rejoue après le tir au lieu d'être supprimée. */
  paused?: boolean
  recurring?: boolean
}

/**
 * Prochaine occurrence après `fromMs`, ou `null` si l'expression est illisible.
 *
 * Enveloppe des deux fonctions du moteur, pour n'avoir qu'un endroit à changer
 * si leur signature bouge.
 */
function prochaineOccurrence(cron: string, fromMs: number): number | null {
  const champs = parseCronExpression(cron)
  if (!champs) return null
  return computeNextCronRun(champs, new Date(fromMs))?.getTime() ?? null
}

/**
 * Les routines dont l'échéance est passée.
 *
 * Une routine jamais tirée dont l'échéance calculée depuis sa création est
 * déjà dépassée **tire** : c'est le cas de l'application restée fermée toute
 * la nuit. Le rattrapage se fait en un seul tir, pas un par échéance manquée —
 * rejouer douze fois une routine horaire au réveil de la machine serait une
 * mauvaise surprise, pas un service.
 */
export function dueRoutines(tasks: Routine[], nowMs: number): Routine[] {
  return tasks.filter(task => {
    if (task.paused) return false
    const ancre = task.lastFiredAt ?? task.createdAt
    const echeance = prochaineOccurrence(task.cron, ancre)
    // `null` : expression illisible. Une routine qu'on ne sait pas dater ne
    // tire jamais — mieux vaut une routine muette qu'une routine qui part à
    // chaque tick.
    return echeance !== null && echeance <= nowMs
  })
}

/**
 * Prochaine échéance d'une routine, pour l'affichage.
 *
 * Rend `null` quand l'expression est illisible, ce que l'interface doit
 * montrer comme tel plutôt que de laisser une ligne vide : une routine qui ne
 * partira jamais est une information, pas une absence d'information.
 */
export function nextRunAt(task: Routine, nowMs: number): number | null {
  if (task.paused) return null
  const ancre = task.lastFiredAt ?? task.createdAt
  const depuisAncre = prochaineOccurrence(task.cron, ancre)
  if (depuisAncre === null) return null
  // Une échéance déjà passée est due maintenant ; l'afficher au passé
  // laisserait croire à un oubli.
  return depuisAncre <= nowMs ? prochaineOccurrence(task.cron, nowMs) : depuisAncre
}
