import { expect, test } from 'bun:test'
import { initialThreadState, threadReducer, type ThreadState } from '../../shared/thread.js'

test('ending a cancelled turn clears permissions and activity while retaining partial output', () => {
  const state: ThreadState = { ...initialThreadState,
    status: { ...initialThreadState.status, busy: true },
    pending: { requestId: 'old-permission', toolName: 'Bash', toolUseId: 'tool-1', input: {} },
    entries: [
      { kind: 'assistant', id: 'partial', text: 'Réponse partielle', streaming: true },
      { kind: 'tool', id: 'tool-1', name: 'Bash', input: {} },
    ],
  }
  const ended = threadReducer(state, { type: 'turn-end' })
  expect(ended.pending).toBeNull()
  expect(ended.status.busy).toBe(false)
  expect(ended.entries[0]).toEqual({ kind: 'assistant', id: 'partial', text: 'Réponse partielle', streaming: false })
  expect(ended.entries[1]).toMatchObject({ unresolved: true })
  expect(ended.entries[1]).not.toHaveProperty('result')
  expect(threadReducer(ended, { type: 'user-submit', text: 'Reprendre' }).status.busy).toBe(true)
})

test('an expected cancellation result is not displayed as an execution failure', () => {
  const cancelled = threadReducer(initialThreadState, { type: 'interrupt-requested' })
  const result = threadReducer(cancelled, { type: 'engine-message', message: { type: 'result', is_error: true, subtype: 'error_during_execution' } })
  expect(result.entries).toEqual([])
})
