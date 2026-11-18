import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('L04 activity, streaming, interruption, results and reading position in Chromium', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const renderer = fileURLToPath(new URL('..', import.meta.url))
  const shared = fileURLToPath(new URL('../../shared', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'sample-l04-'))
  const captures = join(desktop, 'tmp/l04')
  await mkdir(captures, { recursive: true })
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { jsx: 'react' } }))
  const entry = join(directory, 'test.tsx')
  await writeFile(entry, `
    import * as React from ${JSON.stringify(join(desktop, 'node_modules/react/index.js'))};
    import {createRoot} from ${JSON.stringify(join(desktop, 'node_modules/react-dom/client.js'))};
    import {Thread} from ${JSON.stringify(join(renderer, 'thread/Thread.tsx'))};
    import {FileLinkContext} from ${JSON.stringify(join(renderer, 'thread/fileLink.tsx'))};
    import {AgentsPanel} from ${JSON.stringify(join(renderer, 'panels/AgentsPanel.tsx'))};
    import {initialThreadState,threadReducer} from ${JSON.stringify(join(shared, 'thread.ts'))};
    const {ipcRenderer}=window.require('electron');
    let dispatch,replace,state,edited='',opened='',reviewed=false,permission=false;let checks=0;
    const errors=[];window.addEventListener('error',e=>errors.push(e.message));
    function App(){
      const [value,setValue]=React.useState(initialThreadState);state=value;
      const [agents,setAgents]=React.useState(false);
      dispatch=action=>setValue(previous=>threadReducer(previous,action));replace=setValue;
      return <FileLinkContext.Provider value={path=>{opened=path}}><main className="l04-fixture">
        <header className="topbar"><span className="topbar-title">Améliorer la page d’accueil</span><span>WhiteCode · recette L04</span></header>
        <div className="conversation"><Thread entries={value.entries} busy={value.status.busy} cancelling={value.cancelling} waiting={Boolean(value.pending)}
          onInterrupt={window.interruptTurn=()=>{dispatch({type:'interrupt-requested'});setTimeout(()=>dispatch({type:'turn-end',outcome:'interrupted'}),30)}}
          onPermission={()=>{permission=true}} onEdit={text=>{edited=text}}
          onReview={()=>{reviewed=true}} onShowAgents={()=>setAgents(true)}/>
          <div className="composer"><div className="composer-card"><textarea aria-label="Brouillon de recette" placeholder="Décrivez la suite…" /></div></div>
        </div>
        {agents&&<div className="fixture-agents"><AgentsPanel entries={value.entries} onClose={()=>setAgents(false)}/></div>}
      </main></FileLinkContext.Provider>
    }
    const root=createRoot(document.getElementById('root'));root.render(<App/>);
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw new Error('Timeout '+fn.toString());await sleep(10)}}
    function check(value,message){checks++;if(!value)throw new Error(message)}
    const button=label=>[...document.querySelectorAll('button')].find(e=>e.textContent===label||e.getAttribute('aria-label')===label);
    const tool=(id,name,input={},patch={})=>({kind:'tool',id,name,input,...patch});
    const event=message=>dispatch({type:'engine-message',message});
    async function run(){
      await until(()=>dispatch);
      replace({...initialThreadState,status:{...initialThreadState.status,busy:true},entries:[
        {kind:'user',id:'u',text:'Améliore la page d’accueil et vérifie les styles.'},
        tool('read','Read',{file_path:'/projet/src/home.tsx'},{result:'Contenu lu'}),
        tool('grep','Grep',{pattern:'hero'},{result:'Commande indisponible',isError:true}),
        tool('agent','Task',{description:'Vérifier l’accessibilité'},{child:{steps:2,lastText:'Je vérifie les contrastes.'}}),
      ]});
      await until(()=>document.querySelector('.activity-group'));
      check(!document.querySelector('.activity-group').open,'activity should start compact');
      check(document.querySelectorAll('.activity-group').length===1,'adjacent tools not grouped');
      check(document.querySelector('.activity-group summary').textContent.includes('en échec'),'tool failure hidden in collapsed summary');
      check(document.querySelector('.activity-preview').textContent.includes('2 étapes'),'child progress missing');
      await ipcRenderer.invoke('capture','running',1100);
      document.querySelector('.activity-group summary').click();
      button('Voir les sous-tâches').click();await until(()=>document.querySelector('.agent-list'));
      check(document.querySelector('.agent-status').textContent==='en cours','active agent not identified');
      event({type:'assistant',parent_tool_use_id:'agent',message:{content:[{type:'text',text:'Contrastes contrôlés.'}]}});
      await until(()=>document.querySelector('.agent-last')?.textContent==='Contrastes contrôlés.');
      check(![...document.querySelectorAll('.entry.assistant')].some(e=>e.textContent.includes('Contrastes contrôlés.')),'child output leaked into main answer');
      event({type:'user',message:{content:[{type:'tool_result',tool_use_id:'agent',content:'Audit terminé',is_error:false}]}});
      await until(()=>document.querySelector('.agent-status').textContent==='terminé');
      button('Fermer Sous-tâches')?.click();
      event({type:'assistant',message:{content:[{type:'tool_use',id:'write',name:'Write',input:{file_path:'/projet/src/home.tsx',content:'export const Home = () => null'}}]}});
      event({type:'user',message:{content:[{type:'tool_result',tool_use_id:'write',content:'Fichier écrit',is_error:false}]}});
      event({type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'text',text:''}}});
      event({type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'La page d’accueil est plus lisible.'}}});
      await until(()=>document.querySelector('.entry.assistant')?.textContent.includes('plus lisible'));
      check(document.querySelector('.four-square-loader')!==null,'streaming loader absent');
      check(document.querySelectorAll('.four-square-loader > span').length===4,'loader must have four squares');
      check(getComputedStyle(document.querySelector('.four-square-loader > span')).animationName==='four-square-pulse','loader not animated');
      await ipcRenderer.invoke('capture','four-square',1100);
      event({type:'result',subtype:'success',is_error:false});dispatch({type:'turn-end',outcome:'done'});
      await until(()=>document.querySelector('.turn-state').textContent.includes('Demande terminée'));
      check(document.querySelector('.four-square-loader')===null,'streaming loader survived completion');
      check(document.querySelector('.turn-tool-warning').textContent.includes('1 outil a échoué'),'failure and overall success not distinguished');
      button('home.tsx').click();check(opened==='/projet/src/home.tsx','output opens wrong file');
      button('Voir les modifications Git').click();check(reviewed,'review shortcut inactive');
      await ipcRenderer.invoke('capture','result',1100);
      dispatch({type:'user-submit',text:'Continue les vérifications.'});
      event({type:'assistant',message:{content:[{type:'tool_use',id:'wait',name:'Bash',input:{command:'npm test'}}]}});
      await until(()=>document.querySelector('.turn-summary.working')?.textContent.includes('Commande en cours'));
      window.interruptTurn();await until(()=>document.querySelectorAll('.turn-summary.interrupted').length===1);
      const interrupted=state.entries.find(e=>e.id==='wait');
      check(interrupted.interrupted&&!('result' in interrupted),'interruption fabricated a tool result');
      document.querySelector('.turn-summary.interrupted .turn-state button').click();check(edited==='Continue les vérifications.','resume did not restore exact prompt');
      check(!state.status.busy,'resume automatically submitted');
      await ipcRenderer.invoke('capture','interrupted',900);
      dispatch({type:'user-submit',text:'Action sensible'});
      event({type:'assistant',message:{content:[{type:'tool_use',id:'permission-tool',name:'Write',input:{file_path:'/projet/config.json',content:'{}'}}]}});
      event({type:'control_request',request_id:'p',request:{subtype:'can_use_tool',tool_name:'Write',input:{},tool_use_id:'permission-tool'}});
      await until(()=>button('Examiner l’autorisation'));button('Examiner l’autorisation').click();check(permission,'permission control inactive');
      dispatch({type:'permission-resolved',decision:'deny'});dispatch({type:'turn-end',outcome:'failed'});
      await until(()=>document.querySelector('.activity-count.denied'));
      check(document.querySelector('.turn-summary.failed')!==null,'request failure missing');
      // A denied command can contain thousands of characters on one line.
      const longResult='Permission denied: '+('very_long_command_without_spaces_'.repeat(150));
      replace({...initialThreadState,entries:[{kind:'user',id:'overflow-u',text:'Commande'},tool('overflow','mcp__websearch__WebSearch',{query:'x'.repeat(3000)},{result:longResult,isError:true})]});
      await until(()=>document.querySelector('.tool-result')?.textContent===longResult);
      if(!document.querySelector('.activity-group').open) document.querySelector('.activity-group > summary').click();
      if(!document.querySelector('.tool-call').open) document.querySelector('.tool-call > summary').click();
      await until(()=>document.querySelector('.tool-result').getBoundingClientRect().height>0);
      for(const width of [1100,500]) {
        await ipcRenderer.invoke('capture','long-tool-'+width,width);
        const thread=document.querySelector('.thread'), output=document.querySelector('.tool-result');
        check(thread.scrollWidth<=thread.clientWidth+1,'tool output widened the conversation');
        check(output.scrollWidth<=output.clientWidth+1,'tool result does not wrap');
        check(output.textContent===longResult,'tool output was truncated');
        check(output.getBoundingClientRect().height>0&&output.getBoundingClientRect().height<=341,'tool result hidden or exceeds height limit');
      }
      // Markdown must respect the reading margins, not just the viewport.
      const columns='secteur_num, libelle_court, libelle_long, regroupement_commune, rpi, circonscription, '.repeat(8);
      const identifier='identifiant_sans_espace_'.repeat(70);
      const tick=String.fromCharCode(96), fence=tick.repeat(3);
      const markdown=['## Résultat', '- **Colonnes détectées :** '+tick+columns+tick,
        '- '+tick+identifier+tick, '[Lien long](https://example.com)',
        'https://example.com/'+identifier, '> '+identifier,
        fence+'bash', 'python '+identifier, fence,
        '| '+identifier+' | Valeur |', '| --- | --- |', '| contenu | 411 |'].join('\\n');
      replace({...initialThreadState,entries:[{kind:'user',id:'markdown-u',text:'Validation'},
        {kind:'assistant',id:'markdown-a',text:markdown,streaming:false}]});
      await until(()=>document.querySelector('.md li code'));
      document.querySelector('.thread').scrollTop=0;
      for(const width of [1100,760,420]) {
        await ipcRenderer.invoke('capture','markdown-margins-'+width,width);
        const thread=document.querySelector('.thread'), md=document.querySelector('.md'), bounds=md.getBoundingClientRect();
        check(thread.scrollWidth<=thread.clientWidth+1,'Markdown widened the conversation');
        check(bounds.left>=thread.getBoundingClientRect().left+27,'left reading margin lost');
        check(bounds.right<=thread.getBoundingClientRect().right-27,'right reading margin lost');
        for(const element of md.querySelectorAll('li code, p, blockquote, .md-code, .md-table-wrap')) {
          for(const rect of element.getClientRects()) {
            check(rect.left>=bounds.left-1&&rect.right<=bounds.right+1,'Markdown crosses reading margins: '+element.tagName);
          }
        }
        check(document.querySelector('.md li code').textContent===columns,'inline code truncated');
        const code=document.querySelector('.md-code');
        check(code.scrollWidth>code.clientWidth,'fenced code must scroll locally');
      }
      // Long history: preserve reading position during incoming text.
      const history=[];for(let i=0;i<18;i++){history.push({kind:'user',id:'old-u-'+i,text:'Demande '+i,outcome:'done'},{kind:'assistant',id:'old-a-'+i,text:'Une réponse conservée pour vérifier le défilement. '.repeat(12),streaming:false})}
      history.push({kind:'user',id:'live-u',text:'Nouvelle analyse'},{kind:'assistant',id:'live-a',text:'Texte en cours',streaming:true});
      replace({...initialThreadState,status:{...initialThreadState.status,busy:true},entries:history});
      await until(()=>document.querySelectorAll('.thread-turn').length===19);
      const thread=document.querySelector('.thread');await sleep(50);thread.scrollTop=0;thread.dispatchEvent(new Event('scroll'));
      await until(()=>button('Revenir aux derniers messages ↓'));
      replace({...state,entries:state.entries.map(e=>e.id==='live-a'?{...e,text:e.text+' — une suite reçue'}:e)});
      await sleep(80);check(thread.scrollTop===0,'incoming stream stole reading position');
      button('Revenir aux derniers messages ↓').click();await sleep(50);
      check(thread.scrollHeight-thread.scrollTop-thread.clientHeight<64,'latest button did not reach the bottom');
      await ipcRenderer.invoke('capture','narrow',760);
      check(thread.scrollWidth<=thread.clientWidth+1,'thread overflows narrow viewport');
      check(errors.length===0,errors.join('; '));return checks;
    }
    run().then(checks=>ipcRenderer.send('done',{ok:true,checks}),error=>ipcRenderer.send('done',{ok:false,error:String(error.stack)}));
  `)
  const built = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(built.success).toBe(true)
  if (!built.success) throw new Error(built.logs.join('\n'))
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><style>#root{height:100vh}.l04-fixture{height:100%;display:grid;grid-template-rows:auto minmax(0,1fr);position:relative}.fixture-agents{position:absolute;right:12px;top:60px;width:290px;background:white;border:1px solid #ddd;border-radius:12px;z-index:5}</style><div id="root"></div><script src="test.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const {app,BrowserWindow,ipcMain}=require('electron');app.disableHardwareAcceleration();
    app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
    ipcMain.handle('capture',async(event,name,width)=>{const win=BrowserWindow.fromWebContents(event.sender);win.setSize(width,900);await new Promise(r=>setTimeout(r,130));const image=await event.sender.capturePage();require('fs').writeFileSync(${JSON.stringify(captures)}+'/'+name+'.png',image.toPNG())});
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
