import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

test('OpenAI settings preserve the compatible server token and expose manual models in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-openai-ui-'))
  const source = desktop.replace(/\\/g, '/')
  const entry = join(directory, 'check.tsx')
  await mkdir(join(desktop, 'tmp'), { recursive: true })
  await writeFile(entry, `
    import * as React from ${JSON.stringify(source + '/node_modules/react/index.js')};
    import {createRoot} from ${JSON.stringify(source + '/node_modules/react-dom/client.js')};
    import {OpenAIFields} from ${JSON.stringify(source + '/src/renderer/settings/OpenAIFields.tsx')};
    import {useModelChoice} from ${JSON.stringify(source + '/src/renderer/state/useModelChoice.ts')};
    const {ipcRenderer}=window.require('electron');
    let saved=null, probed=null;const errors=[];console.error=(...args)=>errors.push(args.join(' '));
    window.engine={listOpenAIModels:async(baseUrl,apiKey)=>{probed={baseUrl,apiKey};return {ok:true,models:[{id:'published-model',label:'Published',supportsEffort:false,isDefault:false}]}}};
    function App(){
      const [config,setConfig]=React.useState({kind:'openai',token:'server-token-fixture',openaiBaseUrl:'',openaiModel:''});
      const [model,setModel]=React.useState(null);
      const choice=useModelChoice({provider:{config,models:[],localModels:[]},model,setModel,onAddModel:()=>{}});
      return React.createElement('main',{className:'settings',style:{height:'auto',overflow:'visible'}},React.createElement('div',{className:'settings-body'},React.createElement(OpenAIFields,{config,onApply:value=>{saved=value;setConfig(value)}}),React.createElement('output',null,choice.selected+' · '+choice.contextLimit)))
    }
    createRoot(document.getElementById('root')).render(React.createElement(App));
    const check=(value,message)=>{if(!value)throw new Error(message)};
    const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10))}throw new Error('Timed out')};
    const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
    async function type(selector,value){const input=document.querySelector(selector);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,10))}
    async function run(){
      await until(()=>button('Enregistrer le fournisseur OpenAI'));
      await type('input[type=url]','https://provider.example/v1');await type('input[type=password]','private-fixture');await type('input[type=text]','manual-model');await type('input[type=number]','65536');
      check(!saved,'editing persisted an incomplete draft');
      button('Consulter les modèles').click();await until(()=>document.querySelector('datalist option'));
      check(probed.baseUrl==='https://provider.example/v1'&&probed.apiKey==='private-fixture','catalog used gateway credentials');
      button('Enregistrer le fournisseur OpenAI').click();await until(()=>saved&&document.querySelector('output').textContent.includes('manual-model'));
      check(saved.token==='server-token-fixture','provider configuration lost the compatible server token');
      check(saved.openaiApiKey==='private-fixture'&&saved.openaiContext===65536,'settings were not saved');
      await ipcRenderer.invoke('capture',900,'openai-settings');await ipcRenderer.invoke('capture',380,'openai-settings-narrow');
      check(document.documentElement.scrollWidth<=window.innerWidth,'OpenAI settings overflow');check(!errors.length,'React errors: '+errors.join(';'));
    }
    run().then(()=>ipcRenderer.send('checked',{ok:true}),error=>ipcRenderer.send('checked',{ok:false,error:String(error.stack)}));
  `)
  const build = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(build.success).toBe(true)
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await cp(join(desktop, 'dist/renderer/assets'), join(directory, 'assets'), { recursive: true })
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="check.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const {app,BrowserWindow,ipcMain}=require('electron');app.disableHardwareAcceleration();
    app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
    ipcMain.handle('capture',async(event,width,name,height=900)=>{const win=BrowserWindow.fromWebContents(event.sender);win.setSize(width,height);await new Promise(r=>setTimeout(r,150));const shot=await event.sender.capturePage(undefined,{stayHidden:true,stayAwake:true});require('node:fs').writeFileSync(${JSON.stringify(join(desktop, 'tmp'))}+'/t47-'+name+'.png',shot.toPNG());});
    app.whenReady().then(()=>{const win=new BrowserWindow({show:true,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});win.loadFile(${JSON.stringify(join(directory, 'index.html'))});});
    ipcMain.on('checked',(_event,result)=>{console.log('CHECKED '+JSON.stringify(result));app.exit(result.ok?0:1)});setTimeout(()=>app.exit(2),20000);
  `)
  const executable = process.platform === 'win32' ? join(desktop, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin' ? join(desktop, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : join(desktop, 'node_modules/electron/dist/electron')
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', data => { output += data }); child.stderr.on('data', data => { output += data })
  const timer = setTimeout(() => child.kill(), 25000)
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(timer))
  if (code !== 0) throw new Error('Electron auth check failed: ' + output)
  expect(output).toContain('"ok":true')
}, 30000)
