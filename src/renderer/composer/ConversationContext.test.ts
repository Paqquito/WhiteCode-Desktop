import { expect, test } from 'bun:test'
import { sessionFiles } from './ConversationContext.js'
import type { ThreadEntry } from '../../shared/protocol.js'
import { splitPaths } from '../thread/fileLink.js'

test('file summary requires successful evidence and deduplicates paths', () => {
  const tool = (name: string, path: string, extra: object = {}): ThreadEntry => ({ kind: 'tool', id: name, name, input: { file_path: path }, result: 'ok', ...extra })
  expect(sessionFiles([
    tool('Read', '/src/a'), tool('Read', '/src/a'), tool('Edit', '/src/a'),
    tool('Write', '/failed', { isError: true }), tool('Write', '/pending', { result: undefined }),
    tool('Write', '/unknown', { unresolved: true }), tool('Write', '/interrupted', { interrupted: true }), tool('Edit', '/refused', { decision: 'deny' }),
    tool('Bash', '/unproven'), tool('SendUserFile', '/report.pdf'),
  ])).toEqual({ read: ['/src/a'], written: ['/src/a', '/report.pdf'] })
})
