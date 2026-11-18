import { expect, test } from 'bun:test'
import { activityBlocks, conversationTurns, toolLabel, toolState, toolStateCount } from './activity.js'
import { initialThreadState, threadReducer } from './thread.js'
import { agentsFromEntries } from './agents.js'
import type { ThreadEntry } from './protocol.js'
const tool = (id: string, patch = {}): ThreadEntry => ({ kind: 'tool', id, name: 'Read', input: {}, ...patch })

test('activity grouping preserves user and assistant ordering and turn boundaries', () => {
  const entries: ThreadEntry[] = [{kind:'user', id:'u1', text:'A'}, tool('t1'), tool('t2'), {kind:'assistant', id:'a', text:'Observation', streaming:false}, tool('t3'), {kind:'user',id:'u2',text:'B'},tool('t4')]
  const turns = conversationTurns(entries)
  expect(turns.map(t => t.id)).toEqual(['u1', 'u2'])
  expect(activityBlocks(turns[0]!.entries).map(b => b.map(e => e.id))).toEqual([['t1', 't2'], ['a'], ['t3']])
})
test('tool outcomes and agent outcomes agree, without inventing a result', () => {
  for (const [patch, expected] of [[{},'working'],[{result:'ok'},'done'],[{isError:true,result:'bad'},'failed'],[{decision:'deny'},'denied'],[{interrupted:true},'interrupted'],[{unresolved:true},'unknown']] as const) {
    const entry = tool('agent', { ...patch, child: {steps:2} })
    if (entry.kind !== 'tool') throw new Error('tool required')
    expect(toolState(entry)).toBe(expected)
    expect(agentsFromEntries([entry])[0]?.status).toBe(expected)
  }
})
test('cancel keeps partial output and marks only current tools interrupted', () => {
  let state = threadReducer(initialThreadState, { type:'user-submit',text:'Continue' })
  state = { ...state, entries: [tool('old', {unresolved:true}), ...state.entries, tool('current'), {kind:'assistant',id:'partial',text:'Début',streaming:true}] }
  state = threadReducer(state, {type:'interrupt-requested'})
  state = threadReducer(state, {type:'turn-end'})
  expect(state.entries[0]).toMatchObject({unresolved:true})
  expect(state.entries[1]).toMatchObject({outcome:'interrupted'})
  expect(state.entries[2]).toMatchObject({interrupted:true})
  expect(state.entries[2]).not.toHaveProperty('result')
  expect(state.entries[3]).toMatchObject({text:'Début',streaming:false})
})
test('a failed tool does not turn an explicitly successful request into failure', () => {
  let state = threadReducer(initialThreadState, {type:'user-submit',text:'Do it'})
  state = {...state,entries:[...state.entries,tool('failure',{result:'bad',isError:true})]}
  state = threadReducer(state,{type:'engine-message',message:{type:'result',subtype:'success',is_error:false}})
  state = threadReducer(state,{type:'turn-end'})
  expect(state.entries[0]).toMatchObject({outcome:'done'})
})
test('terminal engine failure is reflected even without a result message', () => {
  let state = threadReducer(initialThreadState, {type:'user-submit',text:'Do it'})
  state = threadReducer(state, {type:'turn-end',outcome:'failed'})
  expect(state.entries[0]).toMatchObject({outcome:'failed'})
})

test('le fil nomme les outils et compte leurs états en français', () => {
  expect(toolLabel('Task')).toBe('Sous-tâche')
  expect(toolLabel('Bash')).toBe('Commande')
  expect(toolLabel('mcp__websearch__WebSearch')).toBe('Recherche web (websearch)')
  expect(toolLabel('mcp__documentation__search_docs')).toBe('search_docs (documentation)')
  expect(toolLabel('Inconnu')).toBe('Inconnu')
  expect(toolStateCount('done', 2)).toBe('2 terminés')
  expect(toolStateCount('done', 1)).toBe('1 terminé')
  expect(toolStateCount('failed', 3)).toBe('3 en échec')
})
