import { expect, test } from 'bun:test'
import type { IpcMain } from 'electron'
import { parseConnector, type ConnectorManifest } from './connectors.js'
import { registerMcpIpc } from './ipc.js'
import type { ConnectorResult, McpRegistry } from './mcpRegistry.js'

const descriptor = {
  id: 'tickets', name: 'Tickets', label: 'Tickets de test', url: 'https://tickets.example/tickets/mcp',
  tools: { endpoint: 'https://tickets.example/tickets/tools/{tool}', names: ['update', 'prepare', 'list'] },
  writeTools: ['update'],
  prepare: { update: { tool: 'prepare', merge: { proposal: 'changes.fields' }, warnings: 'warnings' } },
}

function fixture(manifest: ConnectorManifest, result: (tool: string) => ConnectorResult = () => ({ ok: true, data: {}, text: '' })) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipc = { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as unknown as IpcMain
  const calls: string[] = [], confirmations: string[] = [], opened: string[] = []
  let allow = false
  const registry = {
    connectors: async () => [manifest],
    callTool: async (_id: string, tool: string) => { calls.push(tool); return result(tool) },
  } as unknown as McpRegistry
  registerMcpIpc(ipc, {
    mcpRegistry: registry,
    confirmWrite: async (tool: string) => { confirmations.push(tool); return allow },
    openExternal: async (url: string) => { opened.push(url) },
  })
  return {
    calls, confirmations, opened, allowWrites: () => { allow = true },
    call: (tool: string) => handlers.get('connector:call')!(null, { id: manifest.id, tool, args: { changes: { title: 'Ticket' } } }),
    open: (url: unknown): Promise<void> => handlers.get('panel:open-url')!(null, url),
  }
}

test('a preparation tool must be read only in a connector manifest', () => {
  expect(() => parseConnector({ ...descriptor, writeTools: ['update', 'prepare'] })).toThrow()
})

test('a direct write cannot skip confirmation by also being named as a preparation tool', async () => {
  const manifest = { ...parseConnector(descriptor), writeTools: ['update', 'prepare'] }
  const f = fixture(manifest)
  expect((await f.call('prepare')).ok).toBe(false)
  expect(f.confirmations).toEqual(['prepare'])
  expect(f.calls).toEqual([])
})

test('an unsafe writing preparation is rejected before either mutation can run', async () => {
  const manifest = { ...parseConnector(descriptor), writeTools: ['update', 'prepare'] }
  const f = fixture(manifest)
  f.allowWrites()
  expect((await f.call('update')).ok).toBe(false)
  expect(f.calls).toEqual([])
})

test('a failed preparation blocks the requested write and its confirmation', async () => {
  const f = fixture(parseConnector(descriptor), tool => tool === 'prepare'
    ? { ok: false, error: 'Préparation indisponible.' }
    : { ok: true, data: {}, text: 'Applied' })
  f.allowWrites()
  const result = await f.call('update')
  expect(result.ok).toBe(false)
  expect(result.error).toContain('indisponible')
  expect(f.calls).toEqual(['prepare'])
  expect(f.confirmations).toEqual([])
})

test('a read only preparation does not itself ask for write approval', async () => {
  const f = fixture(parseConnector(descriptor))
  expect((await f.call('prepare')).ok).toBe(true)
  expect(f.calls).toEqual(['prepare'])
  expect(f.confirmations).toEqual([])
})

for (const url of [
  'javascript:alert(1)', 'file:///C:/Windows/System32/cmd.exe', 'http://tickets.example/issues/42',
  'https://alice:password@tickets.example/issues/42', 'https://alice@tickets.example/issues/42',
]) {
  test(`panel links refuse unsafe external navigation: ${url}`, async () => {
    const f = fixture(parseConnector(descriptor))
    await expect(f.open(url)).rejects.toThrow()
    expect(f.opened).toEqual([])
  })
}

test('a normal HTTPS panel link is opened once', async () => {
  const f = fixture(parseConnector(descriptor))
  await f.open('https://tickets.example/issues/42')
  expect(f.opened).toEqual(['https://tickets.example/issues/42'])
})
