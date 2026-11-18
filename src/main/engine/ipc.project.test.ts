import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain } from 'electron'
import type { MainContext } from '../ipcContext.js'
import type { Worktrees } from '../vcs/worktrees.js'
import { ProjectMetaStore } from '../workspace/projectMeta.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { registerEngineIpc } from './ipc.js'

test('creation loads the destination project instructions, including worktrees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-project-context-'))
  const a = join(root, 'a'), b = join(root, 'b'), copy = join(root, 'copy')
  await Promise.all([a, b, copy].map(path => mkdir(path)))
  const meta = new ProjectMetaStore(join(root, 'meta'))
  meta.update(a, { instructions: 'Instructions de A', sources: ['/sources-a'] })
  const handlers = new Map<string, (...args: any[]) => any>()
  const tree = { id: 'tree', root: a, path: copy, branch: 'task' }
  const ctx = { workspaceAction: (action: () => unknown) => action(), worktreeFor: async (cwd: string) => cwd === copy ? tree : undefined,
    engines: () => ({ create: (cwd: string, settings: unknown, worktree: unknown) => ({ cwd, settings, worktree }) }) } as unknown as MainContext
  registerEngineIpc({ handle: (name: string, fn: (...args: any[]) => any) => handlers.set(name, fn) } as unknown as IpcMain, ctx,
    { worktrees: { create: async () => tree } as unknown as Worktrees, projectMeta: meta })
  const create = (cwd: string, worktree?: object) => handlers.get('engine:create')!(null, { cwd, worktree, settings: { ...DEFAULT_SESSION_SETTINGS, projectInstructions: 'Ne doit pas fuir de la session source' } })
  try {
    expect((await create(a)).settings).toMatchObject({ projectInstructions: 'Instructions de A', extraDirs: ['/sources-a'] })
    expect((await create(b)).settings.projectInstructions).toBeUndefined()
    const isolated = await create(a, {})
    expect(isolated.cwd).toBe(copy)
    expect(isolated.settings.projectInstructions).toBe('Instructions de A')
    expect((await create(copy)).settings.projectInstructions).toBe('Instructions de A')
  } finally { await rm(root, { recursive: true, force: true }) }
})
