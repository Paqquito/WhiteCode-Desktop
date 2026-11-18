import { expect, test } from 'bun:test'
import { McpSession } from './mcpSession.js'
import { LocalMcpService } from './localMcp.js'
import { McpRegistry } from './mcpRegistry.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('a 40-character server ID accepted by the registry opens and routes long tool names', async () => {
  const id = 's'.repeat(40), tool = 'long_tool_'.repeat(10)
  const service = new LocalMcpService(id, {
    catalogue: async () => [{ name: tool, description: 'Fixture', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, openWorldHint: false } }],
    call: async () => ({ ok: true, data: null, text: 'Long name routed successfully' }),
  })
  const root = await mkdtemp(join(tmpdir(), 'mcp-server-name-'))
  const registry = new McpRegistry(root, { isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString() }, async () => null, async () => null)
  const session = new McpSession(async () => false), signal = new AbortController().signal
  try {
    await registry.save({ id, label: 'Long name', enabled: true, config: (await service.configuration())! })
    const launch = await registry.configuration({ ...DEFAULT_SESSION_SETTINGS, mcpServers: [id] })
    const notices: string[] = []
    await session.open(launch.config, launch.env, signal, text => notices.push(text))
    expect(notices).toEqual([])
    expect(session.toolNames).toHaveLength(1)
    const qualified = session.toolNames[0]!
    expect(qualified).toMatch(/^[a-z][a-zA-Z0-9_-]{0,63}$/)
    expect(session.toolForName(qualified)).toEqual({ server: id, name: tool })
    expect(await session.call({ server: id, method: 'tools/call', params: { name: tool } }, signal)).toMatchObject({ isError: false, content: [{ type: 'text', text: 'Long name routed successfully' }] })
  } finally { await session.close(); service.close() }
})

test('invalid server IDs remain rejected with the application name', async () => {
  const session = new McpSession(async () => false), signal = new AbortController().signal
  try {
    for (const name of ['', 'bad space', 'a'.repeat(41), '__proto__', 'constructor', 'prototype']) {
      await expect(session.open(JSON.stringify({ mcpServers: { [name]: {} } }), {}, signal, () => {})).rejects.toThrow(`Nom de serveur incompatible avec desktop : ${name}`)
    }
  } finally { await session.close() }
})

test('SDK qualified names preserve numeric tools and resolve normalized, long and colliding names to the original tool', () => {
  const session = new McpSession(async () => true)
  const names = ['FindDocs', 'FindCode', 'admin.tools.list', 'admin_tools_list', 'x'.repeat(128)]
  session.servers.push({ name: 'app', tools: names.map(name => ({ name, inputSchema: { type: 'object' } })) })
  const qualified = session.toolNames
  expect(qualified).toContain('cnx_app_FindDocs')
  expect(qualified).toContain('cnx_app_FindCode')
  expect(new Set(qualified).size).toBe(names.length)
  for (const [index, name] of qualified.entries()) {
    expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
    expect(session.toolForName(name)).toEqual({ server: 'app', name: names[index]! })
  }
  expect(session.toolForName('not-declared')).toBeUndefined()
})
