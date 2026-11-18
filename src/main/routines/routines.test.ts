/**
 * Échéance des routines.
 *
 * Deux erreurs possibles, aussi graves l'une que l'autre : une routine qui ne
 * part jamais, et une routine qui part en boucle. Les tests tiennent les deux
 * bords, plus le cas qui les décide — l'ancre.
 */

import { describe, expect, test } from 'bun:test'
import { dueRoutines, nextRunAt, type Routine } from './routines.js'

const MINUTE = 60_000
const HEURE = 60 * MINUTE

/** Une routine horaire, créée à l'instant indiqué. */
const routine = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  cron: '0 * * * *',
  prompt: 'Faire le point',
  createdAt: 0,
  recurring: true,
  ...over,
})

describe('ce qui est dû', () => {
  test('une routine dont l’heure n’est pas venue ne part pas', () => {
    const creation = Date.UTC(2026, 0, 1, 10, 0, 0)
    const tache = routine({ createdAt: creation })
    // Une minute après sa création : la prochaine heure ronde est loin.
    expect(dueRoutines([tache], creation + MINUTE)).toEqual([])
  })

  test('une routine dont l’heure est passée part', () => {
    const creation = Date.UTC(2026, 0, 1, 10, 0, 0)
    const tache = routine({ createdAt: creation })
    expect(dueRoutines([tache], creation + 2 * HEURE).map(t => t.id)).toEqual([
      'r1',
    ])
  })

  test('l’application restée fermée toute la nuit rattrape en un seul tir', () => {
    // Douze heures d'absence sur une routine horaire : douze échéances
    // manquées, un seul tir. Rejouer les douze serait une mauvaise surprise.
    const creation = Date.UTC(2026, 0, 1, 10, 0, 0)
    const dus = dueRoutines(
      [routine({ createdAt: creation })],
      creation + 12 * HEURE,
    )
    expect(dus.length).toBe(1)
  })

  test('une expression illisible ne part jamais', () => {
    // Mieux vaut une routine muette qu'une routine qui part à chaque tick.
    const tache = routine({ cron: 'tous les mardis' })
    expect(dueRoutines([tache], Date.now())).toEqual([])
  })
})

describe('l’ancre est le dernier tir, pas l’instant présent', () => {
  test('une routine qui vient de tirer ne repart pas aussitôt', () => {
    // Le défaut que l'ancre évite : sans `lastFiredAt`, la routine
    // redeviendrait due au tick suivant et partirait en boucle.
    const maintenant = Date.UTC(2026, 0, 1, 11, 0, 0)
    const tache = routine({ createdAt: 0, lastFiredAt: maintenant })
    expect(dueRoutines([tache], maintenant + MINUTE)).toEqual([])
  })

  test('une routine qui a tiré il y a longtemps redevient due', () => {
    const dernier = Date.UTC(2026, 0, 1, 11, 0, 0)
    const tache = routine({ createdAt: 0, lastFiredAt: dernier })
    expect(dueRoutines([tache], dernier + 2 * HEURE).length).toBe(1)
  })

  test('le redémarrage ne fait pas glisser l’échéance', () => {
    // Une routine quotidienne à 9 h doit rester à 9 h, quelle que soit l'heure
    // à laquelle l'application est relancée. Ancrer sur « maintenant » la
    // ferait dériver à chaque lancement.
    const dernier = Date.UTC(2026, 0, 1, 9, 0, 0)
    const tache = routine({
      cron: '0 9 * * *',
      createdAt: 0,
      lastFiredAt: dernier,
    })

    const relanceLeSoir = Date.UTC(2026, 0, 1, 22, 34, 0)
    const prochain = nextRunAt(tache, relanceLeSoir)

    expect(prochain).not.toBeNull()
    expect(new Date(prochain!).getHours()).toBe(9)
  })
})

describe('prochaine échéance affichée', () => {
  test('une expression illisible se dit, elle ne se tait pas', () => {
    // L'interface doit pouvoir écrire « jamais » plutôt que laisser un vide.
    expect(nextRunAt(routine({ cron: 'n’importe quoi' }), Date.now())).toBeNull()
  })

  test('une routine en retard annonce sa prochaine échéance, pas la manquée', () => {
    const creation = Date.UTC(2026, 0, 1, 10, 0, 0)
    const maintenant = creation + 5 * HEURE
    const prochain = nextRunAt(routine({ createdAt: creation }), maintenant)

    expect(prochain).not.toBeNull()
    expect(prochain!).toBeGreaterThan(maintenant)
  })
})
