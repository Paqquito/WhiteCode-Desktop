import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { configureBackend } from './launch.js'

test('per-turn desktop processes disable session-end consolidation while preserving stored memory and other settings', async () => {
  const root=await mkdtemp(join(tmpdir(),'desktop-memory-lifecycle-'))
  try {
    await writeFile(join(root,'config.json'),JSON.stringify({memory:{automatic:{enabled:true},consolidationEnabled:true,recall:{maxItems:6}},permissions:{denyRules:['read_file(secret.txt)']}}))
    await writeFile(join(root,'existing-memory.md'),'Keep this durable fact.')
    await configureBackend(root,'fixture',131072)
    const config=JSON.parse(await readFile(join(root,'config.json'),'utf8'))
    expect(config.memory.consolidationEnabled).toBe(false)
    expect(config.memory.automatic.enabled).toBe(true)
    expect(config.memory.recall.maxItems).toBe(6)
    expect(config.permissions.denyRules).toEqual(['read_file(secret.txt)'])
    expect(await readFile(join(root,'existing-memory.md'),'utf8')).toBe('Keep this durable fact.')
  } finally { await rm(root,{recursive:true,force:true}) }
})
