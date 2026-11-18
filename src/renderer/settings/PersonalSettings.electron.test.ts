import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L07 preferences persistence, theme, errors, notifications and focus in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l07-'))
  const captures = join(desktop, 'tmp/l07')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {CodeEditor} from ${JSON.stringify(join(renderer, 'code/CodeEditor.tsx'))};
import {SettingsDialog} from ${JSON.stringify(join(renderer, 'settings/SettingsDialog.tsx'))};
import {PreferencesProvider,usePreferences} from ${JSON.stringify(join(renderer, 'state/usePreferences.tsx'))};
import {DEFAULT_PREFERENCES} from ${JSON.stringify(join(desktop, 'src/shared/preferences.ts'))};
const {ipcRenderer}=window.require('electron');let saved=structuredClone(DEFAULT_PREFERENCES),api,show,setShow,fail=false,checks=0,tested=false;
window.engine={getPreferences:async()=>({value:saved,error:null,notificationsSupported:true}),savePreferences:async value=>{if(fail)throw Error('Disque indisponible');saved=structuredClone(value);return saved},testNotification:async()=>{tested=true}};
function Body(){api=usePreferences();[show,setShow]=React.useState(true);return <><button id="opener" onClick={()=>setShow(true)}>Paramètres</button><div className="entry assistant"><p>Une réponse pour vérifier la taille du texte.</p></div><div style={{height:100}}><CodeEditor value={"const projet = 'WhiteCode'"} language="javascript" onChange={()=>{}} onSave={()=>{}}/></div>{show&&<SettingsDialog provider={{}} corpora={{}} extensions={{}} reducedTools={false} onReducedTools={()=>{}} onMcpServers={()=>{}} projects={[]} onUnarchive={()=>{}} onOpenSession={()=>{}} onClose={()=>setShow(false)}/>}</>}
let root=createRoot(document.getElementById('root'));const render=()=>root.render(<PreferencesProvider><Body/></PreferencesProvider>);render();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('Timeout '+fn);await sleep(10)}}
function check(ok,message){checks++;if(!ok)throw Error(message)}
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.getAttribute('aria-label')===label);
function select(label,value){const el=[...document.querySelectorAll('label')].find(e=>e.textContent.startsWith(label)).querySelector('select');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))}
async function save(){await sleep(20);await until(()=>!api.saving&&document.body.textContent.includes('Enregistré'))}
async function run(){await until(()=>api?.ready&&document.querySelector('dialog[open]'));check(document.querySelector('.settings-tab.active').textContent==='Général','wrong landing tab');
select('Envoyer un message avec','mod-enter');await save();check(saved.sendMode==='mod-enter','send setting not saved');
button('Apparence').click();await sleep(20);select('Thème','dark');select('Police de l’interface','sans');select('Taille du texte des conversations','17');select('Taille du code et du terminal','16');await save();await until(()=>document.documentElement.dataset.theme==='dark');check(getComputedStyle(document.querySelector('.entry')).fontSize==='17px','reading size ignored');check(getComputedStyle(document.querySelector('.code-layer')).fontSize==='16px','code size ignored');await ipcRenderer.invoke('capture','appearance-dark',1000);
select('Thème','system');await save();await ipcRenderer.invoke('system-theme','light');await until(()=>document.documentElement.dataset.theme==='light');await ipcRenderer.invoke('system-theme','dark');await until(()=>document.documentElement.dataset.theme==='dark');check(true,'system theme updates');
select('Thème','light');await save();button('Raccourcis').click();await sleep(20);await ipcRenderer.invoke('capture','shortcuts',1000);
button('Notifications').click();await sleep(20);const toggle=[...document.querySelectorAll('label')].find(e=>e.textContent==='Activer les notifications système').querySelector('input');toggle.click();await save();check(!saved.notifications.enabled,'mute not saved');check(button('Tester dans 3 secondes').disabled,'muted test enabled');toggle.click();await save();button('Tester dans 3 secondes').click();await until(()=>tested);await ipcRenderer.invoke('capture','notifications',1000);
button('Général').click();await sleep(20);fail=true;select('Envoyer un message avec','enter');await until(()=>document.body.textContent.includes('Disque indisponible'));check(api.value.sendMode==='mod-enter','failed save falsely applied');check([...document.querySelectorAll('label')].find(e=>e.textContent.startsWith('Envoyer un message avec')).querySelector('select').value==='mod-enter','failed save left the rejected value displayed');fail=false;
button('Apparence').click();await sleep(20);select('Thème','dark');await save();check(saved.theme==='dark','theme not applied on change');button('Fermer les paramètres').click();await until(()=>!document.querySelector('dialog'));button('Paramètres').focus();button('Paramètres').click();await until(()=>document.querySelector('dialog[open]'));document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));await until(()=>!document.querySelector('dialog'));check(document.activeElement.id==='opener','dialog did not return focus');
root.unmount();root=createRoot(document.getElementById('root'));render();await until(()=>api?.ready&&document.querySelector('dialog[open]'));check(api.value.textSize===17&&api.value.theme==='dark','preferences lost on remount');await ipcRenderer.invoke('capture','general-narrow',520);check(document.querySelector('.settings').scrollWidth<=520,'settings overflow narrow viewport');return checks}
run().then(checks=>ipcRenderer.send('done',{ok:true,checks}),error=>ipcRenderer.send('done',{ok:false,error:String(error.stack)}));
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
