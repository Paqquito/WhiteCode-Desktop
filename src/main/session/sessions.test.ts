import { projectKey } from '../backend/transcript.js'
import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { listSessions, setProjectsRoot } from './sessions.js'
import { listProjects, setProjectsRoot as setProjectInventoryRoot } from '../workspace/projects.js'

test('history is ordered by the latest user prompt, never by a later tool or assistant write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-session-order-'))
  setProjectsRoot(root)
  setProjectInventoryRoot(root)
  const cwd = '/ordering', folder = join(root, projectKey('/ordering'))
  await mkdir(folder)
  const prompt = (timestamp: string, text: string) => ({ type: 'user', cwd, timestamp, message: { content: text } })
  const older = join(folder, 'older.jsonl'), newer = join(folder, 'newer.jsonl')
  await writeFile(older, JSON.stringify(prompt('2026-09-16T10:00:00Z', 'Ancienne')) + '\n')
  await writeFile(newer, JSON.stringify(prompt('2026-09-16T11:00:00Z', 'Récente')) + '\n')
  await appendFile(older, [
    { type: 'assistant', timestamp: '2026-09-16T12:00:00Z', message: { content: [{ type: 'text', text: 'Long result' }] } },
    { ...prompt('2026-09-16T13:00:00Z', 'Agent instruction'), isSidechain: true },
    { ...prompt('2026-09-16T14:00:00Z', 'Internal instruction'), isMeta: true },
    { type: 'user', timestamp: '2026-09-16T15:00:00Z', message: { content: [{ type: 'tool_result', content: 'Tool output' }] } },
  ].map(entry => JSON.stringify(entry) + '\n').join(''))
  let sessions = await listSessions(cwd)
  expect(sessions.map(s => s.id)).toEqual(['newer', 'older'])
  expect(sessions[1]!.updatedAt).toBe(Date.parse('2026-09-16T10:00:00Z'))
  expect((await listProjects())[0]!.sessions.map(s => s.id)).toEqual(['newer', 'older'])
  // A new prompt invalidates the disk summary cache and really changes recency.
  await appendFile(older, JSON.stringify(prompt('2026-09-16T16:00:00Z', 'Nouvelle demande')) + '\n')
  sessions = await listSessions(cwd)
  expect(sessions.map(s => s.id)).toEqual(['older', 'newer'])
  expect(sessions[0]!.title).toBe('Ancienne')
  expect((await listProjects())[0]!.sessions.map(s => s.id)).toEqual(['older', 'newer'])
  expect(sessions[0]!.updatedAt).toBe(Date.parse('2026-09-16T16:00:00Z'))
})

test('undated legacy conversations retain a stable date when their transcript grows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ds-session-legacy-'))
  setProjectsRoot(root)
  await mkdir(join(root, projectKey('/legacy')))
  const file = join(root, projectKey('/legacy'), 'old.jsonl')
  await writeFile(file, JSON.stringify({ type: 'user', message: { content: 'Legacy' } }) + '\n')
  const before = (await listSessions('/legacy'))[0]!.updatedAt
  await new Promise(resolve => setTimeout(resolve, 20))
  await appendFile(file, JSON.stringify({ type: 'assistant', message: { content: 'Later result' } }) + '\n')
  expect((await listSessions('/legacy'))[0]!.updatedAt).toBe(before)
})
