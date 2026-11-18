/** Full integration suite: fail early on prerequisites, never skip tests. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { libreOfficeExecutable } from '../src/main/browser/documents.js'

const desktop = dirname(dirname(fileURLToPath(import.meta.url)))
/** Engine repository: `DESKTOP_ENGINE_DIR`, or the sibling `WhiteCode` folder. */
const engine = resolve(process.env.DESKTOP_ENGINE_DIR ?? join(desktop, '..', 'WhiteCode'))
const portable = join(desktop, 'tmp', 'libreoffice', 'App', 'libreoffice', 'program', 'soffice.com')
if (!process.env.LIBREOFFICE_PATH && !existsSync(libreOfficeExecutable()) && process.platform === 'win32' && existsSync(portable)) {
  process.env.LIBREOFFICE_PATH = portable
}

function run(file: string, args: string[], cwd = desktop): void {
  const result = spawnSync(file, args, { cwd, stdio: 'inherit', env: process.env, windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${file} ${args.join(' ')} : échec (${result.signal ?? result.status})`)
}

try {
  for (const [file, args] of [['git', ['--version']], [libreOfficeExecutable(), ['--version']]] as const) {
    const result = spawnSync(file, [...args], { encoding: 'utf8', timeout: 15000, windowsHide: true })
    if (result.error || result.status !== 0) {
      throw new Error(`Prérequis indisponible : ${file}. Installez Git et LibreOffice (ou définissez LIBREOFFICE_PATH). Aucun test n'a été ignoré.`)
    }
    console.log(result.stdout.trim())
  }
  run('node', ['scripts/check-runtime.cjs'])
  // Integration fixtures launch these bundles; stale dist/ must never be tested.
  run(process.execPath, ['scripts/build.ts', '--profile', 'public', ...(process.env.DESKTOP_IDENTITY ? ['--identity', process.env.DESKTOP_IDENTITY] : ['--identity', 'identity/whitecode.identity.json'])], engine)
  run(process.execPath, ['run', 'build.ts'])
  run(process.execPath, ['test', 'src/', ...process.argv.slice(2)])
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
