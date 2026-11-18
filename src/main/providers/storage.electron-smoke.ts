/** Run the bundled script with Electron twice: <temporary-directory> migrate, then read. */
import { app, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProviderStorage } from './storage.js'

const directory = process.argv[2]!
const mode = process.argv[3]
if (!directory || !['migrate', 'read'].includes(mode!)) throw new Error('Expected a temporary directory and migrate/read')
app.setPath('userData', directory)
app.whenReady().then(async () => {
  const config = { kind: 'openai' as const, token: 'smoke-test-token', openaiApiKey: 'test-provider-key' }
  const store = new ProviderStorage(directory, safeStorage)
  const file = join(directory, 'provider.json')
  if (mode === 'migrate') {
    await mkdir(directory, { recursive: true })
    await writeFile(file, JSON.stringify(config), { flag: 'wx' })
  }
  assert.deepEqual(await store.read(), config)
  const disk = await readFile(file, 'utf8')
  for (const secret of [config.token, config.openaiApiKey]) assert(!disk.includes(secret))
  assert.equal(JSON.parse(disk).version, 1)
  console.log(`Native secure storage: ${mode} OK (${process.platform})`)
  app.exit(0)
}).catch(() => {
  console.error('Native secure storage validation failed')
  app.exit(1)
})
