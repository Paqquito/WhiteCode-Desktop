import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L09 routine lifecycle, history, errors and focus in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l09-'))
  const captures = join(desktop, 'tmp/l09')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {RoutinesDialog} from ${JSON.stringify(join(renderer, 'dialogs/RoutinesDialog.tsx'))};
const {ipcRenderer}=window.require('electron');let tasks=[],fail=false,setShow,opened=null;
window.engine={listRoutines:async()=>structuredClone(tasks),routineHistory:async()=>[{id:'run1',routineId:'deleted',prompt:'Revue quotidienne du projet',firedAt:Date.now()-60000,status:'completed',sessionId:'session1'}],addRoutine:async(cwd,draft)=>{if(fail)throw Error('Disque indisponible');const value={...draft,id:'routine1',createdAt:Date.now()};tasks.push(value);return value},updateRoutine:async(cwd,id,patch)=>{tasks=tasks.map(t=>t.id===id?{...t,...patch}:t)},removeRoutine:async(cwd,id)=>{tasks=tasks.filter(t=>t.id!==id)}};
function Body(){const [show,update]=React.useState(true);setShow=update;return <><button id="opener" onClick={()=>update(true)}>Routines</button>{show&&<RoutinesDialog cwd="/projets/fixture" onClose={()=>update(false)} onOpenSession={id=>{opened=id}}/>}</>}
createRoot(document.getElementById('root')).render(<Body/>);
const answer=async ok=>{const end=Date.now()+4000;while(!document.querySelector('.confirm-dialog[open]')){if(Date.now()>end)throw Error('confirmation absente');await new Promise(r=>setTimeout(r,10))}document.querySelector(ok?'.confirm-dialog .confirm-accept':'.confirm-dialog .confirm-cancel').click();await new Promise(r=>setTimeout(r,10))};const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('Timeout '+fn);await sleep(10)}}
function check(ok,message){if(!ok)throw Error(message)}
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.getAttribute('aria-label')===label);
function type(el,value){const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
async function run(){await until(()=>document.body.textContent.includes('Aucune routine dans ce projet'));check(button('Ajouter').disabled,'empty prompt accepted');type(document.querySelector('textarea'),'Revue du projet');await sleep(20);fail=true;button('Ajouter').click();await until(()=>document.querySelector('[role=alert]'));check(document.querySelector('textarea').value==='Revue du projet','failed save lost draft');fail=false;button('Ajouter').click();await until(()=>button('Modifier'));button('Mettre en pause').click();await until(()=>document.body.textContent.includes('En pause'));check(tasks[0].paused,'pause not saved');button('Reprendre').click();await until(()=>button('Mettre en pause'));button('Modifier').click();await until(()=>button('Enregistrer'));type(document.querySelector('textarea'),'Revue mise à jour');await sleep(20);button('Enregistrer').click();await until(()=>document.querySelector('.routine-prompt')?.textContent==='Revue mise à jour');check(tasks[0].id==='routine1','edit changed identity');await ipcRenderer.invoke('capture','planning',1000);
type(document.querySelector('input[type=search]'),'absent');await until(()=>document.body.textContent.includes('Aucune routine ne correspond'));type(document.querySelector('input[type=search]'),'');await until(()=>button('Retirer'));button('Retirer').click();await until(()=>button('Confirmer la suppression'));button('Conserver').click();await sleep(20);check(tasks.length===1,'cancelled removal deleted task');button('Retirer').click();await until(()=>button('Confirmer la suppression'));button('Confirmer la suppression').click();await until(()=>!tasks.length);button('Historique').click();await until(()=>button('Ouvrir la conversation'));await ipcRenderer.invoke('capture','history',1000);button('Ouvrir la conversation').click();await until(()=>!document.querySelector('dialog'));check(opened==='session1','history opened wrong conversation');document.getElementById('opener').focus();button('Routines').click();await until(()=>document.querySelector('dialog[open]'));type(document.querySelector('textarea'),'Brouillon');await sleep(20);document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));await answer(false);check(document.querySelector('dialog[open]'),'escape discarded draft');document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));await answer(true);await until(()=>!document.querySelector('dialog'));check(document.activeElement.id==='opener','focus not returned');button('Routines').click();await until(()=>document.querySelector('dialog[open]'));await ipcRenderer.invoke('capture','narrow',520);const panel=document.querySelector('dialog');check(panel.scrollWidth<=panel.clientWidth+1,'horizontal overflow');return true}
run().then(()=>ipcRenderer.send('done',{ok:true}),error=>ipcRenderer.send('done',{ok:false,error:String(error.stack)}));

`)
  const built = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(built.success).toBe(true)
  if (!built.success) throw new Error(built.logs.join('\n'))
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>#root{height:100vh}.panel{height:100%}</style><div id="root"></div><script src="test.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const {app,BrowserWindow,ipcMain}=require('electron');app.disableHardwareAcceleration();
    app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
    ipcMain.handle('system-theme',(_event,value)=>{require('electron').nativeTheme.themeSource=value});
    ipcMain.handle('capture',async(event,name,width)=>{const win=BrowserWindow.fromWebContents(event.sender);win.setSize(width+1,900);await new Promise(r=>setTimeout(r,40));win.setSize(width,900);await new Promise(r=>setTimeout(r,130));const image=await event.sender.capturePage();require('fs').writeFileSync(${JSON.stringify(captures)}+'/'+name+'.png',image.toPNG())});
    app.whenReady().then(()=>{const win=new BrowserWindow({show:true,width:1100,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});win.loadFile(${JSON.stringify(join(directory, 'index.html'))})});
    ipcMain.on('done',(_,result)=>{console.log(JSON.stringify(result));app.exit(result.ok?0:1)});setTimeout(()=>app.exit(2),20000);
  `)
  const executable = process.platform === 'win32' ? join(desktop, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin' ? join(desktop, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : join(desktop, 'node_modules/electron/dist/electron')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
  const watchdog = setTimeout(() => child.kill(), 25000)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(watchdog))
  if (code !== 0) throw new Error(output)
  expect(output).toContain('"ok":true')
}, 30000)
