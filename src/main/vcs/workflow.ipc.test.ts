import { test, expect } from 'bun:test'
import type { IpcMain } from 'electron'
import type { MainContext } from '../ipcContext.js'
import type { Worktrees } from './worktrees.js'
import { registerVcsIpc } from './ipc.js'

test('Git IPC checks background turns and terminals before executing a mutation', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipc = { handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) } as unknown as IpcMain
  let busy = true
  const terminals = ['terminal']
  let queue: Promise<unknown> = Promise.resolve()
  const ctx = {
    workspaceAction: <T>(action: () => T | Promise<T>) => { const next = queue.then(action); queue = next.catch(() => {}); return next },
    engines: () => ({ withIdleWorkspace: async (action: () => Promise<unknown>) => { if (busy) throw new Error('tours en cours'); return action() } }),
  } as unknown as MainContext
  const worktrees = {} as Worktrees
  registerVcsIpc(ipc, ctx, { worktrees, busyTerminals: () => terminals })
  const invoke = (name: string, payload: unknown) => handlers.get(name)!(null, payload)
  await expect(invoke('git:action', { cwd: '/unused', action: { kind: 'commit', message: 'x' } })).rejects.toThrow('tours en cours')
  await expect(invoke('git:workflow-action', { cwd: '/unused', request: { action: { kind: 'push' } } })).rejects.toThrow('tours en cours')
  busy = false
  await expect(invoke('git:workflow-action', { cwd: '/unused', request: { action: { kind: 'switch', branch: 'main' } } })).rejects.toThrow('terminaux')
})
