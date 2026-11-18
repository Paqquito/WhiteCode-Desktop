import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

test('L10 native browser, real IPC, notes, downloads, isolated HTML and PDF reader', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l10-'))
  const captures = join(desktop, 'tmp/l10')
  await mkdir(captures, { recursive: true })
  await writeFile(
    join(directory, 'tsconfig.json'),
    ' {"compilerOptions":{"jsx":"react"}}',
  )
  await writeFile(
    join(directory, 'ui.tsx'),
    `
import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {BrowserPanel} from ${JSON.stringify(join(desktop, 'src/renderer/panels/BrowserPanel.tsx'))};
import {FilesPanel} from ${JSON.stringify(join(desktop, 'src/renderer/panels/FilesPanel.tsx'))};
let setShow,setFile;window.testSetShow=value=>setShow(value);window.testOpenDocument=path=>setFile({path});
function UI(){const [show,set]=React.useState(true);setShow=set;const [file,updateFile]=React.useState(null);setFile=updateFile;return <><button id="open" onClick={()=>set(true)}>Navigateur</button><button id="modal" onClick={()=>document.getElementById('dialog').showModal()}>Dialogue</button><dialog id="dialog"><p>Le navigateur reste derrière ce dialogue.</p><button onClick={()=>document.getElementById('dialog').close()}>Fermer le dialogue</button></dialog><div style={{height:'calc(100vh - 45px)',display:'flex',flexDirection:'column'}}>{file?<FilesPanel sessionId="file-fixture" root={${JSON.stringify(directory)}} target={file} onClose={()=>updateFile(null)}/>:show&&<BrowserPanel sessionId="fixture" workspace="/project-fixture" onClose={()=>set(false)}/>}</div></>};createRoot(document.getElementById('root')).render(<UI/>);
`,
  )
  const ui = await Bun.build({
    entrypoints: [join(directory, 'ui.tsx')],
    outdir: directory,
    target: 'browser',
    format: 'iife',
  })
  expect(ui.success).toBe(true)
  await cp(
    join(desktop, 'dist/renderer/styles.css'),
    join(directory, 'styles.css'),
  )
  await writeFile(
    join(directory, 'index.html'),
    '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="ui.js"></script>',
  )
  await writeFile(
    join(directory, 'main.ts'),
    `
import {app,BrowserWindow,ipcMain} from 'electron';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readFileContent,readDirectory} from ${JSON.stringify(join(desktop, 'src/main/workspace/files.ts'))};
import {registerBrowserIpc,registerPreviewScheme} from ${JSON.stringify(join(desktop, 'src/main/browser/surfaces.ts'))};
// Keep test rendering active when another Windows application covers this fixture.
// This does not change the production window's rendering policy.
registerPreviewScheme();app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion');app.disableHardwareAcceleration();app.on('web-contents-created',(_event,wc)=>{wc.setBackgroundThrottling(false);wc.on('console-message',details=>console.log(details.message))});app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
const root=${JSON.stringify(directory)},captures=${JSON.stringify(captures)};
let window,server,requests=[];ipcMain.handle('files:read-file',(_event,payload)=>readFileContent(payload.root,payload.path));ipcMain.handle('files:read-dir',(_event,payload)=>readDirectory(payload.root,payload.path));const surfaces=registerBrowserIpc(ipcMain,()=>window,name=>join(root,name));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const end=Date.now()+7000;while(!await fn()){if(Date.now()>end)throw Error('Timeout '+fn);await sleep(20)}}
function check(ok,message){if(!ok)throw Error(message)}
const js=code=>window.webContents.executeJavaScript(code,true).catch(error=>{throw Error(code+' '+error)});
const click=label=>js('([...document.querySelectorAll("button")].find(e=>e.textContent==='+JSON.stringify(label)+'||e.getAttribute("aria-label")==='+JSON.stringify(label)+')).click()');
const type=async(selector,value)=>{await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}))})()');await sleep(30)};
// A navigation/resize can precede the compositor's first frame on Windows.
// Retry only that transient capture failure, with a deadline and useful context.
async function captureImage(wc){
  const end=Date.now()+3000;
  while(true){
    try{const image=await wc.capturePage();if(image.isEmpty())throw Error('EmptyFrame');return image}
    catch(error){
      if(!['UnknownVizError','EmptyFrame'].includes(error.message)||Date.now()>end)throw Error('Capture '+wc.getURL()+': '+error.message);
      wc.invalidate();await sleep(50);
    }
  }
}
const capture=async(name,wc=window.webContents)=>{await sleep(120);writeFileSync(join(captures,name+'.png'),(await captureImage(wc)).toPNG());if(process.platform==='linux'&&['browser-notes','browser-narrow','file-reader'].includes(name)){try{execFileSync('import',['-window',String(window.getNativeWindowHandle().readUInt32LE(0)),join(captures,name+'-window.png')],{timeout:3000,stdio:'ignore'})}catch{}}};
async function run(){
  await app.whenReady();
  server=createServer((req,res)=>{requests.push(req.url);if(req.url==='/failure'){res.destroy();return}if(req.url==='/slow'){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="slow.bin"','content-length':102400});let count=0;const timer=setInterval(()=>{res.write(Buffer.alloc(1024));if(++count===100){clearInterval(timer);res.end()}},50);res.on('close',()=>clearInterval(timer));return}if(req.url==='/download'){res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':'attachment; filename="fixture.txt"'});res.end('download fixture');return}res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<title>Page '+req.url+'</title><h1>Projet de test</h1><p id="quote">Un extrait à annoter.</p><a href="/second">Deuxième page</a> <a href="/download">Télécharger</a> <a href="/slow">Téléchargement lent</a>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  window=new BrowserWindow({width:1000,height:850,show:true,webPreferences:{backgroundThrottling:false,preload:${JSON.stringify(join(desktop, 'dist/preload.js'))},contextIsolation:true,nodeIntegration:false}});
  await window.loadFile(join(root,'index.html'));await until(()=>js('Boolean(document.querySelector("input"))'));
  await type('input',base+'/first');await click('Ouvrir');let id;await until(async()=>{const ids=await js('Boolean(document.querySelector(".web-surface"))');if(!ids)return false;return window.contentView.children.length>0});
  // Native child is obtained through the real surface state published to the preload.
  const guest=window.contentView.children[0]?.webContents;
  check(guest,'missing native surface');await until(()=>guest.getURL()===base+'/first'&&!guest.isLoading());
  const isolated=await guest.executeJavaScript('({engine:typeof window.engine,node:typeof require})');check(isolated.engine==='undefined'&&isolated.node==='undefined','web page escaped isolation');
  await guest.executeJavaScript('document.querySelector("a").click()',true);await until(()=>guest.getURL()===base+'/second'&&!guest.isLoading());await until(()=>js('![...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")==="Page précédente").disabled'));await click('Page précédente');await until(()=>guest.getURL()===base+'/first');await click('Page suivante');await until(()=>guest.getURL()===base+'/second');
  await guest.executeJavaScript('(()=>{const range=document.createRange();range.selectNodeContents(document.getElementById("quote"));const s=window.getSelection();s.removeAllRanges();s.addRange(range)})()');
  await click('Notes (0)');await click('Reprendre le texte sélectionné');await until(()=>js('document.body.textContent.includes("Un extrait à annoter.")'));await type('textarea','Vérifier cette section');await click('Enregistrer la note');await until(()=>js('document.body.textContent.includes("Notes (1)")'));await capture('browser-notes');await capture('web-page',guest);window.setSize(480,850);await sleep(160);check(await js('document.querySelector(".browser-panel").scrollWidth<=480'),'browser overflows narrow viewport');await capture('browser-narrow');window.setSize(1000,850);await sleep(120);
  await js('document.getElementById("modal").click()');await until(()=>!window.contentView.children[0].getVisible());await capture('modal');await click('Fermer le dialogue');await until(()=>window.contentView.children[0].getVisible());
  await click('Notes (1)');await guest.executeJavaScript('document.querySelectorAll("a")[1].click()',true);await until(()=>existsSync(join(root,'fixture.txt')));check(readFileSync(join(root,'fixture.txt'),'utf8')==='download fixture','bad download');await click('Téléchargements (1)');await until(()=>js('document.body.textContent.includes("Terminé")'));await capture('downloads');await guest.executeJavaScript('document.querySelectorAll("a")[2].click()',true);await until(()=>js('document.body.textContent.includes("slow.bin")'));await click('Pause');await until(()=>js('document.body.textContent.includes("En pause")'));await click('Reprendre');await click('Annuler');await until(()=>js('document.body.textContent.includes("Annulé")'));await capture('download-cancelled');
  await guest.executeJavaScript('navigator.geolocation.getCurrentPosition(()=>{},()=>{})');await until(()=>js('document.body.textContent.includes("Autorisation refusée")'));
  await type('input','file:///etc/passwd');await click('Ouvrir');await until(()=>js('document.body.textContent.includes("Seules les adresses")'));check(guest.getURL().startsWith(base),'privileged navigation succeeded');
  await type('input',base+'/failure');await click('Ouvrir');await until(()=>js('Boolean(document.querySelector("[role=alert]"))'));await type('input',base+'/first');await click('Ouvrir');await until(()=>guest.getURL()===base+'/first'&&!guest.isLoading());await click('Fermer Navigateur');await until(()=>window.contentView.children.length===0);await js('document.getElementById("open").click()');await until(()=>js('document.body.textContent.includes("Notes (1)")'));await click('Fermer Navigateur');await until(()=>window.contentView.children.length===0);
  writeFileSync(join(root,'preview.html'),'<h1>HTML local isolé</h1><script>fetch("'+base+'/leak");document.body.dataset.executed="yes"</script><img src="'+base+'/image">');
  await surfaces.open(window,'html',{kind:'document',root,path:join(root,'preview.html')});surfaces.bounds(window,'html',{x:30,y:60,width:900,height:700,visible:true});const html=surfaces.get('html',window);await until(()=>!html.state.loading);check(!html.state.error,html.state.error);await sleep(100);check(!requests.includes('/leak')&&!requests.includes('/image'),'HTML accessed network');let blocked=false;try{await html.view.webContents.executeJavaScript('document.body.dataset.executed')}catch{blocked=true}check(blocked,'HTML sandbox permits scripts');await capture('html-preview',html.view.webContents);surfaces.close(window,'html');
  await window.webContents.loadURL('data:text/html,<h1>Rapport PDF L10</h1><p>Document de test lisible.</p>');writeFileSync(join(root,'fixture.pdf'),await window.webContents.printToPDF({}));
  await surfaces.open(window,'pdf',{kind:'document',root,path:join(root,'fixture.pdf')});surfaces.bounds(window,'pdf',{x:0,y:0,width:980,height:780,visible:true});const pdf=surfaces.get('pdf',window);await until(()=>!pdf.state.loading);check(!pdf.state.error,pdf.state.error);await sleep(800);await until(()=>pdf.view.webContents.mainFrame.framesInSubtree.length>=3);await capture('pdf-preview',pdf.view.webContents);const pixels=(await captureImage(pdf.view.webContents)).toBitmap();let white=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>240&&pixels[i+1]>240&&pixels[i+2]>240)white++;check(white>10000,'PDF reader is blank');check((await pdf.view.webContents.executeJavaScript('document.contentType'))==='application/pdf','not a PDF document');surfaces.closeOwner(window);await window.loadFile(join(root,'index.html'));await until(()=>js('typeof window.testOpenDocument==="function"'));await js('window.testOpenDocument('+JSON.stringify(join(root,'fixture.pdf'))+')');await until(()=>window.contentView.children.length===1);await sleep(800);check(await js('document.body.textContent.includes("fixture.pdf")'),'file panel did not open PDF');await capture('file-reader');surfaces.closeOwner(window);
  window.destroy();server.close();console.log('L10_OK');app.exit(0);
}
run().catch(async error=>{console.error(error.stack);console.error(await js('document.body.innerText').catch(()=>''));server?.close();app.exit(1)});setTimeout(()=>app.exit(2),30000);
`,
  )
  const main = await Bun.build({
    entrypoints: [join(directory, 'main.ts')],
    outdir: directory,
    naming: 'main.cjs',
    target: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  expect(main.success).toBe(true)
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    join(desktop, 'node_modules/electron/dist/electron'),
    [join(directory, 'main.cjs')],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (data) => (output += data))
  child.stderr.on('data', (data) => (output += data))
  const watchdog = setTimeout(() => child.kill(), 35000)
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', resolve)
  }).finally(() => clearTimeout(watchdog))
  if (code !== 0) throw Error(output)
  expect(output).toContain('L10_OK')
}, 40000)
