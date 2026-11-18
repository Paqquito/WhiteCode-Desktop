import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'

test('production desktop keeps its conversation across a provider change, focus and native WhiteCode retry', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const directory = await mkdtemp(join(tmpdir(), 'whitecode-electron-')), project = join(directory, 'project')
  await mkdir(project)
  const bodies: any[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === '/v1/models') return Response.json({ data: [{ id: 'team-gpt-oss-120b' }] })
    if (!path.endsWith('/messages')) return new Response('', { status: 404 })
    const body: any = await request.json(); bodies.push(body)
    const event = (type: string, extra: any) => `event: ${type}\ndata: ${JSON.stringify({ type, ...extra })}\n\n`
    const content = 'WHITE_DESKTOP_OK_' + (JSON.stringify(body.messages?.at(-1)).includes('Suite Electron') ? '2' : '1')
    return new Response(
      event('message_start', { message: { id: 'message-' + bodies.length, type: 'message', role: 'assistant', model: 'team-gpt-oss-120b', content: [], stop_reason: null, usage: { input_tokens: 12, output_tokens: 0 } } }) +
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: content } }) +
      event('content_block_stop', { index: 0 }) +
      event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } }) +
      event('message_stop', {}), { headers: { 'content-type': 'text/event-stream' } })
  } })
  const settings = { ...DEFAULT_SESSION_SETTINGS, tools: [], mcpServers: [], model: 'team-gpt-oss-120b' }
  const screenshot = join(desktop, 'tmp', 'desktop-whitecode-smoke.png')
  await mkdir(join(desktop, 'tmp'), { recursive: true })
  const result = join(directory, 'result.json')
  await writeFile(join(directory, 'check.cjs'), `
    const {app}=require('electron'), fs=require('fs');
    app.disableHardwareAcceleration();app.setAppPath(${JSON.stringify(desktop)});
    app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
    app.on('browser-window-created',(_,win)=>{
      win.hide();win.webContents.on('console-message',(_event,...args)=>console.log('renderer:',...args));
      win.webContents.once('did-finish-load',async()=>{try{
        const settings=${JSON.stringify(settings)}, project=${JSON.stringify(project)};
        await win.webContents.executeJavaScript('window.engine.setProvider('+JSON.stringify({kind:'compatible',baseUrl:${JSON.stringify('http://127.0.0.1:' + server.port)}})+')');
        const session=await win.webContents.executeJavaScript('window.engine.createSession('+JSON.stringify(project)+','+JSON.stringify(settings)+')');
        win.webContents.send('engine:open-session',session.id);
        const turn=async(text)=>win.webContents.executeJavaScript('(async()=>{const api=window.engine;const done=new Promise(resolve=>{const off=api.onTurnEnd(id=>{if(id==='+JSON.stringify(session.id)+'){off();resolve()}})});await api.send('+JSON.stringify(session.id)+','+JSON.stringify(text)+','+JSON.stringify(text)+');await done;return api.getSession('+JSON.stringify(session.id)+')})()');
        const first=await turn('Premier message Electron');
        await win.webContents.executeJavaScript('window.engine.viewSession('+JSON.stringify(session.id)+')');
        await win.webContents.executeJavaScript('window.engine.setProvider({kind:"ollama"})');
        const kept=await win.webContents.executeJavaScript('window.engine.getSession('+JSON.stringify(session.id)+')');
        if(kept.state.status.sessionId!==first.state.status.sessionId)throw Error('Provider check discarded conversation identity');
        const focused=win.isFocused;win.isFocused=()=>true;
        try{win.emit('focus');win.emit('restore')}finally{win.isFocused=focused}
        await win.webContents.executeJavaScript('window.engine.setProvider('+JSON.stringify({kind:'compatible',baseUrl:${JSON.stringify('http://127.0.0.1:' + server.port)}})+')');
        const second=await turn('Suite Electron');
        if(first.attention.phase!=='done'||second.attention.phase!=='done')throw Error(JSON.stringify(second));
        if(first.state.status.sessionId!==second.state.status.sessionId)throw Error('Session changed');
        // Wait for React's DOM to reflect the IPC snapshot, rather than sleeping a fixed delay.
        for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript('document.body.innerText.includes("WHITE_DESKTOP_OK_2")'))break;await new Promise(r=>setTimeout(r,25));}
        const text=await win.webContents.executeJavaScript('document.body.innerText');
        if(!text.includes('WHITE_DESKTOP_OK_2'))throw Error('Response missing from React: '+text);
        win.showInactive();
        await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        fs.writeFileSync(${JSON.stringify(screenshot)},(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
        fs.writeFileSync(${JSON.stringify(result)},JSON.stringify({first,second,text,profile:app.getPath('userData')}));
        console.log('WHITE_DESKTOP_OK');win.close();app.exit(0);
      }catch(error){console.error(error.stack);app.exit(1)}});
    });
    require(${JSON.stringify(join(desktop, 'dist/index.js'))});setTimeout(()=>app.exit(2),40000);
  `)
  const executable = join(desktop, 'node_modules/electron', process.platform === 'win32' ? 'dist/electron.exe' : process.platform === 'darwin' ? 'dist/Electron.app/Contents/MacOS/Electron' : 'dist/electron')
  // Resolve Electron relative to the real desktop while the runner lives in a temporary profile.
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: join(desktop, 'node_modules') }; delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [join(directory, 'check.cjs')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk)
  const timeout = setTimeout(() => child.kill(), 45000)
  try {
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
    if (code !== 0) throw new Error(output)
    expect(output).toContain('WHITE_DESKTOP_OK')
    const continuation = bodies.find(body => JSON.stringify(body.messages?.at(-1)).includes('Suite Electron'))
    expect(JSON.stringify(continuation?.messages)).toContain('Premier message Electron')
    expect(bodies.every(body => body.model === 'team-gpt-oss-120b')).toBe(true)
    const saved = JSON.parse(await readFile(result, 'utf8'))
    expect(saved.profile).toBe(join(directory, 'profile'))
    expect(saved.text).toContain('WHITE_DESKTOP_OK_1')
    expect(saved.text).toContain('WHITE_DESKTOP_OK_2')
  } finally { clearTimeout(timeout); child.kill(); server.stop(true) }
}, 50000)
