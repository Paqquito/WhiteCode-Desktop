import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L08 technical panels search, errors and MCP import in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l08-'))
  const captures = join(desktop, 'tmp/l08')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {ExtensionSettings} from ${JSON.stringify(join(renderer, 'settings/ExtensionSettings.tsx'))};
import {useExtensions} from ${JSON.stringify(join(renderer, 'state/useExtensions.ts'))};
import {McpSettings} from ${JSON.stringify(join(renderer, 'settings/McpSettings.tsx'))};
import {ModelSettings} from ${JSON.stringify(join(renderer, 'settings/ModelSettings.tsx'))};
const {ipcRenderer}=window.require('electron');let page,setPage,saved,fail=true,sources=[],added,refreshed,diagnosed=false,installed=false;
window.engine={listExtensions:async()=>[{id:'fixture',name:'Extension locale',summary:'Compétences du projet',kind:'plugin',installed,enabled:false,diagnostic:diagnosed?'Validation passed':undefined,skills:['skills/sample/SKILL.md'],revision:installed?'a'.repeat(40):undefined,homepage:'https://example.test',license:'MIT'}],listExtensionSources:async()=>sources,addExtensionSource:async(repository,ref)=>{added={repository,ref};sources=[{id:'source-fixture',name:'Catalogue local',repository,ref,commit:'b'.repeat(40),checkedAt:new Date().toISOString(),entries:[]}]},refreshExtensionSource:async(id,ref)=>{refreshed={id,ref}},removeExtensionSource:async()=>{sources=[]},diagnoseExtension:async()=>{diagnosed=true;return 'Validation passed'},onExtensionProgress:()=>()=>{},installExtension:async()=>{if(fail)throw Error('Installation indisponible');installed=true;return true},listConnectors:async()=>[],listMcp:async()=>saved?[saved]:[],saveMcp:async value=>{saved=value},installedModels:async()=>[],modelServerStatus:async()=>({running:false}),modelsConfig:async()=>({custom:[],root:'/tmp/models',backend:'cpu',contextSize:8192}),onModelProgress:()=>()=>{}};
function Body(){const extensions=useExtensions();[page,setPage]=React.useState('extensions');return <div className="settings" style={{height:'100vh',width:'100%',maxWidth:900,margin:'auto'}}>{page==='extensions'?<ExtensionSettings extensions={extensions}/>:page==='mcp'?<McpSettings selected={null} onSelected={()=>{}}/>:<ModelSettings/>}</div>}
createRoot(document.getElementById('root')).render(<Body/>);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('Timeout '+fn);await sleep(10)}}
function check(ok,message){if(!ok)throw Error(message)}
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.getAttribute('aria-label')===label);
function type(el,value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
async function run(){await until(()=>button('Ouvrir Extension locale'));button('Ouvrir Extension locale').click();await until(()=>button('Installer'));button('Installer').click();await until(()=>document.querySelector('[role=alert]'));check(document.body.textContent.includes('Installation indisponible'),'missing install error');check(!button('Installer').disabled,'cannot retry');button('Fermer la fiche').click();await until(()=>!document.querySelector('dialog'));document.querySelector('.extension-sources summary').click();
const fields=document.querySelectorAll('.extension-source-form input');type(fields[0],'fixture/catalogue');type(fields[1],'v1.0.0');await sleep(30);button('Ajouter la source').click();await until(()=>sources.length&&document.querySelector('.extension-source'));check(added.repository==='fixture/catalogue'&&added.ref==='v1.0.0','source arguments lost');
const refInput=document.querySelector('.extension-source input');type(refInput,'v2');await sleep(30);button('Actualiser la source').click();await until(()=>refreshed);check(refreshed.ref==='v2','refresh ref lost');
button('Ouvrir Extension locale').click();await until(()=>button('Installer')&&!button('Installer').disabled);fail=false;button('Installer').click();await until(()=>button('Mettre à jour'));document.querySelector('.extension-details summary').click();button('Vérifier avec le moteur').click();await until(()=>document.querySelector('.ext-diagnostic'));check(document.body.textContent.includes('Validation passed'),'diagnostic absent');
await ipcRenderer.invoke('capture','extensions',1000);await ipcRenderer.invoke('capture','extensions-narrow',520);check(document.querySelector('.settings-body').scrollWidth<=520,'catalogue overflows narrow window');
button('Retirer la source').click();await until(()=>button('Confirmer le retrait'));button('Confirmer le retrait').click();await until(()=>sources.length===0&&!document.querySelector('.extension-source'));
type(document.querySelector('input[type=search]'),'absent');await until(()=>document.body.textContent.includes('Aucune extension'));setPage('mcp');await until(()=>document.querySelector('input[type=file]'));check(!document.querySelector('details.mcp-editor').open,'Custom MCP controls must start collapsed');document.querySelector('details.mcp-editor summary').click();
const transfer=new DataTransfer();transfer.items.add(new File(['{"mcpServers":{"fixture":{"command":"node"}}}'],'mcp.json',{type:'application/json'}));const input=document.querySelector('input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));await until(()=>button('Enregistrer le serveur'));check(!saved,'import wrote immediately');await ipcRenderer.invoke('capture','mcp-import',1000);button('Enregistrer le serveur').click();await until(()=>saved);check(saved.enabled===false&&saved.config.type==='stdio','import activated server');setPage('models');await until(()=>document.querySelector('input[type=search]'));await ipcRenderer.invoke('capture','models-narrow',520);check(document.querySelector('.settings-body').scrollWidth<=520,'technical panel overflows '+JSON.stringify([...document.querySelectorAll('.settings-body *')].filter(e=>e.getBoundingClientRect().right>520).map(e=>[e.className,e.tagName,e.getBoundingClientRect().width]).slice(0,20)));return true}
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
