import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

test('production preferences IPC persists across restart; optional native notification while unfocused', async () => {
  const desktop = fileURLToPath(new URL('../../..', import.meta.url))
  const dir = await mkdtemp(join(tmpdir(), 'l07-ipc-')), appDir = join(dir, 'app', 'desktop')
  await mkdir(join(appDir, 'dist', 'renderer'), { recursive: true })
  await symlink(join(desktop, 'node_modules'), join(appDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  for (const file of ['index.js','preload.js','distribution.json']) await copyFile(join(desktop, 'dist', file), join(appDir, 'dist', file))
  await writeFile(join(appDir, 'dist/renderer/index.html'), '<meta charset="utf-8"><title>WhiteCode — recette L07</title><p>Recette des préférences et notifications dans un profil temporaire.</p>')
  await writeFile(join(appDir, 'package.json'), JSON.stringify({ name: 'l07-ipc', main: 'check.cjs' }))
  await writeFile(join(appDir, 'check.cjs'), `
    const {app}=require('electron');app.disableHardwareAcceleration();app.setPath('userData',${JSON.stringify(join(dir, 'profile'))});
    app.on('browser-window-created',(_,win)=>{win.webContents.once('did-finish-load',async()=>{try{
      const result=await win.webContents.executeJavaScript('(async()=>{const p=await window.engine.getPreferences();if('+process.env.L07_PHASE+'===1){p.value.theme="dark";p.value.codeSize=16;p.value.notifications.backgroundOnly=true;await window.engine.savePreferences(p.value)}return window.engine.getPreferences()})()');
      if(result.value.theme!=='dark'||result.value.codeSize!==16)throw Error('Preferences not restored');
      if(process.env.L07_NATIVE_NOTIFICATIONS==='1'&&process.env.L07_PHASE==='1'){
        if(!result.notificationsSupported)throw Error('Native notifications unsupported');
        win.minimize();await new Promise(r=>setTimeout(r,250));if(win.isFocused())throw Error('Window still focused');
        await win.webContents.executeJavaScript('window.engine.testNotification()');console.log('NATIVE_NOTIFICATION_SHOWN_WITHOUT_FOCUS');
        await new Promise(r=>setTimeout(r,1500));
      }
      console.log('PREFERENCES_OK');app.exit(0);
    }catch(error){console.error(error.stack);app.exit(1)}})});
    require('./dist/index.js');setTimeout(()=>app.exit(2),18000);
  `)
  const executable = process.platform === 'win32' ? join(desktop, 'node_modules/electron/dist/electron.exe') : process.platform === 'darwin' ? join(desktop, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : join(desktop, 'node_modules/electron/dist/electron')
  for (const phase of ['1','2']) {
    const env: NodeJS.ProcessEnv = { ...process.env, L07_PHASE: phase }; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(executable, [appDir], { env, stdio: ['ignore','pipe','pipe'] })
    let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk)
    const timeout = setTimeout(() => child.kill(), 22000)
    const code = await new Promise((resolve,reject) => { child.once('error',reject);child.once('close',resolve) }).finally(()=>clearTimeout(timeout))
    if (code !== 0) throw Error(output)
    expect(output).toContain('PREFERENCES_OK')
    if (process.env.L07_NATIVE_NOTIFICATIONS === '1' && phase === '1') { expect(output).toContain('NATIVE_NOTIFICATION_SHOWN_WITHOUT_FOCUS'); console.log('Native notification: system confirmed delivery while window was unfocused.') }
  }
  expect(JSON.parse(await readFile(join(dir, 'profile/preferences.json'), 'utf8')).codeSize).toBe(16)
}, 50000)
