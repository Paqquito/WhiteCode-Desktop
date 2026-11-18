import { test, expect } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderStorage } from '../providers/storage.js'
import { TicketsRegistry as McpRegistry, TICKETS_CONNECTOR } from './connectorFixtures.test-support.js'
import { parseConnector } from './connectors.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { RagStore } from '../rag/index.js'

const vault = { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s).reverse(), decryptString: (s: Buffer) => Buffer.from(s).reverse().toString() }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wc-mcp-'))
  const registry = new McpRegistry(root, vault, async () => JSON.stringify({ mcpServers: { rag_one: { command: 'python', args: ['server.py', '--label', 'Corpus'] } } }))
  return { root, registry }
}
test('registry combines corpora, internal and user servers; encrypts configuration and isolates sessions', async () => {
  const { root, registry } = await fixture()
  await registry.save({ id: 'user', label: 'Custom', enabled: true, config: { type: 'http', url: 'https://example.org/mcp', headers: { Authorization: 'Bearer private-secret' } } })
  const views = await registry.list()
  expect(views.map(v => v.id)).toEqual(['tickets', 'user', 'rag_one'])
  expect(JSON.stringify(views)).not.toContain('private-secret')
  expect(await readFile(join(root, 'mcp.json'), 'utf8')).not.toContain('private-secret')
  const a = await registry.configuration({ ...DEFAULT_SESSION_SETTINGS, mcpServers: ['user'] })
  expect(Object.keys(JSON.parse(a.config!).mcpServers)).toEqual(['user'])
  expect(a.config).not.toContain('private-secret')
  expect(Object.values(a.env)).toContain('Bearer private-secret')
  expect((await registry.configuration({ ...DEFAULT_SESSION_SETTINGS, mcpServers: [] })).config).toBeNull()
  expect(Object.keys(JSON.parse((await registry.configuration(DEFAULT_SESSION_SETTINGS)).config!).mcpServers)).toContain('rag_one')
  await registry.setEnabled('user', false)
  expect((await registry.configuration({ ...DEFAULT_SESSION_SETTINGS, mcpServers: ['user'] })).config).toBeNull()
})
test('registry refuses collisions, invalid transports and credential exfiltration', async () => {
  const { registry } = await fixture()
  for (const id of ['rag_one', 'tickets', '__proto__', 'bad space']) {
    await expect(registry.save({ id, label: 'Bad', enabled: true, config: { type: 'http', url: 'https://example.org/mcp' } })).rejects.toThrow()
  }
  await expect(registry.save({ id: 'unsafe', label: 'Bad', enabled: true, config: { type: 'http', url: 'http://example.org/mcp', headers: { Authorization: 'secret' } } })).rejects.toThrow()
  await expect(registry.save({ id: 'unsafe', label: 'Bad', enabled: true, config: { type: 'http', url: 'https://user:secret@example.org/mcp' } })).rejects.toThrow()
  await expect(registry.save({ id: 'unsafe', label: 'Bad', enabled: true, config: { type: 'http', url: 'https://example.org/mcp', headersHelper: 'unexpected command' } as never })).rejects.toThrow()
})

test('concurrent registry edits persist, a connector without its key is omitted and an unavailable vault fails closed', async () => {
  const { root, registry } = await fixture()
  await registry.save({ id: 'user', label: 'Custom', enabled: true, config: { type: 'http', url: 'https://example.org/mcp' } })
  await Promise.all([registry.setEnabled('tickets', false), registry.setEnabled('user', false)])
  expect((await registry.list()).filter(s => ['tickets', 'user'].includes(s.id)).every(s => !s.enabled)).toBe(true)
  const unavailable = new McpRegistry(root, { ...vault, isEncryptionAvailable: () => false }, async () => null)
  const before = await readFile(join(root, 'mcp.json'), 'utf8')
  await expect(unavailable.setEnabled('user', true)).rejects.toThrow('coffre')
  expect(await readFile(join(root, 'mcp.json'), 'utf8')).toBe(before)
  const other = new McpRegistry(await mkdtemp(join(tmpdir(), 'wc-mcp-nokey-')), vault, async () => null)
  const launch = await other.configuration(DEFAULT_SESSION_SETTINGS)
  expect(launch.config).toBeNull()
  expect(launch.notices).toHaveLength(1)
  expect(launch.notices[0]).toStartWith('Tickets')
  expect(launch.notices[0]).toContain('clé API absente')
})

test('connector manifests are validated strictly and never accept arbitrary destinations', () => {
  const base = { id: 'tickets', name: 'Tickets', label: 'Tickets', url: 'https://tickets.example/tickets/mcp' }
  expect(parseConnector(base).auth).toEqual({ secrets: [] })
  for (const bad of [
    { ...base, extra: true },
    { ...base, id: 'rag_tickets' },
    { ...base, url: 'http://example.org/mcp' },
    { ...base, url: 'https://tickets.example/${HOME}/mcp' },
    { ...base, auth: { secrets: [{ name: 'key', label: 'Clé', header: 'Authorization', pattern: '^a$' }] } },
    { ...base, auth: { secrets: [{ name: 'key', label: 'Clé', header: 'X-Key', pattern: 'a+' }] } },
    { ...base, tools: { endpoint: 'https://tickets.example/tickets/api', names: ['list'] } },
    { ...base, links: { issue: 'https://evil.example/{id}' } },
    { ...base, prepare: { write: { tool: 'check', merge: { 'a': '__proto__.x;' } } } },
  ]) expect(() => parseConnector(bad)).toThrow()
})

test('a connector disappears with its plugin and cannot be shadowed by a user server', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wc-mcp-plugin-'))
  let declared = [TICKETS_CONNECTOR]
  const registry = new McpRegistry(root, vault, async () => null, undefined, async () => declared)
  expect((await registry.list()).find(view => view.id === 'tickets')?.source).toBe('plugin')
  await expect(registry.save({ id: 'tickets', label: 'Faux', enabled: true, config: { type: 'http', url: 'https://example.org/mcp' } })).rejects.toThrow('plugin')
  await expect(registry.remove('tickets')).rejects.toThrow('plugin')
  declared = []
  expect((await registry.list()).some(view => view.id === 'tickets')).toBe(false)
  expect((await registry.callTool('tickets', 'list_issues', {})).ok).toBe(false)
})

test('corpus MCP identities survive renames and do not collide for duplicate labels', async () => {
  const { root } = await fixture()
  const store = new RagStore(root, { index: 'index.py', server: 'server.py' })
  store.check = async () => true // Index runtime is independent of registry naming.
  const a = await store.create('Documentation du projet', root, ''), b = await store.create('Documentation du projet', root, '')
  for (const corpus of [a, b]) await store.update(corpus.id, { enabled: true, indexedAt: 1 })
  const ids = Object.keys(JSON.parse((await store.mcpConfig())!).mcpServers)
  expect(ids).toHaveLength(2)
  await store.update(a.id, { name: 'Renamed' })
  expect(Object.keys(JSON.parse((await store.mcpConfig())!).mcpServers)).toEqual(ids)
})
