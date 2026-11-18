import { expect, test } from 'bun:test'
import { chmod, copyFile, link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RagStore, type IndexProgress } from './index.js'

test('RAG subprocess cancellation kills its descendants; only a successful exit persists the index', async () => {
  const root = await mkdtemp(join(tmpdir(), 't54-rag-process-'))
  try {
    const interpreter = join(root, 'rag-env', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    await mkdir(join(root, 'rag-env', process.platform === 'win32' ? 'Scripts' : 'bin'), { recursive: true })
    await link(process.execPath, interpreter).catch(() => copyFile(process.execPath, interpreter))
    if (process.platform !== 'win32') await chmod(interpreter, 0o755)
    const script = join(root, 'index.js'), rags = new RagStore(root, { index: script, server: '' })
    // Use the real process launcher with a tiny JS fixture instead of requiring Python/Chroma.
    rags.check = async () => true
    const events: IndexProgress[] = []
    const done = `console.log(JSON.stringify({event:'done',indexed:1,skipped:0,removed:0,chunks:1,total_in_store:1}));`
    await writeFile(script, done)
    const successful = await rags.create('success', root, '')
    await rags.index(successful.id, event => events.push(event))
    expect((await rags.list()).find(c => c.id === successful.id)?.indexedAt).not.toBeNull()
    expect(events.at(-1)?.kind).toBe('done')
    await writeFile(script, done + 'process.exit(1);')
    const failed = await rags.create('failure', root, '')
    await rags.index(failed.id, event => events.push(event))
    expect((await rags.list()).find(c => c.id === failed.id)?.indexedAt).toBeNull()
    expect(events.at(-1)?.kind).toBe('error')
    await writeFile(script, `const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log(JSON.stringify({event:'file',path:JSON.stringify([process.pid,child.pid]),position:1,total:1}));setInterval(()=>{},1000);`)
    const cancelled = await rags.create('cancelled', root, ''), controller = new AbortController()
    let started!: (pids: number[]) => void
    const launch = new Promise<number[]>(resolve => started = resolve)
    const pending = rags.index(cancelled.id, event => {
      events.push(event); if (event.kind === 'file') started(JSON.parse(event.path))
    }, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
    const pids = await Promise.race([launch, pending.then(() => { throw new Error('Process fixture did not start') })])
    expect(pids).toHaveLength(2)
    controller.abort(); await pending
    const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
    for (let i = 0; i < 100 && pids.some(alive); i++) await new Promise(resolve => setTimeout(resolve, 20))
    expect(pids.some(alive)).toBe(false)
    expect((await rags.list()).find(c => c.id === cancelled.id)?.indexedAt).toBeNull()
    expect(events.at(-1)?.kind).toBe('error')
  } finally { await rm(root, { recursive: true, force: true }) }
}, 20000)
