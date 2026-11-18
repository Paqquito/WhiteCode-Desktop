/**
 * Restitution d'un transcript : ce qu'on ne sait pas se dit.
 *
 * Un appel d'outil dont le transcript ne contient pas le résultat n'a pas
 * d'issue connue. Le laisser sans résultat le rendait indiscernable d'un appel
 * *en cours*, et une conversation archivée affichait une carte « en cours… »
 * pendant que la barre d'état annonçait « Prêt » (constat D06).
 *
 * Le réducteur prenait déjà cette précaution en direct : à la fin d'un tour,
 * un outil resté sans résultat en reçoit un, explicite. Ce fichier tient la
 * même garantie sur l'autre chemin, celui de la relecture.
 */

import { describe, expect, test } from 'bun:test'
import {
  initialThreadState,
  threadReducer,
  type LoadedEntry,
  type ThreadState,
} from './thread.js'

const charger = (entries: LoadedEntry[]): ThreadState =>
  threadReducer(initialThreadState, {
    type: 'load-transcript',
    entries,
    sessionId: 'session-archivee',
  })

const appel = (id: string): LoadedEntry => ({
  kind: 'tool',
  id,
  name: 'WebSearch',
  input: { query: 'x' },
})

const outilDe = (state: ThreadState, id: string) =>
  state.entries.find(e => e.id === id) as
    | Extract<ThreadState['entries'][number], { kind: 'tool' }>
    | undefined

describe('appel sans résultat dans le transcript', () => {
  test('il est marqué d’issue inconnue', () => {
    const fil = charger([appel('t1')])
    expect(outilDe(fil, 't1')?.unresolved).toBe(true)
  })

  test('il ne reçoit pas de faux résultat', () => {
    // L'inventer serait pire que l'absence : on ne sait pas ce qui s'est passé.
    const fil = charger([appel('t1')])
    expect(outilDe(fil, 't1')?.result).toBeUndefined()
    expect(outilDe(fil, 't1')?.isError).toBeUndefined()
  })
})

describe('appel dont le résultat est présent', () => {
  test('il n’est pas marqué', () => {
    // Le contre-exemple indispensable : sans lui, marquer tous les appels
    // passerait le premier test.
    const fil = charger([
      appel('t1'),
      { kind: 'tool-result', id: 't1', text: 'trouvé', isError: false },
    ])
    expect(outilDe(fil, 't1')?.unresolved).toBeUndefined()
    expect(outilDe(fil, 't1')?.result).toBe('trouvé')
  })

  test('un résultat en erreur reste un échec, pas une inconnue', () => {
    const fil = charger([
      appel('t1'),
      { kind: 'tool-result', id: 't1', text: 'boum', isError: true },
    ])
    expect(outilDe(fil, 't1')?.unresolved).toBeUndefined()
    expect(outilDe(fil, 't1')?.isError).toBe(true)
  })
})

test('chaque appel est jugé séparément', () => {
  const fil = charger([
    appel('t1'),
    { kind: 'tool-result', id: 't1', text: 'trouvé', isError: false },
    appel('t2'),
  ])
  expect(outilDe(fil, 't1')?.unresolved).toBeUndefined()
  expect(outilDe(fil, 't2')?.unresolved).toBe(true)
})
