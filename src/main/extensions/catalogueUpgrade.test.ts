import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Extensions, DEFAULT_SOURCE } from './plugins.js'
import { sourceId } from './extensionSources.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

test('an older official catalogue offers an explicit update without changing its pin or installing a plugin', async () => {
  const root = await mkdtemp(join(tmpdir(), 'catalogue-upgrade-'))
  const source = { id: sourceId(DEFAULT_SOURCE.repository), repository: DEFAULT_SOURCE.repository, ref: 'v1.0.0', commit: 'a'.repeat(40), name: 'whitecode-extensions', entries: [], checkedAt: '2026-10-23T00:00:00Z' }
  await writeFile(join(root, 'extensions.json'), JSON.stringify({ version: 2, enabled: [], sources: [source], installations: {}, defaultSource: 'added', officeMigration: 'done' }))
  const extensions = new Extensions(root, TEST_ROOTS)
  await extensions.bootstrap(() => {}, false)
  expect(await extensions.catalogueStatus()).toMatchObject({ added: true, update: { sourceId: source.id, currentRef: 'v1.0.0', targetRef: DEFAULT_SOURCE.ref } })
  expect((await extensions.sources())[0]?.ref).toBe('v1.0.0')
  expect(JSON.parse(await readFile(join(root, 'extensions.json'), 'utf8')).installations).toEqual({})
})
