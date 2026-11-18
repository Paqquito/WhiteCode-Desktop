/**
 * Un sous-agent ne parle pas à la place de l'agent principal.
 *
 * Le moteur marque d'un `parent_tool_use_id` chaque message produit par un
 * agent lancé par un outil. Ces messages ont la même forme que les autres, et
 * le réducteur les traitait donc à l'identique : le texte d'un sous-agent
 * apparaissait dans le fil comme une réponse de l'agent principal, et ses
 * appels d'outils s'y mêlaient aux vrais.
 *
 * Ce qui est vérifié ici tient en une phrase : **rien de ce que produit un
 * sous-agent n'entre au premier niveau du fil**, et son activité se retrouve
 * sous l'appel qui l'a lancé.
 */

import { describe, expect, test } from 'bun:test'
import { initialThreadState, threadReducer, type ThreadState } from './thread.js'
import type { EngineMessage } from './protocol.js'

const APPEL = 'toolu_tache'

/** Message assistant tel que le moteur l'émet, sous-agent ou non. */
function assistant(
  blocks: unknown[],
  parent: string | null = null,
): EngineMessage {
  return {
    type: 'assistant',
    message: { content: blocks },
    parent_tool_use_id: parent,
  } as unknown as EngineMessage
}

const texte = (t: string) => ({ type: 'text', text: t })
const outil = (id: string, name: string) => ({
  type: 'tool_use',
  id,
  name,
  input: {},
})

const pousser = (state: ThreadState, message: EngineMessage): ThreadState =>
  threadReducer(state, { type: 'engine-message', message } as never)

/** Un fil où l'agent principal vient de lancer un sous-agent. */
const filAvecTache = (): ThreadState =>
  pousser(initialThreadState, assistant([outil(APPEL, 'Task')]))

describe('activité d’un sous-agent', () => {
  test('l’appel qui lance le sous-agent est bien au premier niveau', () => {
    // Contrôle de départ : sans lui, les tests suivants pourraient passer sur
    // un fil vide.
    const fil = filAvecTache()
    expect(fil.entries.length).toBe(1)
    expect(fil.entries[0]).toMatchObject({ kind: 'tool', name: 'Task' })
  })

  test('le texte d’un sous-agent n’entre pas dans le fil', () => {
    const fil = pousser(
      filAvecTache(),
      assistant([texte('J’explore le dépôt.')], APPEL),
    )

    // C'est le défaut corrigé : cette phrase apparaissait comme une réponse.
    expect(fil.entries.length).toBe(1)
    expect(fil.entries.some(e => e.kind === 'assistant')).toBe(false)
  })

  test('les appels d’outils d’un sous-agent n’entrent pas dans le fil', () => {
    const fil = pousser(
      filAvecTache(),
      assistant([outil('toolu_interne', 'Grep')], APPEL),
    )

    expect(fil.entries.length).toBe(1)
    expect(
      fil.entries.some(e => e.kind === 'tool' && e.id === 'toolu_interne'),
    ).toBe(false)
  })

  test('l’activité est comptée sous l’appel, et le dernier texte conservé', () => {
    let fil = filAvecTache()
    fil = pousser(fil, assistant([texte('Je commence.')], APPEL))
    fil = pousser(fil, assistant([outil('toolu_a', 'Read')], APPEL))
    fil = pousser(fil, assistant([texte('J’ai fini.')], APPEL))

    expect(fil.entries[0]).toMatchObject({
      kind: 'tool',
      child: { steps: 3, lastText: 'J’ai fini.' },
    })
  })

  test('l’agent principal continue de s’afficher normalement', () => {
    // Le contre-exemple indispensable : un aiguillage trop large ferait
    // disparaître les vraies réponses.
    let fil = filAvecTache()
    fil = pousser(fil, assistant([texte('Réponse du sous-agent.')], APPEL))
    fil = pousser(fil, assistant([texte('Voici le résultat.')]))

    expect(
      fil.entries
        .filter(e => e.kind === 'assistant')
        .map(e => (e as { text: string }).text),
    ).toEqual(['Voici le résultat.'])
  })

  test('un sous-agent sans parent connu est ignoré, pas affiché', () => {
    // Session reprise : le transcript rechargé n'a pas recréé l'appel. Montrer
    // le message au premier niveau serait le défaut d'origine.
    const fil = pousser(
      filAvecTache(),
      assistant([texte('Orphelin.')], 'toolu_inconnu'),
    )

    expect(fil.entries.length).toBe(1)
    expect(fil.entries[0]).toMatchObject({ kind: 'tool' })
  })

  test('un message vide ne compte pas un pas', () => {
    const fil = pousser(filAvecTache(), assistant([texte('   ')], APPEL))
    expect(
      (fil.entries[0] as { child?: { steps: number } }).child,
    ).toBeUndefined()
  })
})
