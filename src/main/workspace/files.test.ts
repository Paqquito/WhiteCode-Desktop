import { test, expect } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm, symlink, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDirectory, readFileContent, writeFileContent } from './files.js'

test('conditional saves preserve external edits, deletion, mode and reject escaping symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'files-l05-'))
  const outside = await mkdtemp(join(tmpdir(), 'files-outside-'))
  try {
    const path = join(root, 'script.sh')
    await writeFile(path, 'original', { mode: 0o755 })
    const originalMode = (await stat(path)).mode & 0o777
    expect((await readFileContent(root, path)).ok).toBe(true)
    expect((await writeFileContent(root, path, 'saved', 'original')).ok).toBe(true)
    expect((await stat(path)).mode & 0o777).toBe(originalMode)
    await writeFile(path, 'external')
    expect((await writeFileContent(root, path, 'draft', 'saved')).ok).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('external')
    const results = await Promise.all([writeFileContent(root, path, 'one', 'external'), writeFileContent(root, path, 'two', 'external')])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    await rm(path)
    expect((await writeFileContent(root, path, 'draft', 'one')).ok).toBe(false)
    expect((await readFileContent(root, path)).ok).toBe(false)
    await writeFile(join(outside, 'secret'), 'keep')
    await symlink(outside, join(root, 'outside-dir'), process.platform === 'win32' ? 'junction' : 'dir')
    const escaped = join(root, 'outside-dir', 'secret')
    expect((await readFileContent(root, escaped)).ok).toBe(false)
    expect(await readDirectory(root, join(root, 'outside-dir'))).toEqual([])
    expect((await writeFileContent(root, escaped, 'overwrite', 'keep')).ok).toBe(false)
    expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('keep')
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('binary and oversized files cannot be edited', async () => {
  const root = await mkdtemp(join(tmpdir(), 'files-l05-'))
  try {
    await writeFile(join(root, 'binary'), 'a\0b')
    await writeFile(join(root, 'large'), 'x'.repeat(1024 * 1024 + 1))
    expect(await readFileContent(root, join(root, 'binary'))).toMatchObject({ ok: false, reason: 'binary' })
    expect(await readFileContent(root, join(root, 'large'))).toMatchObject({ ok: false, reason: 'too-large' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
