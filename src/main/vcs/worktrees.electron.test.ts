import { expect, test } from 'bun:test'
import { execFileSync, spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, writeFile, readFile, access, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'

test('production Electron IPC creates a worktree, runs its real terminal and cleans it only after restart', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const dir = await mkdtemp(join(tmpdir(), 'sample-worktree-ipc-'))
  const repo = join(dir, 'repo'), path = join(dir, 'worktree'), appDir = join(dir, 'app', 'desktop')
  await mkdir(repo)
  await mkdir(join(appDir, 'dist', 'renderer'), { recursive: true })
  await symlink(join(desktop, 'node_modules'), join(appDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, windowsHide: true, encoding: 'utf8' }).trim()
  git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test')
  await writeFile(join(repo, 'note.txt'), 'original'); git('add', '.'); git('commit', '-m', 'initial')
  for (const name of ['index.js', 'preload.js', 'distribution.json']) await copyFile(join(desktop, 'dist', name), join(appDir, 'dist', name))
  // The real main/preload run with an empty renderer, no provider requests or user profile.
  await writeFile(join(appDir, 'dist', 'renderer', 'index.html'), '<meta charset="utf-8"><title>Worktree IPC test</title>')
  await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: 'worktree-ipc-test', main: 'check.cjs' }))
  const renderer = `async function run(phase) {
    const api=window.engine, repo=${JSON.stringify(repo)}, path=${JSON.stringify(path)}, settings=${JSON.stringify(DEFAULT_SESSION_SETTINGS)};
    let assertions=0;const check=(ok,message)=>{assertions++;if(!ok)throw new Error(message)};
    const rejects=async(fn,message)=>{try{await fn();throw new Error('unexpected success')}catch(error){check(String(error).includes(message),String(error))}};
    if(phase===1){
      check((await api.listMcp()).length===0,'initial registry must be empty');
      await api.saveMcp({id:'ipc',label:'IPC',enabled:true,config:{type:'http',url:'https://example.org/mcp',headers:{Authorization:'Bearer ipc-secret'}}});
      check((await api.getMcp('ipc')).config.headers.Authorization==='Bearer ipc-secret','MCP credentials lost in IPC');
      await api.enableMcp('ipc',false);
      const direct=await api.createSession(repo,settings);
      const isolated=await api.createSession(repo,settings,{path,branch:'session-ipc',base:'HEAD',existingBranch:false});
      check(isolated.cwd===path&&isolated.worktree.branch==='session-ipc','wrong session cwd/metadata');
      check((await api.liveSessions()).length===2,'sessions not independent');
      check((await api.writeFile(path,path+'/note.txt','isolated')).ok,'write failed');
      check((await api.readFile(repo,repo+'/note.txt')).text==='original','original project changed');
      check((await api.gitSummary(path)).branch==='session-ipc','wrong review branch');
      await api.gitAction(path,{kind:'stage',path:'note.txt'});
      check((await api.gitSummary(path)).files[0].staged,'IPC stage failed');
      await api.gitAction(path,{kind:'unstage',path:'note.txt'});
      check(!(await api.gitSummary(path)).files[0].staged,'IPC unstage failed');
      await api.gitAction(path,{kind:'stage',path:'note.txt'});
      await api.gitAction(path,{kind:'commit',message:'isolated commit'});
      check((await api.gitSummary(path)).files.length===0,'IPC commit failed');
      check((await api.readFile(repo,repo+'/note.txt')).text==='original','commit altered main worktree');
      check((await api.gitWorkflow(path)).branch==='session-ipc','workflow IPC branch mismatch');
      const terminal=await api.createTerminal(path,80,24);
      await rejects(()=>api.gitWorkflowAction(path,{expectedBranch:'session-ipc',expectedHead:'',action:{kind:'switch',branch:'main'}}),'terminaux');
      await api.writeTerminal(terminal,${JSON.stringify(process.platform === 'win32' ? 'echo isolated>terminal.txt\r' : 'printf isolated > terminal.txt\n')});
      const end=Date.now()+5000;while(!(await api.readFile(path,path+'/terminal.txt')).ok){if(Date.now()>end)throw new Error('PTY write timeout');await new Promise(r=>setTimeout(r,30))}
      check(!(await api.readFile(repo,repo+'/terminal.txt')).ok,'terminal wrote to main project');
      await rejects(()=>api.removeWorktree(isolated.worktree.id),'terminaux');
      await api.killTerminal(terminal);
      await rejects(()=>api.removeWorktree(isolated.worktree.id),'utilisé');
      // Points de restauration : le canal doit atteindre le processus
      // principal. Sans tour enregistre, la seule reponse juste est un refus.
      check(typeof api.listRestorePoints==='function'&&typeof api.rewindFiles==='function','restore point API missing');
      await rejects(()=>api.listRestorePoints(direct.id),'pas encore de tour');
      await rejects(()=>api.rewindFiles(direct.id,'00000000-0000-0000-0000-000000000000',true),'pas encore de tour');
    } else {
      check((await api.getMcp('ipc')).config.headers.Authorization==='Bearer ipc-secret','encrypted MCP not restored');
      check(!(await api.listMcp()).find(s=>s.id==='ipc').enabled,'MCP activation not restored');
      await api.removeMcp('ipc');check(!(await api.listMcp()).some(s=>s.id==='ipc'),'MCP not removed');
      const trees=await api.listWorktrees();check(trees.length===1&&trees[0].path===path,'registry not restored');
      await rejects(()=>api.removeWorktree(trees[0].id),'fichiers');
    }
    return assertions;
  }`
  await writeFile(join(appDir, 'check.cjs'), `
    const {app}=require('electron');app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});
    app.on('browser-window-created',(_event,win)=>{win.hide();win.webContents.once('did-finish-load',async()=>{
      try {
        let assertions=await win.webContents.executeJavaScript(${JSON.stringify(`(${renderer})(Number(new URLSearchParams(location.search).get('phase')) || PHASE)`)}.replace('PHASE',process.env.WORKTREE_TEST_PHASE));
        if(process.env.WORKTREE_TEST_PHASE==='2') {
          const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(join(path, 'note.txt'))},'isolated');fs.unlinkSync(${JSON.stringify(join(path, 'terminal.txt'))});
          await win.webContents.executeJavaScript('(async()=>{const tree=(await window.engine.listWorktrees())[0];await window.engine.removeWorktree(tree.id);if((await window.engine.listWorktrees()).length)throw new Error("registry not cleared")})()');
          assertions++;
        }
        console.log('CHECKED '+JSON.stringify({assertions}));app.exit(0);
      }catch(error){console.error(String(error.stack));app.exit(1)}
    })});
    try{require('./dist/index.js')}catch(error){console.error(error.stack);app.exit(1)}setTimeout(()=>app.exit(2),20000);
  `)
  const executable = process.platform === 'win32' ? join(desktop, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin' ? join(desktop, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : join(desktop, 'node_modules/electron/dist/electron')
  for (const phase of ['1', '2']) {
    const env: NodeJS.ProcessEnv = { ...process.env, WORKTREE_TEST_PHASE: phase }
    delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(executable, [appDir], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
    const watchdog = setTimeout(() => child.kill(), 25000)
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(watchdog))
    if (code !== 0) throw new Error(`IPC phase ${phase} failed (${code}): ${output}`)
    expect(output).toContain(`"assertions":${phase === '1' ? 19 : 6}`)
    expect(await readFile(join(dir, 'profile', 'mcp.json'), 'utf8')).not.toContain('ipc-secret')
  }
  await expect(access(path)).rejects.toThrow()
  expect(git('rev-parse', 'session-ipc')).not.toBe(git('rev-parse', 'main'))
}, 55000)
