import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('catalogue navigation, search, included skills and activation in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'fixture-catalogue-'))
  const captures = join(desktop, 'tmp/catalogue')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {PluginCatalog} from ${JSON.stringify(join(renderer, 'catalog/PluginCatalog.tsx'))};
import {useExtensions} from ${JSON.stringify(join(renderer, 'state/useExtensions.ts'))};
import {CATALOG} from ${JSON.stringify(join(desktop, 'src/main/extensions/extensionCatalog.ts'))};
// La Bureautique n'est plus incluse : c'est le plugin recommandé du catalogue officiel, installé.
const OFFICE={id:'plugin-office',name:'whitecode-office',displayName:'Bureautique',kind:'plugin',category:'Bureautique',recommended:true,sourceId:'source-official',ref:'v1.0.0',repository:'https://github.com/Paqquito/WhiteCode-Extensions.git',version:'1.0.0',summary:'Créez des fichiers Excel, Word, PowerPoint et PDF dans vos conversations.',skills:['excel','word','powerpoint','pdf'],homepage:'https://github.com/Paqquito/WhiteCode-Extensions',license:'MIT'};
const {ipcRenderer}=window.require('electron'); let enabled=true,closed=false;
window.engine={listExtensions:async()=>[{...OFFICE,installed:true,enabled},...CATALOG.map(entry=>({...entry,installed:false,enabled:false}))],listExtensionSources:async()=>[],onExtensionProgress:()=>()=>{},enableExtension:async(id,value)=>{enabled=value}};
function Body(){const extensions=useExtensions();return <PluginCatalog extensions={extensions} onClose={()=>{closed=true}}/>}
createRoot(document.getElementById('root')).render(<Body/>);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('Timeout '+fn);await sleep(10)}}
function check(ok,message){if(!ok)throw Error(message)}
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===label||e.getAttribute('aria-label')===label);
function type(el,value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
async function run(){
await until(()=>document.querySelector('.ext-list .ext'));
check(document.activeElement.tagName==='H1','catalogue focus missing');
check(document.querySelector('.ext-list .ext').textContent.includes('Bureautique'),'office not first');
check(!document.querySelector('.ext-list .ext').textContent.includes('Mettre à jour'),'card exposes an update action');
await ipcRenderer.invoke('capture','catalogue',1180);
button('Installés').click();await until(()=>document.querySelectorAll('.ext-list .ext').length===1);
check(document.querySelector('.ext-list').textContent.includes('Bureautique'),'installed filter');
button('Ouvrir Bureautique').focus();button('Ouvrir Bureautique').click();await until(()=>document.querySelector('dialog[open]'));
const toggle=document.querySelector('.plugin-panel input[type=checkbox]');toggle.click();await until(()=>!enabled&&!document.querySelector('.plugin-panel input').checked);
button('Fermer la fiche').click();await until(()=>!document.querySelector('dialog'));check(document.activeElement.getAttribute('aria-label')==='Ouvrir Bureautique','focus not restored');
button('Skills').click();await sleep(30);check(!document.querySelector('.catalog-skills'),'skills leaked into overview');
button('Ouvrir Agent Skills').click();await until(()=>document.querySelectorAll('.catalog-skills li').length===5);
button('Voir plus (20)').click();await until(()=>document.querySelectorAll('.catalog-skills li').length===25);
button('Voir moins').click();await until(()=>document.querySelectorAll('.catalog-skills li').length===5);
await ipcRenderer.invoke('capture','plugin-panel',1180);await ipcRenderer.invoke('capture','plugin-panel-narrow',520);
const panel=document.querySelector('.plugin-panel');check(panel.scrollWidth<=panel.clientWidth,'panel overflow');
panel.dispatchEvent(new Event('cancel',{cancelable:true}));await until(()=>!document.querySelector('dialog'));
const search=document.querySelector('input[type=search]');type(search,'excel');await until(()=>document.querySelectorAll('.ext-list .ext').length===1);
check(document.querySelector('.ext-list').textContent.includes('Bureautique'),'skills search');
button('Ouvrir Bureautique').click();await until(()=>document.querySelector('.catalog-skills'));check(document.querySelectorAll('.catalog-skills li').length===4,'office inventory');check(!button('Voir plus (20)'),'unnecessary expansion');button('Fermer la fiche').click();
type(search,'no-such-extension');await until(()=>document.body.textContent.includes('Aucune extension ne correspond'));
type(search,'');button('Découvrir').click();await until(()=>document.querySelectorAll('.ext-list .ext').length>1);
await ipcRenderer.invoke('capture','catalogue-narrow',520);
check(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');
document.documentElement.dataset.theme='dark';await sleep(100);check(getComputedStyle(document.querySelector('.plugin-catalog')).backgroundColor==='rgb(20, 20, 20)','dark theme missing');await ipcRenderer.invoke('capture','catalogue-dark',1180);
button('Ouvrir Agent Skills').click();await until(()=>document.querySelector('.plugin-panel[open]'));await ipcRenderer.invoke('capture','plugin-panel-dark',1180);button('Fermer la fiche').click();
button('Retour à la conversation').click();check(closed,'return button');
return {ok:true}}
run().then(result=>ipcRenderer.send('done',result)).catch(error=>ipcRenderer.send('done',{ok:false,error:error.stack}));`)
  const built = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(built.success).toBe(true)
  if (!built.success) throw new Error(built.logs.join('\n'))
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>#root{height:100vh}.plugin-catalog{height:100%}</style><div id="root"></div><script src="test.js"></script>')
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
