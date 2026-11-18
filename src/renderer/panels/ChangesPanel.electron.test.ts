import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L06 Git actions, session review, deleted lines and unavailable states in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l06-'))
  const captures = join(desktop, 'tmp/l06')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
import {ChangesPanel} from ${JSON.stringify(join(renderer, 'panels/ChangesPanel.tsx'))};
import {ReviewBar} from ${JSON.stringify(join(renderer, 'review/ReviewBar.tsx'))};
import {useReview} from ${JSON.stringify(join(renderer, 'state/useReview.ts'))};
import {SessionStateProvider} from ${JSON.stringify(join(renderer, 'state/useSessionState.ts'))};
const {ipcRenderer}=window.require('electron');
let session,setSession,review,sent='',mode='normal',version='after',actions=[],checks=0;
let prAvailable=false,failCommit=true,workflowCalls=[],workflowBranch='feature/l06',failPush=true;
const workflowHead='a'.repeat(40);
const workflowState=()=>({branch:workflowBranch,head:workflowHead,branches:['main','feature/l06'],remotes:[{name:'origin',target:'https://github.com/example/repo.git',fingerprint:'remote-fingerprint',repository:'github.com/example/repo'}],upstream:null,ahead:0,behind:0,dirty:false});
let files=[{path:'src/example.ts',status:'M',staged:false,added:1,removed:1}];
window.engine={gitWorkflow:async()=>workflowState(),
gitWorkflowAction:async(cwd,request)=>{workflowCalls.push(request);if(request.action.kind==='push'&&failPush){failPush=false;throw Error('Publication refusée : branche distante modifiée')}if(request.action.kind==='switch')workflowBranch=request.action.branch;return 'Action confirmée'},
workflowPR:async()=>({number:12,title:'PR de test',url:'https://github.com/example/repo/pull/12',state:'OPEN',headRefOid:workflowHead,headRefName:workflowBranch,baseRefName:'main',isDraft:false,checks:[{name:'CI',state:'SUCCESS'}]}),
gitSummary:async()=>mode==='unavailable'?{available:false,reason:'Git indisponible'}:{available:true,branch:'feature/l06',files},
gitDiff:async()=>['--- a/src/example.ts','+++ b/src/example.ts','@@ -1 +1 @@','-before','+'+version].join('\\n'),
gitAction:async(cwd,action)=>{actions.push(action);if(action.kind==='commit'&&failCommit){failCommit=false;throw Error('Identité Git manquante')}if(action.kind==='commit')files=[];else files=files.map(f=>({...f,staged:action.kind==='stage'}))},
pullRequest:async()=>prAvailable?{available:true,title:'Améliorer les vérifications',url:'https://github.com/example/repo/pull/12',state:'OPEN',checks:[{name:'Tests',state:'SUCCESS'},{name:'Lint',state:'IN_PROGRESS'}]}:{available:false,reason:'GitHub CLI indisponible'}};
const entries=[{kind:'tool',id:'edit',name:'Edit',input:{file_path:'/project/src/example.ts',old_string:'before',new_string:'after'},result:'ok'},
{kind:'tool',id:'failed',name:'Write',input:{file_path:'/project/failed.ts',content:'bad'},result:'failed',isError:true}];
function Body(){[session,setSession]=React.useState('s');review=useReview(session);return <div style={{width:'min(640px,100vw)',height:'100vh',display:'flex',flexDirection:'column'}}><ChangesPanel key={session} cwd="/project" entries={entries} busy={false} review={review} onClose={()=>{}}/>{review.comments.length>0&&<ReviewBar comments={review.comments} disabled={false} onSend={()=>{sent=review.toPrompt();review.clear()}} onClear={review.clear} onRemove={review.remove}/>}</div>}
createRoot(document.getElementById('root')).render(<SessionStateProvider><Body/></SessionStateProvider>);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw Error('Timeout '+fn+' DOM: '+document.querySelector('.git-workflow')?.outerHTML);await sleep(10)}}
function check(ok,message){checks++;if(!ok)throw Error(message)}
const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.title===label||e.getAttribute('aria-label')===label);
function input(el,value){Object.getOwnPropertyDescriptor(el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
async function run(){
await until(()=>document.querySelector('.change-head'));document.querySelector('.change-head').click();await until(()=>document.querySelector('.diff-line.remove'));
document.querySelector('.diff-line.remove button').click();await until(()=>document.querySelector('.diff-draft textarea'));input(document.querySelector('.diff-draft textarea'),'Conserver cette garde.');await sleep(20);button('Ajouter').click();await until(()=>review.comments.length===1);
check(document.querySelector('.diff-comment')?.textContent.includes('Conserver cette garde.'),'deleted-line comment invisible');
version='changed again';button('Relire l’état Git').click();await until(()=>document.querySelector('.diff-line.add')?.textContent.includes('changed again'));
await ipcRenderer.invoke('capture','git-review',1000);
button('Indexer').click();await until(()=>button('Désindexer'));check(actions[0].kind==='stage','stage not invoked');
input(document.querySelector('input'),'Valider les changements');await sleep(20);button('Créer le commit local').click();await until(()=>document.body.textContent.includes('Identité Git manquante'));check(document.querySelector('input').value==='Valider les changements','commit error lost message');await until(()=>!button('Créer le commit local').disabled);button('Créer le commit local').click();await until(()=>document.querySelector('.changes-count')?.textContent==='arbre propre');check(actions[1].message==='Valider les changements','wrong commit message');
button('Consulter PR / CI').click();await until(()=>document.body.textContent.includes('GitHub CLI indisponible'));
prAvailable=true;button('Consulter PR / CI').click();await until(()=>document.querySelector('.git-pr'));check(document.querySelector('.git-pr').textContent.includes('En cours'),'CI status missing');await ipcRenderer.invoke('capture','pr-ci',1000);
button('Branches et publication').click();await until(()=>button('Publier la branche')&&!button('Publier la branche').matches(':disabled'));
button('Publier la branche').click();await until(()=>button('Confirmer'));check(workflowCalls.length===0,'publication before confirmation');check(document.activeElement===button('Annuler'),'confirmation did not focus cancel');
button('Annuler').click();await sleep(20);check(workflowCalls.length===0,'cancel published');button('Publier la branche').click();await until(()=>button('Confirmer'));button('Confirmer').click();await until(()=>document.body.textContent.includes('Publication refusée'));await until(()=>!button('Publier la branche').matches(':disabled'));
button('Publier la branche').click();await until(()=>button('Confirmer'));await ipcRenderer.invoke('capture','t19-confirm',460);check(document.querySelector('.panel').scrollWidth<=460,'publication overflows');button('Confirmer').click();await until(()=>workflowCalls.length===2&&!button('Publier la branche').matches(':disabled'));check(workflowCalls[1].expectedHead===workflowHead&&workflowCalls[1].action.fingerprint==='remote-fingerprint','publication target not pinned');
document.querySelector('.git-pr-form').open=true;
const field=label=>[...document.querySelectorAll('.git-workflow label')].find(e=>e.textContent.startsWith(label)).querySelector('input,textarea,select');
input(field('Branche de destination'),'main');input(field('Titre de la PR'),'Une amélioration');input(field('Description'),'Description de test');await sleep(30);button('Créer la PR').click();await until(()=>button('Confirmer'));check(workflowCalls.length===2,'PR published before confirmation');button('Confirmer').click();await until(()=>workflowCalls.length===3&&!button('Publier la branche').matches(':disabled'));check(workflowCalls[2].action.draft===true&&workflowCalls[2].action.body==='Description de test','PR fields lost');
button('Consulter la PR de cette branche').click();await until(()=>button('Fusionner la PR'));button('Fusionner la PR').click();await until(()=>button('Confirmer'));check(document.querySelector('.git-confirm').textContent.includes('feature/l06 → main'),'merge target missing');await ipcRenderer.invoke('capture','t19-pr',460);button('Confirmer').click();await until(()=>workflowCalls.length===4&&!button('Publier la branche').matches(':disabled'));check(workflowCalls[3].action.head===workflowHead&&workflowCalls[3].action.base==='main','merge not pinned');
const select=field('Branche');select.value='main';select.dispatchEvent(new Event('change',{bubbles:true}));await sleep(20);button('Changer de branche').click();await until(()=>button('Confirmer'));button('Confirmer').click();await until(()=>workflowCalls.length===5&&!button('Publier la branche').matches(':disabled'));check(workflowCalls[4].action.branch==='main','wrong branch');
const tabs=()=>[...document.querySelectorAll('[role="tab"]')];tabs().find(e=>e.textContent.startsWith('Conversation')).click();await until(()=>document.querySelector('.change-head'));check(document.querySelectorAll('.change-head').length===1,'failed tool included');document.querySelector('.change-head').click();await until(()=>document.querySelector('.diff-line.add'));
document.querySelector('.diff-line.add button').click();await until(()=>document.querySelector('.diff-draft textarea'));input(document.querySelector('.diff-draft textarea'),'Tester ce cas.');await sleep(20);button('Ajouter').click();await until(()=>review.comments.length===2);
await ipcRenderer.invoke('capture','session-review',1000);await ipcRenderer.invoke('capture','session-narrow',460);check(document.querySelector('.review-bar').scrollWidth<=460,'review overflows narrow viewport');
setSession('other');await until(()=>review.comments.length===0);setSession('s');await until(()=>review.comments.length===2);button('Envoyer la revue').click();await until(()=>review.comments.length===0);check(sent.includes('Conserver cette garde.')&&sent.includes('Tester ce cas.'),'review lost comments');
files=[{path:'src/example.ts',status:'U',staged:false,added:0,removed:0}];button('Relire l’état Git').click();await until(()=>document.body.textContent.includes('Conflits à résoudre'));check(button('Créer le commit local').disabled,'conflict commit enabled');await ipcRenderer.invoke('capture','conflict-narrow',460);
check(document.querySelector('.panel').scrollWidth<=460,'panel overflows');mode='unavailable';button('Relire l’état Git').click();await until(()=>document.body.textContent.includes('Git indisponible'));await ipcRenderer.invoke('capture','unavailable',460);return checks;
}
run().then(checks=>ipcRenderer.send('done',{ok:true,checks}),error=>ipcRenderer.send('done',{ok:false,error:String(error.stack)}));
`)
  const built = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(built.success).toBe(true)
  if (!built.success) throw new Error(built.logs.join('\n'))
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>#root{height:100vh}.panel{flex:1;min-height:0}</style><div id="root"></div><script src="test.js"></script>')
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
