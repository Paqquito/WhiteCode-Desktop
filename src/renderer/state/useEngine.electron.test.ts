import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

// Real Chromium/React effects, isolated from the user's app and provider credentials.
test('renderer isolates navigation, background snapshots and delayed draft/attachment updates', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const src = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/')
  /** Le reducteur est partage : il vit dans shared/, pas sous renderer/. */
  const shared = fileURLToPath(new URL('../../shared', import.meta.url)).replace(/\\/g, '/')
  const directory = await mkdtemp(join(tmpdir(), 'sample-session-renderer-'))
  await mkdir(join(desktop, 'tmp'), { recursive: true })
  const entry = join(directory, 'check.tsx')
  await writeFile(entry, `
    import * as React from ${JSON.stringify(`${desktop.replace(/\\/g, '/')}/node_modules/react/index.js`)};
    import {createRoot} from ${JSON.stringify(`${desktop.replace(/\\/g, '/')}/node_modules/react-dom/client.js`)};
    import {useEngine} from ${JSON.stringify(`${src}/state/useEngine.ts`)};
    import {useSessionState} from ${JSON.stringify(`${src}/state/useSessionState.ts`)};
    import {PermissionCard} from ${JSON.stringify(`${src}/dialogs/PermissionCard.tsx`)};
    import {ProjectList} from ${JSON.stringify(`${src}/layout/ProjectList.tsx`)};
    import {SessionList} from ${JSON.stringify(`${src}/layout/SessionList.tsx`)};
    import {Composer} from ${JSON.stringify(`${src}/composer/Composer.tsx`)};
    import {App as FullApp} from ${JSON.stringify(`${src}/App.tsx`)};
    import {initialThreadState,threadReducer} from ${JSON.stringify(`${shared}/thread.ts`)};
    const {ipcRenderer}=window.require('electron');
    const listeners=new Set(); const live=new Map(); let created=0; let controls; let edit; let draft; let renderRoot; let openListener; let requested=null; let viewed=null;
    const consoleErrors=[];console.error=(...args)=>consoleErrors.push(args.join(' '));
    let restorePoints=[]; let rewindCalls=[];
    let rewindPreview={canRewind:true,filesChanged:['/workspace-tree/note.txt'],insertions:2,deletions:1,conflicts:['/workspace-tree/note.txt'],fingerprint:'1234567890abcdef'};
    let rewindApply={canRewind:true};
    const clone=value=>structuredClone(value);
    const emit=(id,action)=>{
      const old=live.get(id); const next={...old,revision:old.revision+1,state:threadReducer(old.state,action)};
      live.set(id,next); listeners.forEach(fn=>fn(clone(next)));
    };
    window.engine={
      defaultWorkspace:async()=>'/workspace', listProjects:async()=>[],
      getProvider:async()=>({kind:'compatible'}), installedModels:async()=>[], onModelProgress:()=>()=>{},
      listCorpora:async()=>[],corporaReady:async()=>true,onCorpusProgress:()=>()=>{},
      listExtensions:async()=>[],onExtensionProgress:()=>()=>{},
      readDirectory:async()=>[{name:'note.txt',path:'/second/note.txt',kind:'file'}],
      readFile:async(root,path)=>({ok:true,path,text:'initial file',truncated:false}),
      listRestorePoints:async()=>clone(restorePoints), rewindFiles:async(id,messageId,dryRun)=>{rewindCalls.push({id,messageId,dryRun});return clone(dryRun?rewindPreview:rewindApply)},
      pathForFile:()=>'',
      liveSessions:async()=>clone([...live.values()]),
      getSession:async id=>clone(live.get(id)),
      requestedSession:async()=>requested,
      viewSession:async id=>{viewed=id;if(requested===id)requested=null},
      onOpenSession:fn=>{openListener=fn;return()=>{openListener=null}},
      createSession:async(cwd,settings,worktree,chat)=>{const id='session-'+ ++created; const s={id,cwd:chat?'/chats/'+id:cwd,chat,settings:chat?{...settings,extraDirs:[],projectInstructions:undefined}:settings,revision:0,updatedAt:created,state:clone(initialThreadState)};live.set(id,s);return clone(s)},
      resumeSession:async(id,cwd)=>clone(live.get(id)),
      forkSession:async(id,chat)=>{const source=live.get(id);const fork=await window.engine.createSession(source.cwd,source.settings,undefined,chat||source.chat);fork.state=clone(source.state);live.set(fork.id,fork);return clone(fork)},
      onSession:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},onTurnEnd:()=>()=>{},onNotice:()=>()=>{},
      send:async(id,text)=>emit(id,{type:'user-submit',text}),
      interrupt:async id=>emit(id,{type:'turn-end'}),
      setSessionSettings:async(id,settings)=>{const old=live.get(id);const next={...old,revision:old.revision+1,settings};live.set(id,next);listeners.forEach(fn=>fn(clone(next)));return clone(next)},
      respondToPermission:async(id)=>emit(id,{type:'permission-resolved',decision:'deny'})
    };
    function App(){const [cwd,setCwd]=React.useState('/workspace'); controls=useEngine(cwd,()=>{},setCwd);[draft,edit]=useSessionState(controls.activeId,'');return React.createElement('div',null,controls.activeId+':'+draft)}
    let assertions=0;
    function check(ok,message){assertions++;if(!ok)throw new Error(message)}
    async function until(fn){const end=Date.now()+4000;while(!fn()){if(Date.now()>end)throw new Error('renderer timeout after '+assertions+' assertions: '+document.body.innerText.slice(-3000));await new Promise(r=>setTimeout(r,10))}}
    async function run(){
      renderRoot=createRoot(document.getElementById('root'));renderRoot.render(React.createElement(React.StrictMode,null,React.createElement(App)));
      await until(()=>controls?.ready);const a=controls.activeId;check(created===1,'StrictMode created duplicate engines');
      edit('draft A');await until(()=>draft==='draft A');const lateEditA=edit;
      controls.send('alpha');await until(()=>controls.status.busy);
      await controls.startNewSession('/second');await until(()=>controls.activeId!==a);const b=controls.activeId;
      check(draft==='','A draft leaked into B');check(live.get(a).state.status.busy,'navigation stopped A');
      edit('draft B');await until(()=>draft==='draft B');lateEditA('late attachment A');await new Promise(r=>setTimeout(r,30));check(draft==='draft B','late callback mutated B');
      controls.send('beta');await until(()=>controls.status.busy);emit(a,{type:'notice',tone:'info',text:'background A'});
      await new Promise(r=>setTimeout(r,30));check(!JSON.stringify(controls.entries).includes('background A'),'A stream leaked into B');
      await controls.openSession(a,'/workspace');await until(()=>controls.activeId===a);check(draft==='late attachment A','A state lost');
      check(JSON.stringify(controls.entries).includes('background A'),'background progress lost');
      controls.interrupt();await until(()=>!controls.status.busy);check(live.get(b).state.status.busy,'A interruption stopped B');
      const current=clone(live.get(a));listeners.forEach(fn=>fn({...current,revision:0,state:clone(initialThreadState)}));await new Promise(r=>setTimeout(r,30));
      check(JSON.stringify(controls.entries).includes('alpha'),'stale snapshot replaced live state');
      controls.updateSettings(s=>({...s,effort:'low'}));await until(()=>controls.settings.effort==='low');
      await controls.openSession(b,'/second');await until(()=>controls.activeId===b);check(controls.settings.effort!=='low','A settings leaked into B');
      emit(b,{type:'engine-message',message:{type:'control_request',request_id:'permission-b',request:{subtype:'can_use_tool',tool_name:'Write',input:{},tool_use_id:'tool-b'}}});
      await until(()=>controls.pending);
      await controls.openSession(a,'/workspace');await until(()=>controls.activeId===a);check(!controls.pending,'B permission leaked into A');
      await controls.openSession(b,'/second');await until(()=>controls.activeId===b);check(controls.pending?.requestId==='permission-b','background permission lost');
      renderRoot.unmount();controls=undefined;renderRoot=createRoot(document.getElementById('root'));renderRoot.render(React.createElement(App));await until(()=>controls?.ready&&controls.activeId===b);
      check(controls.pending?.requestId==='permission-b'&&controls.status.busy,'renderer reload lost live state');
      check(created===2,'reload created replacement engines');
      requested=a;openListener(a);await until(()=>controls.activeId===a&&viewed===a);
      check(controls.entries.some(e=>e.kind==='user'&&e.text==='alpha'),'notification opened the wrong conversation');
      check(controls.pending===null,'notification mixed session permissions');
      renderRoot.unmount();controls=undefined;requested=b;renderRoot=createRoot(document.getElementById('root'));renderRoot.render(React.createElement(App));
      await until(()=>controls?.ready&&controls.activeId===b&&requested===null);
      check(controls.pending?.requestId==='permission-b','notification pending during reload was lost');
      await controls.split();await until(()=>controls.cells?.length===2);const c=controls.activeId;
      check(c!==b&&controls.cells[0].activeId===b,'split replaced the first session');
      const cellB=controls.cells[0],cellC=controls.cells[1];
      cellC.send('gamma');await until(()=>live.get(c).state.status.busy);
      check(live.get(b).state.status.busy,'splitting interrupted B');
      cellB.interrupt();await until(()=>!live.get(b).state.status.busy);
      check(live.get(c).state.status.busy,'left cell interruption stopped right cell');
      controls.focusSession(b);await until(()=>controls.activeId===b&&viewed===b);
      check(controls.cells[1].entries.some(e=>e.kind==='user'&&e.text==='gamma'),'focusing left lost right history');
      requested=c;openListener(c);await until(()=>controls.activeId===c&&viewed===c);
      check(controls.cells.length===2&&controls.cells[0].activeId===b,'notification duplicated or replaced a visible session');
      await controls.openSession(b,'/second');await until(()=>controls.activeId===b);
      check(controls.cells[1].activeId===c,'sidebar duplicated a session already visible');
      controls.closeSplit();await until(()=>controls.cells.length===1);
      check(controls.activeId===b&&live.get(c).state.status.busy,'closing split lost focus or stopped hidden work');
      const createOriginal=window.engine.createSession;let releaseSplit;
      window.engine.createSession=(...args)=>new Promise(resolve=>{releaseSplit=()=>createOriginal(...args).then(resolve)});
      const opening=controls.split();controls.closeSplit();releaseSplit();await opening;
      window.engine.createSession=createOriginal;
      check(controls.cells.length===1&&controls.activeId===b,'late split reopened a closed cell');
      await controls.split();await until(()=>controls.cells.length===2);
      const d=controls.activeId;await controls.openSession(c,'/second');await until(()=>controls.activeId===c);
      check(controls.cells[0].activeId===b,'opening background session replaced wrong cell');
      renderRoot.unmount();controls=undefined;renderRoot=createRoot(document.getElementById('root'));renderRoot.render(React.createElement(App));
      await until(()=>controls?.ready&&controls.cells?.length===2);
      check(controls.activeId===c&&controls.cells[0].activeId===b,'renderer reload lost split selection');
      renderRoot.unmount();renderRoot=createRoot(document.getElementById('root'));renderRoot.render(React.createElement(FullApp));
      const cells=()=>[...document.querySelectorAll('.session-cell')];
      const button=(root,label)=>[...root.querySelectorAll('button')].find(b=>b.textContent===label||b.getAttribute('aria-label')===label||b.querySelector('.menu-item-label')?.textContent.trim()===label);
      const menuAction=async(root,label)=>{await new Promise(r=>setTimeout(r,120));button(root,'Actions de la conversation').click();await until(()=>document.querySelector('[role=menu]'));button(document,label).click();};
      const panelAction=async(root,label)=>{const trigger=[...root.querySelectorAll('.topbar-menu-trigger')].find(b=>b.textContent.startsWith('Panneaux'));trigger.focus();await new Promise(r=>setTimeout(r,120));trigger.click();await until(()=>button(root,label));button(root,label).click();};
      const type=(area,value)=>{area.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,value);area.dispatchEvent(new Event('input',{bubbles:true}))};
      await until(()=>cells().length===2&&cells().every(c=>c.querySelector('textarea')));
      type(cells()[0].querySelector('textarea'),'B draft in left cell');
      type(cells()[1].querySelector('textarea'),'C draft in right cell');
      await until(()=>cells()[0].querySelector('textarea').value==='B draft in left cell');
      check(cells()[1].querySelector('textarea').value==='C draft in right cell','two composers shared draft');
      await panelAction(cells()[0],'Plan');await until(()=>cells()[0].querySelector('.panel-host'));
      check(!cells()[1].querySelector('.panel-host'),'opening left panel opened right panel');
      const file=new File(['test attachment'], 'left-only.txt', {type:'text/plain'});
      let finishRead;file.text=()=>new Promise(resolve=>{finishRead=resolve});
      const transfer=new DataTransfer();transfer.items.add(file);
      cells()[0].querySelector('textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true}));
      await until(()=>finishRead);
      cells()[1].querySelector('textarea').focus();await until(()=>viewed===c);
      await menuAction(cells()[1],'Revenir à une conversation');await until(()=>cells().length===1);
      check(cells()[0].querySelector('textarea').value==='C draft in right cell','closing left cell lost right draft');
      finishRead('test attachment');await new Promise(r=>setTimeout(r,30));
      check(!cells()[0].textContent.includes('left-only.txt'),'late attachment leaked into other cell');
      await menuAction(cells()[0],'Afficher une seconde conversation');await until(()=>cells().length===2);
      requested=b;openListener(b);await until(()=>viewed===b&&cells()[1].textContent.includes('alpha')===false&&cells()[1].querySelector('textarea').value==='B draft in left cell');
      check(cells()[1].querySelector('.panel-host')!==null,'moving a session lost its panels');
      check(cells()[1].textContent.includes('left-only.txt'),'late attachment lost after moving session');
      check(cells()[0].querySelector('textarea').value==='C draft in right cell','moving B overwrote C draft');
      emit(c,{type:'turn-end'});await until(()=>!live.get(c).state.status.busy);
      type(cells()[0].querySelector('textarea'),'message from left');
      cells()[0].querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      await until(()=>live.get(c).state.status.busy);
      check(live.get(c).state.entries.some(e=>e.kind==='user'&&e.text==='message from left'),'left composer sent to wrong session');
      type(cells()[1].querySelector('textarea'),'message from right');
      cells()[1].querySelector('textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      await until(()=>live.get(b).state.status.busy);
      check(live.get(b).state.entries.some(e=>e.kind==='user'&&e.text==='message from right'),'right composer sent to wrong session');
      type(cells()[0].querySelector('textarea'),'Draft preserved through approval');
      await until(()=>viewed===c);
      for(const id of [b,c])emit(id,{type:'engine-message',message:{type:'control_request',request_id:'permission-'+id,request:{subtype:'can_use_tool',tool_name:'Write',input:{},tool_use_id:'tool-'+id}}});
      await until(()=>document.querySelectorAll('.permission-card').length===2);
      check(!document.querySelector('dialog[open]'),'permission opened a blocking dialog');
      check(viewed===c,'inactive permission stole session focus');
      check(cells().every(c=>c.querySelector('.permission-card').getBoundingClientRect().height<250),'permission card is too tall');
      await ipcRenderer.invoke('capture',1440,'t43-permissions');
      button(cells()[0],'Refuser').click();await until(()=>!live.get(c).state.pending);
      check(live.get(b).state.pending!==null,'left permission resolved right permission');
      button(cells()[1],'Autoriser une fois').click();await until(()=>!live.get(b).state.pending);
      await until(()=>cells().every(c=>c.querySelector('textarea')));
      check(cells()[0].querySelector('textarea').value==='Draft preserved through approval','permission discarded draft');
      await panelAction(cells()[0],'Plan');await until(()=>cells()[0].querySelector('.panel-host'));
      await ipcRenderer.invoke('capture',1440);
      check(cells()[0].getBoundingClientRect().right<=cells()[1].getBoundingClientRect().left+1,'cells overlap');
      await ipcRenderer.invoke('capture',900);
      check(cells().every(c=>c.querySelector('textarea').getBoundingClientRect().width>=250),'narrow window crushed composer');
      check(cells()[0].querySelector('textarea')!==cells()[1].querySelector('textarea'),'cell inputs are not independent');
      check(cells().every(c=>c.querySelector('.composer-action').getBoundingClientRect().right<=c.getBoundingClientRect().right),'send button escapes narrow cell');
      emit(c,{type:'turn-end'});await until(()=>!live.get(c).state.status.busy);
      const beforeFork=created;button(cells()[0],'Forker la conversation ici').click();
      await until(()=>created>beforeFork&&cells()[0].querySelector('textarea').value==='gamma');
      check(cells()[1].textContent.includes('message from right'),'fork replaced neighbouring session');
      check(cells()[0].querySelector('textarea').value==='gamma','fork lost its initial draft on source unmount');
      await panelAction(cells()[0],'Fichiers');await until(()=>button(cells()[0],'note.txt'));
      button(cells()[0],'note.txt').click();await until(()=>cells()[0].querySelector('.code-editor textarea'));
      type(cells()[0].querySelector('.code-editor textarea'),'unsaved file edit');
      await new Promise(r=>setTimeout(r,20));
      await panelAction(cells()[0],'Fichiers');await until(()=>!cells()[0].querySelector('.code-editor'));
      await panelAction(cells()[0],'Fichiers');await until(()=>cells()[0].querySelector('.code-editor textarea'));
      check(cells()[0].querySelector('.code-editor textarea').value==='unsaved file edit','closing panel discarded unsaved file');
      await panelAction(cells()[1],'Fichiers');await until(()=>button(cells()[1],'note.txt'));
      button(cells()[1],'note.txt').click();await until(()=>cells()[1].querySelector('.code-editor textarea'));
      check(cells()[1].querySelector('.code-editor textarea').value==='initial file','unsaved file edit leaked into other session');
      const beforeDialog=created;const priorViewed=viewed;
      const tree={id:'saved-tree',root:'/workspace',path:'/saved-tree',branch:'saved-branch'};
      let saved=[tree];let createRequest;let rejected=true;let removed=0;
      window.engine.repository=async cwd=>({root:'/workspace',branch:'main',branches:['main','free-branch']});
      window.engine.listWorktrees=async()=>clone(saved);
      window.engine.removeWorktree=async id=>{removed++;throw new Error('Worktree encore utilisé')};
      const openDialog=async()=>{await menuAction(cells().find(c=>c.classList.contains('focused')),'Choisir un autre dossier…');await until(()=>document.querySelector('dialog[open]'));return document.querySelector('dialog')};
      let modal=await openDialog();
      check(!modal.querySelector('.session-advanced input[type=checkbox]').checked && !modal.querySelector('.session-advanced').open,'direct mode is not the default');
      check(modal.contains(document.activeElement),'dialog did not capture keyboard focus');
      button(modal,'Annuler').click();await until(()=>!document.querySelector('dialog'));
      check(created===beforeDialog&&viewed===priorViewed,'cancel changed the session');
      window.engine.createSession=async(cwd,settings,request,chat)=>{
        createRequest={cwd,request};if(request&&rejected)throw new Error('Branche déjà occupée');
        const result=await createOriginal(request?.path??cwd,settings,undefined,chat);
        if(request){result.worktree={id:'new-tree',root:cwd,path:request.path,branch:request.branch};live.set(result.id,result)}
        return clone(result);
      };
      modal=await openDialog();await until(()=>!modal.querySelector('.session-advanced input[type=checkbox]').disabled);
      modal.querySelector('.session-advanced summary').click();modal.querySelector('.session-advanced input[type=checkbox]').click();await until(()=>modal.querySelector('.worktree-options'));
      const input=(label,value)=>{const el=[...modal.querySelectorAll('label')].find(l=>l.textContent.startsWith(label)).querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))};
      input('Dossier du nouveau worktree','/workspace-tree');input('Nouvelle branche','session/ui');input('Référence de départ','main');
      await new Promise(r=>setTimeout(r,20));button(modal,'Créer la copie et commencer').click();
      await until(()=>modal.querySelector('[role=alert]'));
      check(modal.textContent.includes('Branche déjà occupée'),'creation error not shown in dialog');
      check(created===beforeDialog&&viewed===priorViewed,'failed creation replaced conversation');
      check(createRequest.request.path==='/workspace-tree'&&createRequest.request.branch==='session/ui'&&createRequest.request.base==='main','worktree form lost path or branch');
      rejected=false;button(modal,'Créer la copie et commencer').click();await until(()=>!document.querySelector('dialog')&&viewed!==priorViewed);
      const worktreeId=viewed;const activeCell=()=>cells().find(c=>c.classList.contains('focused'));
      check(live.get(worktreeId).cwd==='/workspace-tree','engine did not receive the worktree cwd');
      await until(()=>activeCell().querySelector('.conversation-context'));
      check(activeCell().querySelector('.conversation-context').textContent.includes('session/ui'),'worktree badge missing');
      let fileRoot,gitRoot,terminalRoot;
      window.engine.readDirectory=async root=>{fileRoot=root;return []};
      window.engine.gitSummary=async root=>{gitRoot=root;return {available:true,branch:'session/ui',files:[]}};
      window.engine.terminalTargets=async()=>({targets:[]});
      window.engine.onTerminalData=()=>()=>{};window.engine.onTerminalExit=()=>()=>{};
      window.engine.attachTerminal=async()=>null;window.engine.createTerminal=async cwd=>{terminalRoot=cwd;return 'test-terminal'};
      window.engine.resizeTerminal=async()=>{};window.engine.killTerminal=async()=>{};window.engine.writeTerminal=async()=>{};
      button(document,'Chat').click();await until(()=>live.get(viewed)?.chat&&!activeCell().querySelector('.conversation-context'));
      const firstChat=viewed;
      await panelAction(activeCell(),'Fichiers');await until(()=>fileRoot);
      check(fileRoot===live.get(firstChat).cwd&&fileRoot.startsWith('/chats/'),'chat file explorer used the worktree');
      fileRoot=undefined;
      button(document,'Code').click();await until(()=>viewed===worktreeId&&activeCell().querySelector('.conversation-context'));
      await panelAction(activeCell(),'Fichiers');await until(()=>fileRoot);
      check(fileRoot==='/workspace-tree','file explorer used original project');
      await panelAction(activeCell(),'Modifications');await until(()=>gitRoot);
      check(gitRoot==='/workspace-tree','review used original project');
      await panelAction(activeCell(),'Terminal');await until(()=>terminalRoot);
      check(terminalRoot==='/workspace-tree','terminal used original project');
      modal=await openDialog();await until(()=>modal.querySelector('.saved-worktrees summary'));
      modal.querySelector('.saved-worktrees summary').click();button(modal,'Nettoyer…').click();
      check(removed===0,'cleanup happened before confirmation');
      await until(()=>button(modal,'Confirmer le nettoyage'));
      button(modal,'Confirmer le nettoyage').click();await until(()=>modal.querySelector('[role=alert]'));
      check(removed===1&&modal.textContent.includes('encore utilisé'),'cleanup refusal not displayed');
      await ipcRenderer.invoke('capture',900,'worktree');
      check(modal.scrollWidth<=modal.clientWidth+1,'worktree dialog overflows narrow window');
      button(modal,'Annuler').click();await until(()=>!document.querySelector('dialog'));

      // Points de restauration : la liste, l'apercu, l'avertissement, puis la
      // confirmation. L'ordre importe — rien ne doit s'ecrire avant elle.
      restorePoints=[
        {messageId:'point-ancien',text:'Premiere demande',at:'2026-09-08T09:00:00Z'},
        {messageId:'point-recent',text:'Deuxieme demande',at:'2026-09-08T10:00:00Z'},
      ];
      rewindCalls=[];
      await menuAction(activeCell(),'Points de restauration…');
      await until(()=>document.querySelector('.restore-points'));
      const restoreModal=document.querySelector('dialog');
      const listed=[...restoreModal.querySelectorAll('.restore-text')].map(node=>node.textContent);
      check(listed[0]==='Deuxieme demande'&&listed[1]==='Premiere demande','restore points are not newest first');
      restoreModal.querySelectorAll('.restore-choose')[0].click();
      await until(()=>restoreModal.querySelector('.restore-files'));
      check(rewindCalls.length===1&&rewindCalls[0].dryRun===true&&rewindCalls[0].messageId==='point-recent','preview asked for the wrong point or wrote');
      check(restoreModal.textContent.includes('+2 / −1'),'preview did not show the line counts');
      check(restoreModal.querySelector('.restore-warning').textContent.includes('écrasées'),'no warning about manual edits');
      check(!rewindCalls.some(call=>call.dryRun===false),'preview wrote to disk');
      await ipcRenderer.invoke('capture',900,'restore-apercu');

      // Un tour en cours dans le dossier : la confirmation doit rester fermee.
      emit(worktreeId,{type:'user-submit',text:'tour en cours'});
      await until(()=>button(restoreModal,'Restaurer ces fichiers')?.disabled);
      check(rewindCalls.filter(call=>call.dryRun===false).length===0,'a busy turn still allowed a restore');
      emit(worktreeId,{type:'turn-end'});
      await until(()=>!button(restoreModal,'Restaurer ces fichiers').disabled);
      button(restoreModal,'Restaurer ces fichiers').click();
      await until(()=>rewindCalls.some(call=>call.dryRun===false));
      const applied=rewindCalls.filter(call=>call.dryRun===false);
      check(applied.length===1&&applied[0].messageId==='point-recent','restore targeted the wrong point');
      await until(()=>restoreModal.querySelector('.restore-done'));
      await ipcRenderer.invoke('capture',900,'restore');
      check(restoreModal.scrollWidth<=restoreModal.clientWidth+1,'restore dialog overflows narrow window');
      button(restoreModal,'Fermer').click();await until(()=>!document.querySelector('dialog'));

      let mcpSaved;
      const mcpServers=[
        {id:'documentation',label:'Documentation',enabled:true,source:'internal',transport:'http',address:'https://documentation.example.org/mcp'},
        {id:'websearch',label:'WebSearch',enabled:true,source:'internal',transport:'stdio',address:'ssh'},
        {id:'rag_one',label:'Corpus local',enabled:true,source:'corpus',transport:'stdio',address:'python'}
      ];
      window.engine.listConnectors=async()=>[];window.engine.listMcp=async()=>clone(mcpServers);
      window.engine.probeMcp=async id=>id==='documentation'?{ok:true,elapsedMs:30,tools:['FindDocs','FindCode','Demo_findObject','Demo_getObject','Demo_editObject','Demo_assistObject','Demo_createTask'].map(name=>({name,description:'Outil interne'}))}:{ok:false,tools:[],elapsedMs:30,error:'Connexion MCP impossible'};
      window.engine.saveMcp=async entry=>{mcpSaved=entry;mcpServers.push({...entry,source:'user',transport:entry.config.type,address:entry.config.url})};
      window.engine.enableMcp=async(id,enabled)=>{mcpServers.find(s=>s.id===id).enabled=enabled};
      window.engine.removeMcp=async id=>{mcpServers.splice(mcpServers.findIndex(s=>s.id===id),1)};
      const otherSettings=clone(live.get(b).settings);
      check(button(document,'Paramètres'),'settings shortcut missing');
      button(activeCell(),'Connecteurs').click();await until(()=>document.querySelectorAll('.mcp-server').length===3);
      const card=id=>document.querySelector('.mcp-server[aria-label="'+id+'"]');
      card('Documentation').querySelector('summary').click();button(card('Documentation'),'Tester et découvrir').click();await until(()=>card('Documentation').querySelectorAll('[role=status] details').length===7);
      check(card('Documentation').textContent.includes('FindCode'),'MCP tools not displayed');
      [...card('WebSearch').querySelectorAll('label')].find(l=>l.textContent==='Cette conversation').querySelector('input').click();
      await until(()=>live.get(worktreeId).settings.mcpServers?.length===2);
      check(!live.get(worktreeId).settings.mcpServers.includes('websearch'),'session exclusion ignored');
      check(JSON.stringify(live.get(b).settings)===JSON.stringify(otherSettings),'MCP selection leaked into adjacent session');
      card('WebSearch').querySelector('summary').click();button(card('WebSearch'),'Tester et découvrir').click();await until(()=>card('WebSearch').textContent.includes('Connexion MCP impossible'));
      check(!document.querySelector('.mcp-settings button:disabled'),'probe failure left controls disabled');
      document.querySelector('details.mcp-editor summary').click();button(document,'Ajouter un serveur').click();await until(()=>document.querySelector('form.mcp-editor'));
      const editor=document.querySelector('form.mcp-editor');
      for(const [el,value] of [[editor.querySelectorAll('input')[0],'custom'],[editor.querySelectorAll('input')[1],'Custom']]){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
      type(editor.querySelector('textarea'),'{invalid');await new Promise(r=>setTimeout(r,20));button(editor,'Enregistrer le serveur').click();await until(()=>document.querySelector('.mcp-settings [role=alert]'));
      check(!mcpSaved,'invalid JSON saved');
      type(editor.querySelector('textarea'),JSON.stringify({type:'http',url:'https://example.org/mcp',headers:{Authorization:'Bearer ui-test'}}));await new Promise(r=>setTimeout(r,20));
      button(editor,'Enregistrer le serveur').click();await until(()=>!document.querySelector('form.mcp-editor')&&card('Custom'));
      check(mcpSaved.config.headers.Authorization==='Bearer ui-test','custom credentials not submitted');
      check(!card('Custom').textContent.includes('ui-test'),'credentials exposed in server list');
      card('Custom').querySelector('summary').click();button(card('Custom'),'Supprimer…').click();await until(()=>button(card('Custom'),'Confirmer la suppression'));
      check(mcpServers.length===4,'server removed without confirmation');
      button(card('Custom'),'Confirmer la suppression').click();await until(()=>!card('Custom'));
      await ipcRenderer.invoke('capture',900,'mcp');
      const panel=document.querySelector('.settings-panel');check(panel.scrollWidth<=panel.clientWidth+1,'MCP panel overflows narrow window');
      button(document,'Fermer les paramètres').click();await until(()=>!document.querySelector('.settings'));
      // L03 : ouverture directe, contexte, pièces jointes et reprise après
      // disparition des ids desktop (simulation d'un redémarrage du moteur).
      await menuAction(activeCell(),'Revenir à une conversation');await until(()=>cells().length===1);
      button(document,'Chat').click();await until(()=>live.get(viewed)?.chat);
      const previousChat=live.get(viewed).cwd;
      const beforeNew=created;
      await menuAction(cells()[0],'Nouvelle conversation');await until(()=>created===beforeNew+1&&document.querySelector('.conversation.is-empty'));
      check(live.get(viewed).chat&&live.get(viewed).cwd!==previousChat,'new Chat reused another conversation directory');
      const newChatId=viewed;
      check(!document.querySelector('dialog')&&!document.querySelector('.cell-toolbar'),'new conversation still requires a form or permanent toolbar');
      await ipcRenderer.invoke('capture',1200,'l03-empty');
      const welcome=document.querySelector('.conversation-welcome').getBoundingClientRect();
      const composer=document.querySelector('.composer').getBoundingClientRect();
      check(welcome.bottom<=composer.top&&composer.top<window.innerHeight*.6,'empty composer not centered below welcome');
      check(!document.querySelector('.conversation-context'),'project context visible in Chat');
      button(document,'Code').click();await until(()=>document.querySelector('.conversation-context'));
      document.querySelector('.conversation-context summary').click();
      check(document.querySelector('.context-content').textContent.includes('/workspace-tree'),'working folder absent from context');
      document.querySelector('.conversation-context summary').click();
      button(document,'Chat').click();await until(()=>viewed===newChatId&&!document.querySelector('.conversation-context'));
      window.engine.chooseAttachments=async()=>['/workspace-tree/note.txt'];
      window.engine.prepareAttachments=async paths=>paths.map(path=>({kind:'text',name:'note.txt',path,text:'prepared content',bytes:16,truncated:false}));
      button(document,'Ajouter au message').click();await until(()=>button(document,'Ajouter des fichiers ou des photos'));
      button(document,'Ajouter des fichiers ou des photos').click();await until(()=>document.querySelector('.chip-name')?.textContent==='note.txt');
      button(document,'Lire note.txt').click();await until(()=>document.querySelector('.attachment-preview[open]'));
      check(document.querySelector('.attachment-preview pre').textContent==='prepared content','attachment preview does not match sent content');
      button(document,'Fermer l’aperçu').click();await until(()=>!document.querySelector('.attachment-preview'));
      button(document,'Retirer note.txt').click();await until(()=>!document.querySelector('.chip'));
      const dropped=new File(['Dropped text'],'dropped.txt',{type:'text/plain'});
      const dropTransfer=new DataTransfer();dropTransfer.items.add(dropped);
      document.querySelector('.composer-card').dispatchEvent(new DragEvent('drop',{dataTransfer:dropTransfer,bubbles:true,cancelable:true}));
      await until(()=>button(document,'Lire dropped.txt'));
      button(document,'Lire dropped.txt').click();await until(()=>document.querySelector('.attachment-preview[open]'));
      check(document.querySelector('.attachment-preview pre').textContent==='Dropped text','dropped file content lost');
      button(document,'Fermer l’aperçu').click();await until(()=>!document.querySelector('.attachment-preview'));
      button(document,'Retirer dropped.txt').click();await until(()=>!document.querySelector('.chip'));
      const bad=new File([new Uint8Array([0,1,2])],'binary.bin',{type:'application/octet-stream'});
      const badTransfer=new DataTransfer();badTransfer.items.add(bad);
      document.querySelector('.composer textarea').dispatchEvent(new ClipboardEvent('paste',{clipboardData:badTransfer,bubbles:true}));
      await until(()=>document.querySelector('.chip.rejected'));
      type(document.querySelector('.composer textarea'),'Brouillon à retrouver après redémarrage');
      await until(()=>button(document,'Envoyer le message').disabled);
      check(document.querySelector('.composer [role=alert]').textContent.includes('refusés'),'refused attachment has no explanation');
      button(document,'Retirer binary.bin').click();await until(()=>!document.querySelector('.chip'));
      await until(()=>localStorage.getItem('desktop:drafts:v1')?.includes('Brouillon à retrouver'));
      const draftSession=viewed;
      localStorage.setItem('desktop:settings',JSON.stringify({...live.get(viewed).settings,extraDirs:['/wrong-project']}));
      renderRoot.unmount();live.clear();window.engine.defaultWorkspace=async()=>'/workspace-tree';
      renderRoot=createRoot(document.getElementById('root'));renderRoot.render(React.createElement(FullApp));
      await until(()=>document.querySelector('.draft-recovery'));
      check(viewed!==draftSession,'restart did not replace volatile desktop id');
      check(live.get(viewed).settings.extraDirs.length===0,'restart inherited directory permissions from another project');
      type(document.querySelector('.composer textarea'),'Texte commencé');await until(()=>document.querySelector('.composer textarea').value==='Texte commencé');
      document.querySelector('.draft-recovery summary').click();
      button(document,'Brouillon à retrouver après redémarrage').click();
      await until(()=>document.querySelector('.composer textarea').value.endsWith('Brouillon à retrouver après redémarrage'));
      check(document.querySelector('.composer textarea').value.startsWith('Texte commencé'),'recovery overwrote the current draft');
      check(document.querySelector('.conversation.is-empty')!==null,'restoring a draft sent it to the engine');
      const activeAfterRestart=viewed;
      button(document,'Envoyer le message').click();await until(()=>live.get(activeAfterRestart).state.status.busy);
      check(!document.querySelector('.conversation.is-empty'),'composer stayed centered after sending');
      // Lot D : écrire pendant une réponse met le message en file ; il part seul à la fin.
      type(document.querySelector('.composer textarea'),'Message mis en file');await until(()=>document.querySelector('.composer textarea').value==='Message mis en file');
      button(document,'Mettre le message en file d’attente').click();await until(()=>document.querySelector('.composer-queue')?.textContent.includes('Message mis en file'));
      check(button(document,'Arrêter la réponse'),'stop control missing while queuing');
      check(![...document.querySelectorAll('.turn-summary button')].some(b=>b.textContent==='Arrêter'),'thread still duplicates the stop control');
      const userTexts=()=>live.get(activeAfterRestart).state.entries.filter(e=>e.kind==='user').map(e=>e.text);
      check(!userTexts().includes('Message mis en file'),'queued message sent before the end of the response');
      emit(activeAfterRestart,{type:'turn-end',outcome:'done'});
      await until(()=>userTexts().at(-1)==='Message mis en file'&&!document.querySelector('.composer-queue'));
      // Une réponse interrompue met la file en pause : rien ne part sans accord.
      type(document.querySelector('.composer textarea'),'Après interruption');await until(()=>document.querySelector('.composer textarea').value==='Après interruption');
      button(document,'Mettre le message en file d’attente').click();await until(()=>document.querySelector('.composer-queue'));
      emit(activeAfterRestart,{type:'turn-end',outcome:'interrupted'});
      await until(()=>document.querySelector('.composer-queue')?.textContent.includes('File en pause'));
      check(!userTexts().includes('Après interruption'),'queue resumed by itself after an interruption');
      button(document,'Envoyer le suivant').click();await until(()=>userTexts().at(-1)==='Après interruption'&&!document.querySelector('.composer-queue'));
      emit(activeAfterRestart,{type:'turn-end'});await until(()=>!live.get(activeAfterRestart).state.status.busy);
      check(!document.querySelector('.conversation-context'),'restart shows project context in Chat');
      button(document,'Code').click();await until(()=>document.querySelector('.conversation-context'));
      const codeAfterRestart=viewed;
      const contextSession=live.get(codeAfterRestart);
      const contextSnapshot={...contextSession,revision:contextSession.revision+1,settings:{...contextSession.settings,extraDirs:['/shared/docs'],projectInstructions:'Répondre en français et respecter les conventions du projet.'},state:{...contextSession.state,entries:[...contextSession.state.entries,
        {kind:'tool',id:'read-file',name:'Read',input:{file_path:'/workspace-tree/README.md'},result:'Read content'},
        {kind:'tool',id:'write-file',name:'Write',input:{file_path:'/workspace-tree/report.md'},result:'File written'},
        {kind:'tool',id:'failed-file',name:'Write',input:{file_path:'/workspace-tree/failed.md'},result:'Permission denied',isError:true}]}};
      live.set(codeAfterRestart,contextSnapshot);listeners.forEach(fn=>fn(clone(contextSnapshot)));
      await until(()=>document.querySelector('.context-count').textContent.includes('1 fichier'));
      document.querySelector('.conversation-context summary').click();
      check(document.querySelector('.context-content').textContent.includes('respecter les conventions'),'project instructions absent from context');
      check(!document.querySelector('.context-content').textContent.includes('failed.md'),'failed output counted as a produced file');
      await ipcRenderer.invoke('capture',1200,'l03-context');
      document.querySelector('.context-content').scrollTop=document.querySelector('.context-content').scrollHeight;
      await ipcRenderer.invoke('capture',1200,'l03-outputs');
      button(document,'Retirer l’accès à /shared/docs').click();await until(()=>live.get(codeAfterRestart).settings.extraDirs.length===0);
      document.querySelector('.conversation-context summary').click();
      await ipcRenderer.invoke('capture',900,'l03-thread');
      const composerBottom=document.querySelector('.composer').getBoundingClientRect().bottom;
      check(composerBottom<=window.innerHeight+1,'composer escaped short viewport: '+composerBottom+' > '+window.innerHeight);
      await menuAction(cells()[0],'Choisir un autre dossier…');await until(()=>document.querySelector('dialog[open]'));
      await ipcRenderer.invoke('capture',1200,'l03-folder');
      button(document,'Annuler').click();await until(()=>!document.querySelector('dialog'));
      button(cells()[0],'Actions de la conversation').click();await until(()=>document.querySelector('[role=menu]'));
      await ipcRenderer.invoke('capture',1200,'l03-menu');
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await until(()=>!document.querySelector('[role=menu]'));
      check(document.activeElement.getAttribute('aria-label')==='Actions de la conversation','menu did not return keyboard focus');
      // L07 navigation shortcuts act on the focused application, not through a modal.
      const beforeSidebar=Boolean(document.querySelector('.sidebar'));
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true}));await until(()=>Boolean(document.querySelector('.sidebar'))!==beforeSidebar);
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true}));await until(()=>Boolean(document.querySelector('.sidebar'))===beforeSidebar);
      window.dispatchEvent(new KeyboardEvent('keydown',{key:',',ctrlKey:true,bubbles:true}));await until(()=>document.querySelector('dialog.settings[open]'));
      check(document.querySelector('.settings-tab.active').textContent==='Général','settings shortcut did not open general preferences');
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'b',ctrlKey:true,bubbles:true}));await new Promise(r=>setTimeout(r,20));check(Boolean(document.querySelector('.sidebar'))===beforeSidebar,'shortcut escaped modal');
      button(document,'Fermer les paramètres').click();await until(()=>!document.querySelector('dialog.settings'));
      document.documentElement.dataset.theme='dark';await new Promise(r=>setTimeout(r,40));await ipcRenderer.invoke('capture',1200,'l07-dark-workbench');document.documentElement.dataset.theme='light';
      button(document,'Chat').click();await until(()=>!document.querySelector('.conversation-context'));
      renderRoot.unmount();renderRoot=createRoot(document.getElementById('root'));
      let sentImage=false;
      const visionProps={sessionId:'vision-test',workspace:'/vision-test',busy:false,disabled:false,
        attachments:[{kind:'image',name:'pixel.png',path:'/pixel.png',mediaType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9N8AAAAASUVORK5CYII=',bytes:68}],
        corpora:[],extensions:[],models:[{id:'local-text',label:'Un modèle local avec un nom particulièrement long pour vérifier la largeur du sélecteur'}],
        showEffort:true,seed:null,settings:{permissionMode:'acceptEdits',model:'local-text',effort:'high'},status:clone(initialThreadState.status),
        onSubmit:()=>{sentImage=true},onInterrupt:()=>{},onDropFiles:()=>{},onPasteFiles:()=>{},onPickFiles:()=>{},onRemoveAttachment:()=>{},onOpenAttachment:()=>{},onToggleCorpus:()=>{},onToggleExtension:()=>{},onOpenSettings:()=>{},onPermissionMode:()=>{},onModel:()=>{},onEffort:()=>{}};
      renderRoot.render(React.createElement(Composer,{...visionProps,supportsImages:false}));
      await until(()=>document.querySelector('.composer textarea'));
      type(document.querySelector('.composer textarea'),'Analyser cette image');await until(()=>document.querySelector('.composer textarea').value==='Analyser cette image');
      check(button(document,'Envoyer le message').disabled&&document.querySelector('[role=alert]').textContent.includes('ne lit pas les images'),'incompatible image not explained or blocked');
      document.querySelector('.composer textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      check(!sentImage,'Enter bypassed image compatibility');
      await ipcRenderer.invoke('capture',900,'l03-capabilities');
      check(document.querySelector('.composer-tools').scrollWidth<=document.querySelector('.composer-tools').clientWidth+1,'long model name overflows composer');
      renderRoot.render(React.createElement(Composer,{...visionProps,supportsImages:true}));await until(()=>!button(document,'Envoyer le message').disabled);
      button(document,'Envoyer le message').click();await until(()=>sentImage);
      const decisions=[];let stopped=false;
      const pending={requestId:'visual-permission',toolUseId:'web-1',toolName:'mcp__websearch__WebSearch',input:{query:'llama.cpp latest version',limit:5,context:'x'.repeat(12000)}};
      const approval=React.createElement(PermissionCard,{pending,onDecide:allow=>decisions.push(allow),onInterrupt:()=>{stopped=true}});
      const approvalProps={...visionProps,attachments:[],supportsImages:true,busy:true,permission:approval};
      renderRoot.render(React.createElement(Composer,approvalProps));await until(()=>document.querySelector('.permission-card'));
      check(!document.querySelector('dialog'),'approval is modal');
      check(!document.querySelector('.permission-details').open,'details start expanded');
      check(document.querySelector('.permission-card').getBoundingClientRect().height<230,'approval too tall');
      await ipcRenderer.invoke('capture',900,'t43-permission');
      await ipcRenderer.invoke('capture',500,'t43-permission');
      check(document.documentElement.scrollWidth<=window.innerWidth,'approval overflows narrow viewport');
      document.querySelector('.permission-details').open=true;await new Promise(r=>setTimeout(r,30));
      check(document.querySelector('.permission-detail-body').getBoundingClientRect().height<=241,'details not bounded');
      button(document,'Refuser').focus();button(document,'Refuser').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      check(decisions.length===1&&decisions[0]===false,'Escape did not deny once');
      button(document,'Autoriser une fois').click();check(decisions[1]===true,'allow once lost');
      button(document,'Arrêter la réponse').click();check(stopped,'interrupt lost');
      let choiceResult;
      const questions=[{header:'Horaire',question:'À quelle heure ?',options:[{label:'14:30',description:'Disponible'},{label:'15:30',description:'Disponible'}]}];
      const choice=React.createElement(PermissionCard,{pending:{...pending,toolName:'request_user_choice',input:{questions}},onDecide:(_allow,input)=>{choiceResult=input},onInterrupt:()=>{}});
      renderRoot.render(React.createElement(Composer,{...approvalProps,permission:choice}));
      await until(()=>document.querySelector('.choice-card'));
      const validate=button(document,'Valider mon choix');
      check(validate.disabled,'choice submitted without an answer');
      document.querySelectorAll('.choice-option')[1].click();await until(()=>!validate.disabled);
      validate.click();check(choiceResult.answers[0].labels[0]==='15:30','clicked label did not select the slot');
      document.querySelector('.choice-write').click();
      await until(()=>document.activeElement===document.querySelector('.choice-text'));
      check(validate.disabled,'previous slot stayed active during free text entry');
      type(document.activeElement,'Mardi matin');await until(()=>!validate.disabled);
      validate.click();check(choiceResult.answers[0].other==='Mardi matin','free text was not submitted');
      document.querySelector('.choice-write').click();await until(()=>document.querySelector('.choice-option input:checked'));
      validate.click();check(choiceResult.answers[0].labels[0]==='15:30','closing free text lost the previous selection');
      renderRoot.unmount();renderRoot=createRoot(document.getElementById('root'));
      const sidebarSessions=[
        {id:'running',title:'Analyse du projet',activity:'running',updatedAt:4},
        {id:'done',title:'Correction terminée en arrière-plan',unread:true,updatedAt:3},
        {id:'failed',title:'Vérification des tests',attention:{phase:'failed'},updatedAt:2},
        {id:'idle',title:'Documentation du projet',updatedAt:1}];
      const sidebarActions=()=>({meta:()=>{},fork:()=>{},worktree:()=>{},reveal:()=>{},copy:()=>{}});
      const renderSidebar=()=>renderRoot.render(React.createElement('aside',{className:'sidebar'},React.createElement(SessionList,{projects:[{name:'Example',cwd:'/workspace',sessions:sidebarSessions}],loading:false,activeSessionId:null,actionsFor:sidebarActions,onOpenSession:s=>{s.unread=false;renderSidebar()}})));
      renderSidebar();await until(()=>document.querySelectorAll('.session-indicator').length===4);
      check(getComputedStyle(document.querySelector('.session-orbit')).animationName==='session-orbit','working indicator does not rotate');
      check(!document.querySelector('.session-activity'),'verbose sidebar status remains');
      check(document.querySelectorAll('.indicator-unread').length===1,'background completion has no blue dot');
      check(document.querySelector('.indicator-failed').getAttribute('aria-label')==='Une erreur est survenue','error inaccessible');
      await ipcRenderer.invoke('capture',500,'t46-sidebar');
      document.documentElement.dataset.theme='dark';await ipcRenderer.invoke('capture',500,'t46-sidebar-dark');document.documentElement.dataset.theme='light';
      const order=()=>Array.from(document.querySelectorAll('.session-title')).map(x=>x.textContent).join('|');
      const beforeOpen=order();document.querySelector('.indicator-unread').closest('button').click();await until(()=>!document.querySelector('.indicator-unread'));
      check(order()===beforeOpen,'opening unread conversation changed ordering');
      renderRoot.unmount();renderRoot=createRoot(document.getElementById('root'));
      const project={name:'Example',cwd:'/workspace',sessions:Array.from({length:8},(_,i)=>({id:'p'+i,title:'Conversation '+i,updatedAt:8-i}))};
      const renderProjects=forceOpen=>renderRoot.render(React.createElement('aside',{className:'sidebar'},React.createElement(ProjectList,{projects:[project],activeCwd:'/workspace',activeSessionId:null,loading:false,forceOpen,actionsFor:sidebarActions,projectActions:()=>({}),onOpenSession:()=>{}})));
      renderProjects(false);await until(()=>document.querySelectorAll('.session-title').length===5);
      check(order()===project.sessions.slice(0,5).map(s=>s.title).join('|'),'collapsed projects lost recency ordering');
      button(document,'Voir plus').click();await until(()=>document.querySelectorAll('.session-title').length===8);
      await ipcRenderer.invoke('capture',500,'design-projects-expanded');
      button(document,'Voir moins').click();await until(()=>document.querySelectorAll('.session-title').length===5);
      renderProjects(true);await until(()=>document.querySelectorAll('.session-title').length===8);
      check(!button(document,'Voir plus'),'search results hidden behind expansion');
      renderProjects(false);await until(()=>document.querySelectorAll('.session-title').length===5);
      await ipcRenderer.invoke('capture',500,'design-projects');
      renderRoot.unmount();renderRoot=createRoot(document.getElementById('root'));
      check(consoleErrors.length===0,'React console errors: '+consoleErrors.join('; '));
      return assertions;
    }
    run().then(assertions=>ipcRenderer.send('checked',{ok:true,assertions}),error=>ipcRenderer.send('checked',{ok:false,error:String(error.stack)}));
  `)
  const build = await Bun.build({ entrypoints: [entry], outdir: directory, target: 'browser', format: 'iife' })
  expect(build.success).toBe(true)
  if (!build.success) throw new Error(build.logs.join('\n'))
  // Celle de `dist/`, pas celle de `src/` : depuis la découpe par surface, la
  // source n'est qu'une liste d'`@import` que le build recompose. C'est aussi
  // plus juste — le test éprouve ce qui est livré.
  await cp(join(desktop, 'dist/renderer/styles.css'), join(directory, 'styles.css'))
  await cp(join(desktop, 'dist/renderer/assets'), join(directory, 'assets'), { recursive: true })
  await writeFile(join(directory, 'index.html'), '<meta charset="utf-8"><link rel="stylesheet" href="styles.css"><div id="root"></div><script src="check.js"></script>')
  await writeFile(join(directory, 'main.cjs'), `
    const {app,BrowserWindow,ipcMain}=require('electron');
    app.disableHardwareAcceleration();
    app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
    ipcMain.handle('capture',async(event,width,name='cells')=>{const win=BrowserWindow.fromWebContents(event.sender);win.setSize(width+1,900);await new Promise(r=>setTimeout(r,100));win.setSize(width,900);await new Promise(r=>setTimeout(r,150));const shot=await event.sender.capturePage(undefined,{stayHidden:true,stayAwake:true});require('node:fs').writeFileSync(${JSON.stringify(join(desktop, 'tmp'))}+'/'+name+'-ui-'+width+'.png',shot.toPNG());});
    app.whenReady().then(()=>{const window=new BrowserWindow({show:true,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});window.webContents.on('console-message',(_event,...args)=>console.log('RENDERER',...args));window.loadFile(${JSON.stringify(join(directory, 'index.html'))});});
    ipcMain.on('checked',(_event,result)=>{console.log('CHECKED '+JSON.stringify(result));app.exit(result.ok?0:1)});
    setTimeout(()=>app.exit(2),20000);
  `)
  const executable = process.platform === 'win32' ? join(desktop, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin' ? join(desktop, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    : join(desktop, 'node_modules/electron/dist/electron')
  let output = ''
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [join(directory, 'main.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const watchdog = setTimeout(() => child.kill(), 25000)
  const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) }).finally(() => clearTimeout(watchdog))
  if (code !== 0) throw new Error(`Electron check failed (${code}): ${output}`)
  expect(output).toContain('"ok":true')
  expect(output).toMatch(/"assertions":\d+/)
}, 30000)
