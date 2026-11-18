import { expect, test } from 'bun:test'
import type { IpcMain } from 'electron'
import type { MainContext } from '../ipcContext.js'
import { registerTerminalIpc } from './ipc.js'
import { Terminals } from './terminal.js'

test('the terminal IPC resolves catalogue IDs in main and refuses renderer-supplied processes', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipc = { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) } as unknown as IpcMain
  const ctx = { workspaceAction: (action: () => unknown) => action() } as MainContext
  const launches: { file: string; args: string[] }[] = [], resolutions: string[] = []
  const terminals = new Terminals(() => null, (file, args) => {
    if (!Array.isArray(args)) throw Error('Expected argument array')
    launches.push({ file, args })
    return { write() {}, resize() {}, kill() {}, onData: () => ({ dispose() {} }), onExit: () => ({ dispose() {} }) }
  })
  registerTerminalIpc(ipc, ctx, { terminals, targets: {
    list: async () => ({ targets: [{ id: 'known', label: 'VM', description: 'reader@vm.test:22' }] }),
    resolve: async id => {
      resolutions.push(id)
      if (id !== 'known') throw Error('Cible absente')
      return { key: 'vm:22:reader', file: 'safe-system-ssh', args: ['--', 'reader@vm.test'] }
    },
  } })
  const invoke = async (channel: string, payload?: unknown) => handlers.get(channel)!(undefined, payload)
  const payload = { cwd: '/project', cols: 80, rows: 24 }
  try {
    await expect(invoke('terminal:create', { ...payload, remote: { file: 'malicious', args: [] } })).rejects.toThrow('invalide')
    await expect(invoke('terminal:create', { ...payload, remote: 'deleted' })).rejects.toThrow('absente')
    expect(launches).toEqual([])
    const id = await invoke('terminal:create', { ...payload, remote: 'known' })
    expect(launches).toEqual([{ file: 'safe-system-ssh', args: ['--', 'reader@vm.test'] }])
    expect(await invoke('terminal:attach', { cwd: '/project', remote: 'known' })).toEqual({ id, scrollback: '' })
    expect(await invoke('terminal:attach', { cwd: '/other', remote: 'known' })).toBeNull()
    expect(resolutions).toEqual(['deleted', 'known', 'known', 'known'])
    expect(await invoke('terminal:targets')).toEqual({ targets: [{ id: 'known', label: 'VM', description: 'reader@vm.test:22' }] })
  } finally { terminals.killAll() }
})
