import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L11 optional modules: real preferences, activity IPC, restart, errors and keyboard in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = join(desktop, 'src/renderer')
  const directory = await mkdtemp(join(tmpdir(), 'sample-l11-'))
  const captures = join(desktop, 'tmp/l11')
  await mkdir(captures, { recursive: true })
  await mkdir(join(directory, 'projects/project'), { recursive: true })
  const timestamp = new Date(); timestamp.setDate(timestamp.getDate() - 10)
  await writeFile(join(directory, 'projects/project/session.jsonl'), JSON.stringify({ type: 'user', uuid: 'one', timestamp: timestamp.toISOString(), message: { content: 'Contenu de recette local' } }))
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `
import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {SettingsDialog} from ${JSON.stringify(join(renderer, 'settings/SettingsDialog.tsx'))};
import {PreferencesProvider,usePreferences} from ${JSON.stringify(join(renderer, 'state/usePreferences.tsx'))};
let api, checks=0, eagerChange=false;
function Body(){api=usePreferences();const [open,show]=React.useState(eagerChange);
React.useLayoutEffect(()=>{if(api.ready&&eagerChange){eagerChange=false;toggle('Activer le bilan d’activité local').click()}},[api.ready]);
return <><button id="opener" onClick={()=>show(true)}>Paramètres</button>{open&&<SettingsDialog initialTab="modules" provider={{}} corpora={{}} extensions={{}} reducedTools={false} onReducedTools={()=>{}} onMcpServers={()=>{}} projects={[]} onUnarchive={()=>{}} onOpenSession={()=>{}} onClose={()=>show(false)}/>}</>}
let root=createRoot(document.getElementById('root'));const render=()=>root.render(<PreferencesProvider><Body/></PreferencesProvider>);render();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){const end=Date.now()+5000;while(!fn()){if(Date.now()>end)throw Error('Timeout '+fn);await sleep(10)}}
function check(value,message){checks++;if(!value)throw Error(message)}
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.getAttribute('aria-label')===label);
const toggle=label=>[...document.querySelectorAll('label')].find(e=>e.textContent===label).querySelector('input');
function period(value){const el=document.querySelector('.activity-controls select');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))}
// During IPC the button is temporarily labelled « Enregistrement… ».
// Les préférences s'enregistrent dès qu'on les change : on attend la fin de l'écriture.
async function save(){await sleep(20);await until(()=>!api.saving)}
async function open(){button('Paramètres').focus();button('Paramètres').click();await until(()=>document.querySelector('dialog[open]'))}
async function run(){
await until(()=>api?.ready);await open();
check(!button('Bilan local'),'activity enabled by default');check(document.body.textContent.includes('Publication de sites · Différée'),'publication status missing');check(document.body.textContent.includes('Travail bureautique spécialisé · Différé'),'office status missing');
try{await window.engine.personalActivity(30);throw Error('disabled read accepted')}catch(error){check(String(error).includes('désactivé'),'disabled backend accepted read')}
toggle('Activer le bilan d’activité local').click();await save();check(api.value.modules.activity,'activity not applied');await window.test.capture('modules',1000);
button('Modules optionnels').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await until(()=>document.querySelector('.activity-totals'));check(document.activeElement.textContent==='Bilan local','keyboard navigation failed');
check(document.querySelector('.activity-totals').textContent.includes('Messages utilisateur1'),'real activity missing');document.querySelector('.activity-days summary').click();check(document.querySelectorAll('tbody tr').length===30,'wrong day count');await window.test.capture('activity',1000);
period('7');await until(()=>document.body.textContent.includes('Aucun message utilisateur daté'));check(!document.querySelector('.activity-totals').textContent.includes('Messages utilisateur1'),'stale summary');
await window.test.mode('fail');button('Actualiser le bilan').click();await until(()=>document.querySelector('[role=alert]'));check(document.body.textContent.includes('Lecture indisponible'),'error hidden');check(document.querySelector('.activity-totals')?.textContent.includes('Messages utilisateur0'),'failed refresh lost last result');await window.test.mode('normal');button('Actualiser le bilan').click();await until(()=>document.body.textContent.includes('Aucun message utilisateur daté')&&!document.querySelector('[role=alert]'));
await window.test.mode('late-error');period('30');await until(()=>document.querySelector('.activity-days'));period('7');await sleep(25);period('90');await until(()=>document.querySelector('.activity-days'));await sleep(250);check(!document.querySelector('[role=alert]')&&document.querySelectorAll('tbody tr').length===90,'late response replaced current period');await window.test.mode('normal');
await api.save({...api.value,theme:'dark',reducedMotion:true});await until(()=>document.documentElement.dataset.theme==='dark');await window.test.capture('activity-narrow-dark',520);check(document.querySelector('.settings').scrollWidth<=innerWidth,'narrow overflow');await window.test.capture('activity-320',320);check(document.querySelector('.settings').scrollWidth<=innerWidth,'320 overflow');
await window.test.escape();await until(()=>!document.querySelector('dialog'));check(document.activeElement.id==='opener','focus not restored');
root.unmount();root=createRoot(document.getElementById('root'));render();await until(()=>api?.ready&&button('Paramètres'));check(api.value.modules.activity,'restart lost preferences');
await open();toggle('Activer le bilan d’activité local').click();await save();check(!button('Bilan local'),'disabled activity still accessible');check(!(await window.engine.getPreferences()).value.modules.activity,'disable did not persist');await window.test.escape();await until(()=>!document.querySelector('dialog'));
eagerChange=true;root.unmount();root=createRoot(document.getElementById('root'));render();await until(()=>api?.ready&&!eagerChange);await save();check(api.value.modules.activity,'first edit lost when preferences became ready');
return checks}
run().then(checks=>window.test.done({ok:true,checks}),error=>window.test.done({ok:false,error:String(error.stack)}));
`)
  const mainEntry = join(directory, 'main.ts')
  await writeFile(mainEntry, `
import {app,BrowserWindow,ipcMain} from 'electron';
import {PreferencesStore} from ${JSON.stringify(join(desktop, 'src/main/preferences/store.ts'))};
import {readPersonalActivity} from ${JSON.stringify(join(desktop, 'src/main/session/personalActivity.ts'))};
import {writeFileSync} from 'node:fs';
app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
let store=new PreferencesStore(${JSON.stringify(join(directory, 'preferences.json'))}),mode='normal';
ipcMain.handle('preferences:get',()=>({value:store.get(),error:null,notificationsSupported:false}));
ipcMain.handle('preferences:save',async(_,value)=>{await new Promise(resolve=>setTimeout(resolve,50));await store.save(value);store=new PreferencesStore(${JSON.stringify(join(directory, 'preferences.json'))});return store.get()});
ipcMain.handle('activity:read',async(_,period)=>{if(mode==='fail')throw Error('Lecture indisponible');if(mode==='late-error'&&period===7){await new Promise(r=>setTimeout(r,180));throw Error('Ancienne erreur')}return readPersonalActivity(${JSON.stringify(join(directory, 'projects'))},period,store.get().modules.activity)});
ipcMain.handle('test:mode',(_,value)=>{mode=value});
ipcMain.handle('test:escape',event=>{event.sender.sendInputEvent({type:'keyDown',keyCode:'Escape'});event.sender.sendInputEvent({type:'keyUp',keyCode:'Escape'})});
ipcMain.handle('test:capture',async(event,name,width)=>{const win=BrowserWindow.fromWebContents(event.sender);win.setContentSize(width,800);await new Promise(r=>setTimeout(r,150));writeFileSync(${JSON.stringify(captures)}+'/'+name+'.png',(await event.sender.capturePage()).toPNG())});
ipcMain.on('test:done',(_,result)=>{console.log(JSON.stringify(result));app.exit(result.ok?0:1)});
app.whenReady().then(()=>{const win=new BrowserWindow({show:false,width:1100,height:850,webPreferences:{preload:${JSON.stringify(join(directory, 'preload.cjs'))},sandbox:false,backgroundThrottling:false}});win.webContents.on('console-message',details=>{if(details.level==='error'){console.error(details.message);app.exit(1)}});win.loadFile(${JSON.stringify(join(directory, 'index.html'))})});setTimeout(()=>app.exit(2),25000);
`)
  const built = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(built.success).toBe(true)
  const main = await Bun.build({ entrypoints: [mainEntry], outdir: directory, target: 'node', format: 'cjs', external: ['electron'] })
  expect(main.success).toBe(true)
  // The production preload exposes the actual typed bridge in an isolated renderer.
  await writeFile(join(directory, 'preload.cjs'), `require(${JSON.stringify(join(desktop, 'dist/preload.js'))});const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('test',{capture:(name,width)=>ipcRenderer.invoke('test:capture',name,width),mode:value=>ipcRenderer.invoke('test:mode',value),escape:()=>ipcRenderer.invoke('test:escape'),done:value=>ipcRenderer.send('test:done',value)});`)
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\'"><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="test.js"></script>')
  const executable = process.platform === 'win32' ? join(desktop, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin' ? join(desktop, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : join(desktop, 'node_modules/electron/dist/electron')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [join(directory, 'main.js')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
  const watchdog = setTimeout(() => child.kill(), 30000)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(watchdog))
  if (code !== 0) throw new Error(output)
  expect(output).toContain('"ok":true')
}, 35000)
