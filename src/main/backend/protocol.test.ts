import { expect, test } from 'bun:test'
import { WhiteCodeProtocol, whiteCodeContent, approvalMode, whiteCodeTools } from './protocol.js'
import { initialThreadState, threadReducer } from '../../shared/thread.js'

test('WhiteCode fragments, complete text and tools form one desktop conversation', () => {
  const adapter = new WhiteCodeProtocol(131072)
  let state = threadReducer(initialThreadState, { type: 'user-submit', text: 'hello' })
  for (const event of [
    { type: 'session', sessionId: 's1', model: 'gpt-test', cwd: '/project', tools: ['read_file'], permissionMode: 'ask' },
    { type: 'assistant', content: 'Bon', partial: true },
    { type: 'assistant', content: 'jour', partial: true },
    { type: 'assistant', content: 'Bonjour', partial: false, toolCalls: [{ callId: 'c1', toolId: 'read_file', input: { path: 'README.md' } }] },
    { type: 'tool_call', callId: 'c1', toolId: 'read_file', input: { path: 'README.md' } },
    { type: 'tool_result', callId: 'c1', output: 'readme', errored: false },
    { type: 'run_completed', sessionId: 's1', haltReason: 'completed', exitCode: 0, usage: { inputTokens: 10, outputTokens: 3 } },
  ]) for (const message of adapter.messages(event)) state = threadReducer(state, { type: 'engine-message', message })
  expect(state.entries.filter(e => e.kind === 'assistant').map(e => e.text)).toEqual(['Bonjour'])
  expect(state.entries.filter(e => e.kind === 'tool')).toMatchObject([{ id: 'c1', name: 'read_file', result: 'readme', isError: false }])
  expect(state.status.sessionId).toBe('s1')
  expect(state.status.contextLimit).toBe(131072)
  expect(state.status.lastCostUsd).toBeNull()
})

test('permissions keep their correlation IDs and never invent an approval', () => {
  const adapter = new WhiteCodeProtocol(32768)
  const [message] = adapter.messages({ type: 'control_request', id: 'permission-1', request: 'approval_request', params: { callId: 'c1', toolName: 'write_file', input: { path: 'a.txt', content: 'x' }, summary: 'Write a file', reason: 'Approval required' } })
  expect(message).toMatchObject({ type: 'control_request', request_id: 'permission-1', request: { subtype: 'can_use_tool', tool_name: 'write_file', tool_use_id: 'c1' } })
  expect(approvalMode('acceptEdits')).toBe('auto_edit')
  expect(approvalMode('bypassPermissions')).toBe('unrestricted')
  expect(whiteCodeTools(['Read', 'Bash', 'TodoWrite'])).toEqual(['read_file', 'run_shell', 'run_powershell', 'update_todo_list'])
})

test('attachments use the native WhiteCode content contract', () => {
  expect(whiteCodeContent([{ type: 'text', text: 'look' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } }])).toEqual([
    { type: 'text', text: 'look' }, { type: 'image', mediaType: 'image/png', data: 'aGVsbG8=' },
  ])
})
