import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L05 terminal detaches and waits for stop before restarting', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l05-'))
  const captures = join(desktop, 'tmp/terminal')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `
import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {TerminalPanel} from ${JSON.stringify(join(renderer, 'panels/TerminalPanel.tsx'))};
const {ipcRenderer}=window.require('electron');let show,setShow,killResolve,killed=false,attaches=0,creates=0,lastRemote;
window.engine={terminalTargets:async()=>({targets:[{id:'a'.repeat(24),label:'Développement',description:'reader@vm.test:22 · Équipe A'},{id:'b'.repeat(24),label:'Développement',description:'reader@vm.test:2222 · Équipe B'}]}),onTerminalData:()=>()=>{},onTerminalExit:()=>()=>{},
attachTerminal:async(cwd,remote)=>{lastRemote=remote;attaches++;return killed?null:{id:'existing',scrollback:'Retrouvé après fermeture\\r\\n'}},
createTerminal:async()=>{creates++;return 'new'},resizeTerminal:async()=>{},writeTerminal:async()=>{},
killTerminal:()=>new Promise(resolve=>{killResolve=()=>{killed=true;resolve()}})};
function App(){[show,setShow]=React.useState(true);return <div style={{width:'100%',maxWidth:600,height:400,display:'flex'}}>{show&&<TerminalPanel cwd="/project" onClose={()=>setShow(false)}/>}</div>}
createRoot(document.getElementById('root')).render(<App/>);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw new Error('Timeout '+fn);await sleep(10)}}
const button=label=>document.querySelector('button[aria-label="'+label+'"]');
async function run(){await until(()=>button('Redémarrer le terminal')&&!button('Redémarrer le terminal').disabled);
button('Fermer Terminal').click();await sleep(20);if(killResolve)throw Error('close killed shell');setShow(true);
await until(()=>attaches===2&&!button('Redémarrer le terminal').disabled);button('Redémarrer le terminal').click();await until(()=>killResolve);await sleep(30);
if(attaches!==2||creates!==0)throw Error('restart reattached before kill completed');killResolve();await until(()=>creates===1&&!button('Redémarrer le terminal').disabled);
document.documentElement.dataset.theme='dark';document.documentElement.style.setProperty('--code-size','16px');await sleep(80);
if(attaches!==3||creates!==1)throw Error('appearance change recreated terminal');

document.querySelector('button[title="Machine sur laquelle ouvrir le shell"]').click();
await until(()=>document.querySelectorAll('[role="menuitemradio"]').length===3);
const other=[...document.querySelectorAll('[role="menuitemradio"]')].find(el=>el.textContent.includes(':2222'));
if(!other||!other.textContent.includes('Équipe B'))throw Error('duplicate targets not identifiable');other.click();
await until(()=>lastRemote==='b'.repeat(24)&&!button('Redémarrer le terminal').disabled);
if(!document.querySelector('.panel-head').textContent.includes(':2222'))throw Error('destination absent from header');
document.querySelector('button[title="Machine sur laquelle ouvrir le shell"]').click();
await until(()=>document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent.includes(':2222'));
await ipcRenderer.invoke('capture','terminal-targets-dark',420);
document.documentElement.dataset.theme='light';await sleep(80);
await ipcRenderer.invoke('capture','terminal-targets-light',320);
for(const label of ['Arrêter le terminal','Redémarrer le terminal','Fermer Terminal']){
const bounds=button(label).getBoundingClientRect();if(bounds.right>innerWidth||bounds.left<0)throw Error('Clipped control '+label)}
const menuBounds=document.querySelector('[role="menu"]').getBoundingClientRect();
if(menuBounds.left<0||menuBounds.right>innerWidth)throw Error('Clipped target menu');
if(document.documentElement.scrollWidth>window.innerWidth)throw Error('terminal horizontal overflow');return 9}
run().then(checks=>ipcRenderer.send('done',{ok:true,checks}),error=>ipcRenderer.send('done',{ok:false,error:String(error.stack)}));
`)
  const built = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(built.success).toBe(true)
  if (!built.success) throw new Error(built.logs.join('\n'))
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await cp(join(desktop, 'node_modules/@xterm/xterm/css/xterm.css'), join(directory, 'xterm.css'))
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="xterm.css"><link rel="stylesheet" href="styles.css"><style>#root{height:100vh}.panel{height:100%}</style><div id="root"></div><script src="test.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const {app,BrowserWindow,ipcMain}=require('electron');app.disableHardwareAcceleration();
    app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
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
