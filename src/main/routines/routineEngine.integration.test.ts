import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Engine } from '../engine/engine.js'
import { EngineManager } from '../engine/engineManager.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { RoutineScheduler } from './routineScheduler.js'
import { writeRoutines } from './routinesStore.js'
import { readRoutineHistory } from './routineHistory.js'

test('routine dispatch records the engine outcome and persistent session id; child scheduling is disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-routine-engine-'))
  await mkdir(join(root, 'dist'))
  await writeFile(
    join(root, 'dist', 'cli.js'),
    `
    const fs=require('node:fs');
    fs.writeFileSync('cron-env.txt',String(JSON.parse(fs.readFileSync(require('path').join(process.env.FIXTURE_CONFIG_HOME,'config.json'),'utf8')).schedule.enabled));
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const input=JSON.parse(line);if(input.type!=='user')return;
      console.log(JSON.stringify({type:'session',sessionId:'persisted-routine-session',model:'fixture',cwd:process.cwd(),tools:[],permissionMode:'ask'}));
      console.log(JSON.stringify({type:'run_completed',exitCode:0,haltReason:'completed',sessionId:'persisted-routine-session',result:'Routine terminée'}));
      setTimeout(()=>process.exit(0),20);
    });
  `,
  )
  const manager = new EngineManager(
    (options) =>
      new Engine({
        appRoot: root, engineRoot: root,
        backendCommand: { file: 'node', args: [join(root, 'dist', 'cli.js')] },
        distribution: { product: 'fixture', cli: 'fixture', slug: 'fixture', envPrefix: 'FIXTURE_', urlScheme: 'fixture', instructionsFile: 'AGENTS.md', bundleId: 'test.fixture' },
        configDir: root,
        ...options,
        extraEnv: async () => ({
          ANTHROPIC_MODEL: 'fixture',
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:1',
        }),
      }),
  )
  try {
    await writeRoutines(root, [
      {
        id: 'fixture',
        cron: '* * * * *',
        prompt: 'Routine contrôlée',
        createdAt: Date.now() - 120000,
        recurring: true,
      },
    ])
    const scheduler = new RoutineScheduler(
      () => [root],
      async (cwd, task) => {
        const session = manager.create(
          cwd,
          DEFAULT_SESSION_SETTINGS,
          undefined,
          {
            kind: 'routine',
            routineId: task.id,
            cron: task.cron,
            firedAt: Date.now(),
          },
        )
        const completion = manager.waitForTurnEnd(session.id)
        await manager.send(session.id, task.prompt, task.prompt)
        return { sessionId: session.id, completion }
      },
    )
    await scheduler.tick()
    let history = await readRoutineHistory(root)
    const deadline = Date.now() + 6000
    while (history[0]?.status !== 'completed' && Date.now() < deadline) {
      await Bun.sleep(20)
      history = await readRoutineHistory(root)
    }
    expect(history[0]).toMatchObject({
      status: 'completed',
      sessionId: 'persisted-routine-session',
    })
    expect(await readFile(join(root, 'cron-env.txt'), 'utf8')).toBe('false')
    expect(manager.list()[0]?.origin?.kind).toBe('routine')
    await scheduler.tick()
    expect(await readRoutineHistory(root)).toHaveLength(1)
  } finally {
    manager.stopAll()
    await rm(root, { recursive: true, force: true })
  }
}, 10000)
