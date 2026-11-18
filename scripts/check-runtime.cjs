// Vérifier le module natif dans le runtime qui chargera réellement main.js.
// Les chemins explicites empêchent un repli sur les dépendances du dépôt parent.
const { accessSync, constants } = require('node:fs')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')

const desktop = join(__dirname, '..')

try {
  const electron = require(join(desktop, 'node_modules', 'electron'))
  accessSync(electron, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  accessSync(join(desktop, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron'),
    process.platform === 'win32' ? constants.F_OK : constants.X_OK)

  const result = spawnSync(electron, ['-e', 'require(process.argv[1])',
    join(desktop, 'node_modules', 'node-pty')], {
    cwd: desktop,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `Electron interrompu (${result.signal ?? result.status})`)
  }
  console.log('Runtime desktop : Electron et node-pty opérationnels.')
} catch (error) {
  console.error('\nInstallation desktop incomplète ou incompatible avec cette plateforme.')
  console.error(error instanceof Error ? error.message : String(error))
  console.error('\nDepuis le dossier desktop, réinstaller les dépendances locales :\n  npm ci --foreground-scripts\nPuis relancer :\n  npm start')
  console.error('Ne pas réutiliser un dossier node_modules provenant d’un autre système.')
  process.exitCode = 1
}
