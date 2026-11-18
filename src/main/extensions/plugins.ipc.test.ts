import { expect, test } from 'bun:test'
import type { IpcMain } from 'electron'
import type { MainContext } from '../ipcContext.js'
import { registerExtensionsIpc, registerMcpIpc } from './ipc.js'
import type { Extensions } from './plugins.js'
import type { McpRegistry } from './mcpRegistry.js'
import { TICKETS_CONNECTOR } from './connectorFixtures.test-support.js'

test('Tickets validation shows the proposed commit and warnings before any mutation', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipc = { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) } as unknown as IpcMain
  const calls: { tool: string; args: unknown; cwd: string | undefined }[] = []
  const confirmations: unknown[] = []; let allow = false
  const registry = { connectors: async () => [TICKETS_CONNECTOR], callTool: async (id: string, tool: string, args: unknown, _timeout: number, cwd?: string) => {
    expect(id).toBe('tickets')
    calls.push({ tool, args, cwd }); return { ok: true, data: tool === 'prepare_validation' ? { proposal: { 'Commit #': 'a'.repeat(40) }, warnings: ['Commit non poussé.'] } : {}, text: 'Applied' }
  } } as unknown as McpRegistry
  registerMcpIpc(ipc, { mcpRegistry: registry, confirmWrite: async (_tool, args) => { confirmations.push(args); return allow }, openExternal: async () => {} })
  const payload = { id: 'tickets', tool: 'update_issues', args: { issue_ids: [25100], changes: { status: 'Validation' } }, cwd: 'workspace' }
  expect((await handlers.get('connector:call')!(null, payload)).ok).toBe(false)
  expect(calls.map(c => c.tool)).toEqual(['prepare_validation'])
  expect(confirmations[0]).toEqual({ modifications: { issue_ids: [25100], changes: { status: 'Validation', custom_fields: { 'Commit #': 'a'.repeat(40) } } }, avertissements: ['Commit non poussé.'] })
  allow = true; expect((await handlers.get('connector:call')!(null, payload)).ok).toBe(true)
  expect(calls.at(-1)!.tool).toBe('update_issues')
  // Lecture : aucune confirmation ; connecteur inconnu : refus lisible.
  const before = confirmations.length
  expect((await handlers.get('connector:call')!(null, { id: 'tickets', tool: 'list_issues', args: {} })).ok).toBe(true)
  expect(confirmations).toHaveLength(before)
  expect((await handlers.get('connector:call')!(null, { id: 'autre', tool: 'list_issues', args: {} })).ok).toBe(false)
})

test('extension IPC preserves chosen refs and prevents removal during an active turn', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipc = { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) } as unknown as IpcMain
  let busy = true, removed = '', selected: unknown
  const ctx = { workspaceAction: (action: () => Promise<unknown>) => action(), toRenderer: () => {},
    engines: () => ({ withIdleWorkspace: async (action: () => Promise<unknown>, operation: string) => { if (busy) throw new Error(operation); return action() } }),
  } as unknown as MainContext
  const extensions = { remove: async (id: string) => { removed = id }, install: async (id: string, _progress: unknown, ref: string) => { selected = { id, ref }; return true } } as unknown as Extensions
  registerExtensionsIpc(ipc, ctx, { extensions })
  await expect(handlers.get('ext:remove')!(null, 'fixture')).rejects.toThrow('désinstallation')
  expect(removed).toBe('')
  busy = false; await handlers.get('ext:remove')!(null, 'fixture'); expect(removed).toBe('fixture')
  expect(await handlers.get('ext:install')!(null, { id: 'fixture', ref: 'v1' })).toBe(true)
  expect(selected).toEqual({ id: 'fixture', ref: 'v1' })
})

test('an empty preparation proposal preserves manual fields and does not inject null changes', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const writes: unknown[] = []
  const registry = { connectors: async () => [TICKETS_CONNECTOR], callTool: async (_id: string, tool: string, args: unknown) => {
    if (tool === 'prepare_validation') return { ok: true, data: { proposal: null, warnings: [] }, text: '' }
    writes.push(args); return { ok: true, data: {}, text: 'Applied' }
  } } as unknown as McpRegistry
  registerMcpIpc({ handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) } as unknown as IpcMain,
    { mcpRegistry: registry, confirmWrite: async () => true, openExternal: async () => {} })
  for (const fields of [undefined, { 'Commit #': 'manual-commit', Severity: 'S2' }]) {
    const args = { issue_ids: [25100], changes: { status: 'Rejected', ...(fields ? { custom_fields: fields } : {}) } }
    expect((await handlers.get('connector:call')!(null, { id: 'tickets', tool: 'update_issues', args })).ok).toBe(true)
    expect(writes.at(-1)).toEqual(args)
  }
})
