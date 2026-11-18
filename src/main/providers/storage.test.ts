import { expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderStorage, type SecretVault } from './storage.js'

// A deterministic vault double, never used by the application.
const values = new Map<string, string>()
export const testVault: SecretVault = {
  isEncryptionAvailable: () => true,
  encryptString(value) {
    const id = `cipher-${values.size}`
    values.set(id, value)
    return Buffer.from(id)
  },
  decryptString(value) {
    const plain = values.get(value.toString())
    if (plain === undefined) throw new Error('Cannot decrypt')
    return plain
  },
}

async function storage(vault = testVault) {
  const root = await mkdtemp(join(tmpdir(), 'sample-storage-test-'))
  return { file: join(root, 'provider.json'), store: new ProviderStorage(root, vault) }
}

test('migrates plaintext credentials atomically and decrypts on the next read', async () => {
  const { file, store } = await storage()
  const config = { kind: 'compatible' as const, token: 'server-private', openaiApiKey: 'provider-private' }
  await writeFile(file, '\ufeff' + JSON.stringify(config))
  expect(await store.read()).toEqual(config)
  const disk = await readFile(file, 'utf8')
  for (const secret of [config.token, config.openaiApiKey]) expect(disk).not.toContain(secret)
  expect(await store.read()).toEqual(config)
})

test('an unavailable or insecure Linux vault never writes plaintext or destroys the legacy file', async () => {
  for (const vault of [
    { ...testVault, isEncryptionAvailable: () => false },
    { ...testVault, getSelectedStorageBackend: () => 'basic_text' },
  ]) {
    const { file, store } = await storage(vault)
    const old = JSON.stringify({ kind: 'compatible', token: 'keep-existing' })
    await writeFile(file, old)
    await expect(store.read()).rejects.toThrow('coffre')
    expect(await readFile(file, 'utf8')).toBe(old)
    await expect(store.write({ kind: 'compatible', token: 'new-secret' })).rejects.toThrow('coffre')
    expect(await readFile(file, 'utf8')).toBe(old)
  }
})

test('decryption failure and invalid JSON preserve the original file', async () => {
  const { file, store } = await storage()
  for (const content of ['{invalid', JSON.stringify({ version: 1, encrypted: 'broken' })]) {
    await writeFile(file, content)
    await expect(store.read()).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(content)
    await expect(store.write({ kind: 'ollama' })).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(content)
  }
})

test('concurrent saves keep the latest complete configuration', async () => {
  const { store } = await storage()
  const configurations = Array.from({ length: 20 }, (_, i) => ({ kind: 'compatible' as const, token: `secret-${i}` }))
  await Promise.all(configurations.map(config => store.write(config)))
  expect(await store.read()).toEqual(configurations.at(-1)!)
})

test('a configuration without credentials works without a vault', async () => {
  const { file, store } = await storage({ ...testVault, isEncryptionAvailable: () => false })
  await store.write({ kind: 'ollama', ollamaModel: 'qwen' })
  expect(JSON.parse(await readFile(file, 'utf8')).ollamaModel).toBe('qwen')
})

test('OpenAI credentials alone require encryption and preserve the compatible server token', async () => {
  const { file, store } = await storage()
  const config = { kind: 'openai' as const, openaiBaseUrl: 'https://provider.example/v1', openaiApiKey: 'private-openai-key', openaiModel: 'model', token: 'server-token-fixture' }
  await store.write(config)
  expect(await store.read()).toEqual(config)
  expect(await readFile(file, 'utf8')).not.toContain(config.openaiApiKey)
  const unavailable = await storage({ ...testVault, isEncryptionAvailable: () => false })
  await expect(unavailable.store.write({ kind: 'openai', openaiApiKey: 'private-openai-key' })).rejects.toThrow('coffre')
})
