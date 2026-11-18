/**
 * Ordonnanceur des routines, dans le processus principal.
 *
 * Le seul endroit durable de l'application : une routine doit partir même si
 * aucune session n'est ouverte, sinon elle n'est qu'un rappel qu'il faut être
 * là pour voir.
 *
 * ## Ce qu'une routine produit
 *
 * Une **exécution isolée**, jamais un message glissé dans la session active.
 * La distinction est le cœur du sujet : injecter un texte dans la conversation
 * en cours ferait apparaître, au milieu du travail de quelqu'un, une demande
 * qu'il n'a pas écrite — et le modèle y répondrait avec le contexte du voisin.
 * Chaque tir ouvre donc sa propre session, révisable comme une autre.
 *
 * ## Ce qu'il ne fait pas
 *
 * Ni analyse cron, ni forme de fichier en propre : le calendrier vient de
 * `routines.ts`, le fichier de `routinesStore.ts` — celui du moteur.
 */

import { dueRoutines, type Routine } from './routines.js'
import { mutateRoutines } from './routinesStore.js'
import { saveRoutineRun, type RoutineRun } from './routineHistory.js'
import { randomUUID } from 'node:crypto'

/** Une minute : le grain d'un cron à cinq champs, rien de plus fin n'a de sens. */
const INTERVALLE_MS = 60_000

export type RoutineLaunch = {
  sessionId: string
  completion: Promise<{
    cancelled: boolean
    failed: boolean
    sessionId?: string
  }>
}
export type RoutineFire = (
  cwd: string,
  task: Routine,
) => unknown | Promise<unknown>

export class RoutineScheduler {
  #timer: NodeJS.Timeout | null = null
  /**
   * Tirs en cours, par projet et identifiant.
   *
   * Un tick dure moins qu'une lecture de fichier, mais pas moins qu'une
   * ouverture de session : sans ce garde, une routine lente serait relancée au
   * tick suivant, avant que son `lastFiredAt` ait été écrit.
   */
  readonly #enCours = new Set<string>()

  constructor(
    /** Projets à surveiller. Relu à chaque tick : la liste bouge. */
    private readonly workspaces: () => readonly string[],
    private readonly fire: RoutineFire,
    private readonly intervalMs: number = INTERVALLE_MS,
  ) {}

  start(): void {
    if (this.#timer) return
    // `unref` : l'ordonnanceur ne doit pas, à lui seul, empêcher le processus
    // de se terminer.
    this.#timer = setInterval(() => void this.tick(), this.intervalMs)
    this.#timer.unref?.()
  }

  stop(): void {
    if (!this.#timer) return
    clearInterval(this.#timer)
    this.#timer = null
  }

  /**
   * Un tour de surveillance. Exposé pour les tests et pour un déclenchement
   * immédiat au démarrage — au lancement de l'application, les routines de la
   * nuit sont déjà en retard, attendre une minute de plus n'aide personne.
   */
  async tick(now: number = Date.now()): Promise<void> {
    if (this.#enCours.has('tick')) return
    this.#enCours.add('tick')
    try {
      for (const cwd of new Set(this.workspaces())) {
        try {
          let due: Routine[] = []
          // Claim the entire batch against the latest file under the same
          // lock as UI mutations: no stale snapshot can resurrect another task.
          await mutateRoutines(cwd, (tasks) => {
            due = dueRoutines(tasks, now).filter(
              (task) => !this.#enCours.has(`${cwd} ${task.id}`),
            )
            const ids = new Set(due.map((t) => t.id))
            return tasks.flatMap((t) =>
              !ids.has(t.id)
                ? [t]
                : t.recurring
                  ? [{ ...t, lastFiredAt: now }]
                  : [],
            )
          })
          for (const task of due) {
            const key = `${cwd} ${task.id}`
            this.#enCours.add(key)
            const run: RoutineRun = {
              id: randomUUID(),
              routineId: task.id,
              prompt: task.prompt,
              firedAt: now,
              status: 'starting',
            }
            try {
              await saveRoutineRun(cwd, run)
              const result = await this.fire(cwd, task)
              const launch =
                result && typeof result === 'object' && 'sessionId' in result
                  ? (result as RoutineLaunch)
                  : null
              const sessionId =
                launch?.sessionId ??
                (typeof result === 'string' ? result : undefined)
              await saveRoutineRun(cwd, {
                ...run,
                status: 'launched',
                sessionId,
              })
              if (launch?.completion)
                void launch.completion
                  .then((outcome) =>
                    saveRoutineRun(cwd, {
                      ...run,
                      sessionId: outcome.sessionId ?? sessionId,
                      status: outcome.cancelled
                        ? 'cancelled'
                        : outcome.failed
                          ? 'failed'
                          : 'completed',
                    }),
                  )
                  .catch(() => {})
                  .finally(() => this.#enCours.delete(key))
              else this.#enCours.delete(key)
            } catch (error) {
              this.#enCours.delete(key)
              await saveRoutineRun(cwd, {
                ...run,
                status: 'failed',
                error: String(error),
              }).catch(() => {})
            }
          }
        } catch {
          /* One unavailable project must not stop the others. */
        }
      }
    } finally {
      this.#enCours.delete('tick')
    }
  }
}
