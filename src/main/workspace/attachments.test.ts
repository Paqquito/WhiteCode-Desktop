import { expect, test } from 'bun:test'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareAttachment } from './attachments.js'

test('a large MP4 is a local meeting reference only when Réunions is active', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sample-attachment-'))
  try {
    const name = "Enregistrement d’écran de l'équipe.mp4"
    const path = join(dir, name)
    const file = await open(path, 'w')
    const bytes = 553849407
    try { await file.truncate(bytes) } finally { await file.close() }
    expect(await prepareAttachment(path)).toMatchObject({ kind: 'rejected' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})
