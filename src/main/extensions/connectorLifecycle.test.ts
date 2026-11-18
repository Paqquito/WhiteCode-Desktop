import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { parseConnector, type ConnectorManifest } from './connectors.js'
import { McpRegistry } from './mcpRegistry.js'

const vault = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value).reverse(),
  decryptString: (value: Buffer) => Buffer.from(value).reverse().toString(),
}

async function fixture(enabled = true) {
  const descriptor = JSON.parse(await readFile(new URL('./fixtures/tickets/connector.json', import.meta.url), 'utf8'))
  const manifest = parseConnector(descriptor)
  const root = await mkdtemp(join(tmpdir(), 'sample-connector-lifecycle-'))
  let declared: ConnectorManifest[] = [manifest]
  const reopen = () => new McpRegistry(root, vault, async () => null, undefined, async () => declared)
  const registry = reopen()
  const key = 'k'.repeat(40)
  await registry.setSecret(manifest.id, 'apiKey', key)
  await registry.setEnabled(manifest.id, enabled)
  return { root, registry, manifest, key, reopen, disablePlugin: () => { declared = [] }, enablePlugin: () => { declared = [manifest] } }
}

test('a disabled plugin never reappears as a user MCP server after saving its account', async () => {
  const f = await fixture()
  try {
    expect((await f.registry.list()).find(server => server.id === f.manifest.id)?.source).toBe('plugin')
    f.disablePlugin()
    expect((await f.registry.list()).some(server => server.id === f.manifest.id)).toBe(false)
    expect((await f.reopen().list()).some(server => server.id === f.manifest.id)).toBe(false)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('a disabled plugin connector cannot be retrieved from persisted user MCP entries', async () => {
  const f = await fixture()
  try {
    f.disablePlugin()
    await expect(f.registry.get(f.manifest.id)).rejects.toThrow()
    await expect(f.reopen().get(f.manifest.id)).rejects.toThrow()
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('selecting a disabled plugin cannot launch its previously persisted MCP endpoint', async () => {
  const f = await fixture()
  try {
    f.disablePlugin()
    const launch = await f.reopen().configuration({ ...DEFAULT_SESSION_SETTINGS, mcpServers: [f.manifest.id] })
    expect(launch.config).toBeNull()
    expect(launch.env).toEqual({})
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('probing a disabled plugin fails without making any network request', async () => {
  const f = await fixture()
  const original = globalThis.fetch
  const destinations: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    destinations.push(String(input))
    throw new Error('No network is allowed in the connector lifecycle fixture')
  }) as unknown as typeof fetch
  try {
    f.disablePlugin()
    const result = await f.reopen().probe(f.manifest.id, 500)
    expect(result.ok).toBe(false)
    expect(destinations).toEqual([])
  } finally {
    globalThis.fetch = original
    await rm(f.root, { recursive: true, force: true })
  }
})

test('reactivating a plugin restores its disabled choice and stored account after unrelated changes', async () => {
  const f = await fixture(false)
  try {
    f.disablePlugin()
    await f.reopen().save({ id: 'user', label: 'Custom', enabled: false, config: { type: 'http', url: 'https://example.org/mcp' } })
    f.enablePlugin()
    const reopened = f.reopen()
    const entry = (await reopened.list()).find(server => server.id === f.manifest.id)
    expect(entry).toMatchObject({ source: 'plugin', enabled: false })
    expect(await reopened.secret(f.manifest.id, 'apiKey')).toBe(f.key)
    expect((await reopened.configuration({ ...DEFAULT_SESSION_SETTINGS, mcpServers: [f.manifest.id] })).config).toBeNull()
    await reopened.setEnabled(f.manifest.id, true)
    const launch = await reopened.configuration({ ...DEFAULT_SESSION_SETTINGS, mcpServers: [f.manifest.id] })
    expect(Object.keys(JSON.parse(launch.config!).mcpServers)).toEqual([f.manifest.id])
    expect(Object.values(launch.env)).toContain(f.key)
    expect(launch.config).not.toContain(f.key)
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
