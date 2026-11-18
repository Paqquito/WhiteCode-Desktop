import { describe, expect, test } from 'bun:test'
import { agentsFromEntries, workingCount } from './agents.js'
import type { ThreadEntry } from './protocol.js'

test('native spawn_agent calls remain visible before progress events and retain their outcome', () => {
  expect(agentsFromEntries([{ kind: 'tool', id: 'native', name: 'spawn_agent', input: { description: 'Lire GitLab' }, result: 'Lecture terminée.' }])).toMatchObject([{ id: 'native', description: 'Lire GitLab', status: 'done', steps: 0 }])
})

const appel = (over: Partial<Extract<ThreadEntry, { kind: 'tool' }>>) =>
  ({
    kind: 'tool',
    id: 'toolu_1',
    name: 'Task',
    input: {},
    ...over,
  }) as ThreadEntry

describe('recensement des sous-agents', () => {
  test('un appel sans activité enfant n’est pas un sous-agent', () => {
    // Un `Task` qui vient d'être émis n'a pas encore d'enfant. L'afficher à
    // zéro pas le ferait passer pour bloqué alors qu'il démarre.
    expect(agentsFromEntries([appel({})])).toEqual([])
  })

  test('un outil ordinaire n’est jamais recensé', () => {
    expect(
      agentsFromEntries([appel({ name: 'Read', child: undefined })]),
    ).toEqual([])
  })

  test('un appel avec activité est recensé, dans l’ordre du fil', () => {
    const agents = agentsFromEntries([
      appel({ id: 'a', child: { steps: 2 } }),
      { kind: 'assistant', id: 'x', text: 'bla', streaming: false },
      appel({ id: 'b', child: { steps: 1 } }),
    ])
    expect(agents.map(a => a.id)).toEqual(['a', 'b'])
  })
})

describe('état d’un sous-agent', () => {
  test('sans résultat, il travaille', () => {
    expect(agentsFromEntries([appel({ child: { steps: 1 } })])[0]?.status).toBe(
      'working',
    )
  })

  test('avec un résultat, il a fini', () => {
    expect(
      agentsFromEntries([appel({ child: { steps: 1 }, result: 'ok' })])[0]
        ?.status,
    ).toBe('done')
  })

  test('un résultat en erreur est un échec, pas une fin', () => {
    // La distinction porte toute la valeur de la vue : un agent qui a échoué
    // demande une action, un agent qui a fini n'en demande aucune.
    expect(
      agentsFromEntries([
        appel({ child: { steps: 1 }, result: 'boum', isError: true }),
      ])[0]?.status,
    ).toBe('failed')
  })
})

describe('libellé', () => {
  test('la description de l’appel est reprise', () => {
    expect(
      agentsFromEntries([
        appel({
          input: { description: 'Explorer le dépôt' },
          child: { steps: 1 },
        }),
      ])[0]?.description,
    ).toBe('Explorer le dépôt')
  })

  test('une description vide ne se fait pas passer pour un libellé', () => {
    expect(
      agentsFromEntries([
        appel({ input: { description: '  ' }, child: { steps: 1 } }),
      ])[0]?.description,
    ).toBeUndefined()
  })

  test('une entrée non-objet ne fait pas tomber le recensement', () => {
    // L'entrée d'un outil vient du modèle : elle n'est pas garantie.
    expect(
      agentsFromEntries([appel({ input: null, child: { steps: 1 } })])[0]?.tool,
    ).toBe('Task')
  })
})

describe('compte de ceux qui travaillent', () => {
  test('seuls les actifs sont comptés', () => {
    const agents = agentsFromEntries([
      appel({ id: 'a', child: { steps: 1 } }),
      appel({ id: 'b', child: { steps: 1 }, result: 'ok' }),
      appel({ id: 'c', child: { steps: 1 }, result: 'boum', isError: true }),
      appel({ id: 'd', child: { steps: 1 } }),
    ])
    expect(workingCount(agents)).toBe(2)
  })
})
