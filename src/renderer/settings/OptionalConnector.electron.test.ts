import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

test('Tickets is optional, installable and configurable through the plugin and connector screens', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'optional-tickets-'))
  const connector = JSON.parse(await readFile(join(desktop, 'src/main/extensions/fixtures/tickets/connector.json'), 'utf8'))
  const captures = join(desktop, 'tmp/optional-connector')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  await writeFile(join(directory, 'test.tsx'), `
import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {ExtensionSettings} from ${JSON.stringify(join(renderer, 'settings/ExtensionSettings.tsx'))};
import {McpSettings} from ${JSON.stringify(join(renderer, 'settings/McpSettings.tsx'))};
import {useExtensions} from ${JSON.stringify(join(renderer, 'state/useExtensions.ts'))};
const {ipcRenderer}=window.require('electron');const connector=${JSON.stringify(connector)};
let installed=false,enabled=false,key='',installs=0,checks=0,setPage,upgrade=false;
const entry=()=>({id:'tickets-plugin',kind:'plugin',name:'fixture-tickets',displayName:'Tickets',summary:'Tickets Tickets',homepage:'https://example.test',license:'MIT',sourceId:'official',ref:'b'.repeat(40),installed,enabled,skills:['skills/tickets/definition.md'],...(installed?{connector,path:'fixture',revision:'b'.repeat(40)}:{})});
window.engine={
 listExtensions:async()=>[entry()],listExtensionSources:async()=>[],onExtensionProgress:()=>()=>{},
 extensionCatalogueStatus:async()=>({added:true,...(!upgrade?{update:{sourceId:'official',currentRef:'v1.0.0',targetRef:'v1.1.0'}}:{})}),
 refreshExtensionSource:async(id,ref)=>{if(id!=='official'||ref!=='v1.1.0')throw Error('wrong update');upgrade=true},
 installExtension:async()=>{installs++;installed=true;return true},enableExtension:async(_id,value)=>{enabled=value},removeExtension:async()=>{installed=false;enabled=false},
 listMcp:async()=>installed&&enabled?[{id:'tickets',label:connector.label,enabled:true,source:'plugin',transport:'http',address:'https://example.test/mcp'}]:[],
 listConnectors:async()=>installed&&enabled?[{...connector,secrets:connector.auth.secrets}]:[],
 connectorStatus:async()=>{checks++;return{configured:!!key,secrets:{apiKey:!!key},...(key?{account:{name:'Compte de test',login:'fixture'}}:{})}},
 setConnectorSecret:async(_id,name,value)=>{if(name!=='apiKey')throw Error('wrong secret');key=value||''},
};
function Harness(){const extensions=useExtensions();const[page,update]=React.useState('mcp');setPage=update;
 return <div className="settings" style={{height:'100vh',width:'100%'}}><div className="settings-panel">{page==='mcp'
 ?<McpSettings selected={null} onSelected={()=>{}} onManagePlugins={()=>update('plugins')}/>
 :<ExtensionSettings extensions={extensions} onManageConnectors={()=>update('mcp')}/>}</div></div>}
createRoot(document.getElementById('root')).render(<Harness/>);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const end=Date.now()+6000;while(!fn()){if(Date.now()>end)throw Error('Timeout '+fn);await sleep(15)}}
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.getAttribute('aria-label')===label);
const text=()=>document.body.textContent;const check=(ok,message)=>{if(!ok)throw Error(message)};
async function run(){
 await until(()=>button('Installer un plugin'));check(installs===0&&checks===0,'uninstalled connector must remain inert');check(!text().includes('Compte Tickets'),'uninstalled account exposed');
 button('Installer un plugin').click();await until(()=>button('Ouvrir Tickets'));
 check(!installed&&!enabled,'opening catalogue installed plugin');
 await until(()=>button('Mettre à jour le catalogue officiel'));button('Mettre à jour le catalogue officiel').click();await until(()=>upgrade&&!button('Mettre à jour le catalogue officiel'));
 check(installs===0,'catalogue update installed a plugin');
 button('Ouvrir Tickets').click();await until(()=>document.querySelector('dialog'));
 button('Installer').click();await until(()=>button('Mettre à jour'));
 check(installs===1&&!enabled,'installation must require activation');check(!button('Configurer Tickets'),'disabled plugin can configure its connector');
 document.querySelector('dialog input[role=switch]').click();await until(()=>button('Configurer Tickets'));
 button('Configurer Tickets').click();await until(()=>text().includes('Compte Tickets'));check(!document.querySelector('dialog'),'plugin dialog remained open');
 const details=[...document.querySelectorAll('details')].find(e=>e.querySelector('summary')?.textContent==='Compte Tickets');details.open=true;
 await until(()=>document.querySelector('form[aria-label="Compte Tickets"] input[type=password]'));
 const input=document.querySelector('form[aria-label="Compte Tickets"] input[type=password]');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'k'.repeat(40));input.dispatchEvent(new Event('input',{bubbles:true}));await sleep(30);
 input.form.requestSubmit();await until(()=>text().includes('Compte vérifié : Compte de test'));
 check(!input.value&&!text().includes('k'.repeat(40)),'saved key leaked or remained in input');
 for(const width of [320,768,1024,1440]){await ipcRenderer.invoke('capture','configured-'+width,width);check(document.documentElement.scrollWidth<=window.innerWidth+1,'horizontal overflow at '+width)}
 setPage('plugins');await until(()=>button('Ouvrir Tickets'));button('Ouvrir Tickets').click();await until(()=>document.querySelector('dialog input[role=switch]'));
 document.querySelector('dialog input[role=switch]').click();await until(()=>!enabled&&!button('Configurer Tickets'));button('Fermer la fiche').click();setPage('mcp');await until(()=>button('Installer un plugin'));check(!text().includes('Compte Tickets'),'disabled connector remained visible');
 setPage('plugins');await until(()=>button('Ouvrir Tickets'));button('Ouvrir Tickets').click();await until(()=>button('Supprimer Tickets'));button('Supprimer Tickets').click();await until(()=>button('Confirmer la suppression'));button('Confirmer la suppression').click();await until(()=>!installed&&button('Installer'));
 check(key.length===40,'removal destroyed stored account');check(installs===1,'plugin was reinstalled without a request');
 return true;
}
run().then(()=>ipcRenderer.send('done',{ok:true}),error=>ipcRenderer.send('done',{ok:false,error:String(error.stack)}));
`)
  const built = await Bun.build({ entrypoints: [join(directory, 'test.tsx')], outdir: directory, target: 'browser', format: 'iife' })
  expect(built.success).toBe(true)
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="test.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `const {app,BrowserWindow,ipcMain}=require('electron');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
ipcMain.handle('capture',async(event,name,width)=>{const win=BrowserWindow.fromWebContents(event.sender);win.setSize(width,900);await new Promise(r=>setTimeout(r,130));require('fs').writeFileSync(${JSON.stringify(captures)}+'/'+name+'.png',(await event.sender.capturePage()).toPNG())});
app.whenReady().then(()=>{const win=new BrowserWindow({show:true,width:1024,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});win.loadFile(${JSON.stringify(join(directory, 'index.html'))})});
ipcMain.on('done',(_,result)=>{console.log(JSON.stringify(result));app.exit(result.ok?0:1)});setTimeout(()=>app.exit(2),30000);`)
  const executable = process.platform === 'win32' ? join(desktop, 'node_modules/electron/dist/electron.exe') : join(desktop, 'node_modules/electron/dist/electron')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [join(directory, 'main.cjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
  const watchdog = setTimeout(() => child.kill(), 35000)
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(watchdog))
  if (code !== 0) throw new Error(output)
  expect(output).toContain('"ok":true')
}, 45000)
