import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L05 tabs, asynchronous saves, conflicts and fixed hover cards in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l05-'))
  const captures = join(desktop, 'tmp/l05')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `
    import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
    import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
    import {FilesPanel} from ${JSON.stringify(join(renderer, 'panels/FilesPanel.tsx'))};
    import {useFileTabs} from ${JSON.stringify(join(renderer, 'panels/useFileTabs.ts'))};
    import {SessionStateProvider} from ${JSON.stringify(join(renderer, 'state/useSessionState.ts'))};
    import {SessionHoverCard} from ${JSON.stringify(join(renderer, 'layout/SessionHoverCard.tsx'))};
    import {ProjectHoverCard} from ${JSON.stringify(join(renderer, 'layout/ProjectHoverCard.tsx'))};
    const {ipcRenderer}=window.require('electron');
    let api,show,setShow,variant,setVariant,session,setSession; let saveResolve;let checks=0;
    const disk={'/project/a.ts':'const a = 1','/project/b.ts':'const b = 2'};
    window.engine={repository:async()=>({branch:'main'}),readDirectory:async()=>Object.keys(disk).map(path=>({name:path.split('/').pop(),path,kind:'file'})),
      readFile:async(root,path)=>{await new Promise(r=>setTimeout(r,path.endsWith('a.ts')?60:5));return path in disk?{ok:true,path,text:disk[path],truncated:false}:{ok:false,path,reason:'unreadable'}},
      writeFile:async(root,path,text,expected)=>new Promise(resolve=>{saveResolve=()=>{if(disk[path]!==expected)resolve({ok:false,reason:'Modification externe : rechargez le fichier.'});else{disk[path]=text;resolve({ok:true})}}})};
    function Probe(){api=useFileTabs(session,'/project');return null}
    function App(){[show,setShow]=React.useState(true);[variant,setVariant]=React.useState(false);[session,setSession]=React.useState('s');return <SessionStateProvider><Probe/>
      <div style={{width:460,height:600}}>{show&&<FilesPanel sessionId={session} root="/project" target={null} onClose={()=>setShow(false)}/>}</div>
      <SessionHoverCard anchor={{sidebarRight:470,rowTop:30}} title={variant?'Un titre de conversation vraiment très long qui doit se terminer par une ellipse sans agrandir la carte. '.repeat(4):'dis bonjour'} project="Example" cwd="/project" updatedAt={Date.now()-3600000}/>
      <ProjectHoverCard anchor={{sidebarRight:470,rowTop:180}} name={variant?'Un projet avec un nom très long '.repeat(7):'Example'} cwd={variant?'/home/user/projets/'.repeat(16):'/project'} sessions={2} onEdit={()=>{}} onEnter={()=>{}} onLeave={()=>{}}/>
    </SessionStateProvider>}
    createRoot(document.getElementById('root')).render(<App/>);
    const answer=async ok=>{const end=Date.now()+4000;while(!document.querySelector('.confirm-dialog[open]')){if(Date.now()>end)throw Error('confirmation absente');await new Promise(r=>setTimeout(r,10))}document.querySelector(ok?'.confirm-dialog .confirm-accept':'.confirm-dialog .confirm-cancel').click();await new Promise(r=>setTimeout(r,10))};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw new Error('Timeout '+fn);await sleep(10)}}
    function check(value,message){checks++;if(!value)throw new Error(message)}
    const button=label=>[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===label);
    async function run(){
      await until(()=>api);
      api.openFile('/project/a.ts');await sleep(10);api.openFile('/project/b.ts');await until(()=>api.tabs.every(t=>t.content));
      check(api.selected==='/project/b.ts'&&api.active.content.text===disk['/project/b.ts'],'late read replaced selected document');
      api.setDraft('draft b');await until(()=>api.active.draft==='draft b');await api.openFile('/project/a.ts');await until(()=>api.selected.endsWith('a.ts'));
      check(api.tabs.find(t=>t.path.endsWith('b.ts')).draft==='draft b','switch lost draft');
      await api.openFile('/project/b.ts');await until(()=>api.selected.endsWith('b.ts'));const pending=api.save();await until(()=>saveResolve);
      api.setDraft('typed during save');await until(()=>api.active.draft==='typed during save');saveResolve();await pending;await until(()=>!api.active.saving);
      check(api.active.draft==='typed during save'&&api.active.content.text==='draft b','save lost newer edit');
      disk['/project/b.ts']='external';const conflict=api.save();await sleep(20);saveResolve();await conflict;await until(()=>api.active.error);
      check(api.active.draft==='typed during save','conflict lost draft');
      api.close(api.active);await answer(false);await sleep(20);check(api.tabs.length===2,'cancelled close removed tab');
      setShow(false);await sleep(30);setShow(true);await until(()=>document.querySelector('.file-tabs'));check(api.active.draft==='typed during save','closing panel lost draft');
      await ipcRenderer.invoke('capture','editor-conflict',1000);
      const size=()=>[...document.querySelectorAll('.session-card')].map(e=>[e.offsetWidth,e.offsetHeight]);const short=size();setVariant(true);await sleep(80);
      check(JSON.stringify(short)===JSON.stringify(size()),'hover card resized with content');check(short[0][0]===320&&short[0][1]===120,'session dimensions');check(short[1][0]===360&&short[1][1]===188,'project dimensions');
      await ipcRenderer.invoke('capture','hover-long',1000);setVariant(false);await sleep(30);await ipcRenderer.invoke('capture','hover-short',1000);
      const reloading=api.reload();await answer(true);await reloading;await until(()=>api.active.content?.ok&&api.active.content.text==='external');check(api.active.draft===null,'reload retained discarded draft');
      delete disk['/project/b.ts'];await api.reload();await until(()=>api.active.content?.ok===false);check(api.active.content.reason==='unreadable','deleted file appeared editable');
      setSession('other');await until(()=>api.tabs.length===0);setSession('s');await until(()=>api.tabs.length===2);check(api.selected==='/project/b.ts','session selection lost');
      for(const file of ['transcript.md','compte-rendu.md']){
        const path='/project/'+file;
        disk[path]='# Réunion\\n\\n'+Array.from({length:100},(_,i)=>'- Passage '+i).join('\\n');
        await api.openFile(path);
        await until(()=>document.querySelector('[aria-label="Aperçu de '+file+'"]'));
        const preview=document.querySelector('.file-preview');
        check(preview.scrollHeight>preview.clientHeight,'Markdown preview expands past the scroll area');
        preview.scrollTop=preview.scrollHeight;
        check(preview.scrollTop>0,'Markdown preview cannot scroll');
      }
      await ipcRenderer.invoke('capture','narrow',500);check(document.querySelector('.file-view').scrollWidth<=document.querySelector('.file-view').clientWidth+1,'file view overflows');
      return checks;
    }
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
