import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPersonalActivity } from './personalActivity.js'

test('L11 counts dated user prompts locally, excluding tools, duplicates and subagents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'l11-activity-'))
  const now = new Date(2026, 8, 16, 12)
  const timestamp = new Date(2026, 8, 16, 10).toISOString()
  const prompt = { type: 'user', uuid: 'one', timestamp, message: { content: 'Contenu privé' } }
  try {
    await mkdir(join(root, 'project'))
    await writeFile(join(root, 'project', 'session.jsonl'), [
      prompt, prompt,
      { ...prompt, uuid: 'two', timestamp: new Date(2026, 8, 10).toISOString() },
      { ...prompt, uuid: 'old', timestamp: new Date(2026, 8, 9, 23, 59).toISOString() },
      { ...prompt, uuid: 'future', timestamp: new Date(2026, 8, 16, 13).toISOString() },
      { ...prompt, uuid: 'agent', isSidechain: true },
      { ...prompt, uuid: 'meta', isMeta: true },
      { ...prompt, uuid: 'assistant', type: 'assistant' },
      { ...prompt, uuid: 'tool', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      { ...prompt, uuid: 'internal', message: { content: '<system>internal</system>' } },
      { ...prompt, uuid: 'undated', timestamp: undefined },
    ].map(value => JSON.stringify(value)).join('\n') + '\n{"unfinished":')
    await writeFile(join(root, 'project', 'other.jsonl'), JSON.stringify({ ...prompt, uuid: 'three' }))
    const result = await readPersonalActivity(root, 7, true, now)
    expect(result.sessions).toBe(2)
    expect(result.messages).toBe(3)
    expect(result.activeDays).toBe(2)
    expect(result.days).toHaveLength(7)
    expect(result.days[0]).toEqual({ date: '2026-09-10', messages: 1 })
    expect(result.days[6]).toEqual({ date: '2026-09-16', messages: 2 })
    expect(result.ignoredEntries).toBe(2)
    expect(JSON.stringify(result)).not.toContain('Contenu privé')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('L11 empty history, invalid periods and disabled module are explicit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'l11-empty-'))
  try {
    const empty = await readPersonalActivity(join(root, 'missing'), 30, true)
    expect(empty.messages).toBe(0)
    expect(empty.days).toHaveLength(30)
    await expect(readPersonalActivity(root, 365, true)).rejects.toThrow('Période')
    await expect(readPersonalActivity(root, 7, false)).rejects.toThrow('désactivé')
    await writeFile(join(root, 'file'), 'not a directory')
    await expect(readPersonalActivity(join(root, 'file'), 7, true)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
