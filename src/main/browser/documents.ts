import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { DOCUMENT_PREVIEW, HTML_PREVIEW } from '../../shared/browser.js'
const run = promisify(execFile)
const MAX = 50 * 1024 * 1024
export type DocumentData = { body: Uint8Array; mime: string; title: string }
let conversion: Promise<unknown> = Promise.resolve()
/** Shared by previews and integration fixtures; LIBREOFFICE_PATH supports portable installs. */
export function libreOfficeExecutable(): string {
  return (
    process.env.LIBREOFFICE_PATH ??
    (process.platform === 'darwin'
      ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
      : process.platform === 'win32'
        ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'LibreOffice', 'program', 'soffice.com')
        : 'libreoffice')
  )
}
export async function readDocument(
  root: string,
  path: string,
  html?: string,
  signal?: AbortSignal,
): Promise<DocumentData> {
  const [base, file] = await Promise.all([realpath(root), realpath(path)])
  const rel = relative(base, file)
  if (
    rel === '..' ||
    rel.startsWith('../') ||
    rel.startsWith('..\\') ||
    isAbsolute(rel)
  )
    throw new Error('Fichier hors du projet.')
  if (!(await stat(file)).isFile() || (await stat(file)).size > MAX)
    throw new Error('Aperçu limité aux fichiers de moins de 50 Mo.')
  const title = basename(file)
  if (HTML_PREVIEW.test(file)) {
    const text = html ?? (await readFile(file, 'utf8'))
    if (Buffer.byteLength(text) > 1024 * 1024)
      throw new Error('Aperçu HTML limité à 1 Mo.')
    return { body: Buffer.from(text), mime: 'text/html; charset=utf-8', title }
  }
  if (!DOCUMENT_PREVIEW.test(file))
    throw new Error('Ce format ne dispose pas d’un aperçu intégré.')
  if (/\.pdf$/i.test(file))
    return { body: await readPdf(file), mime: 'application/pdf', title }
  const task = conversion
    .catch(() => {})
    .then(async () => {
      signal?.throwIfAborted()
      const directory = await mkdtemp(join(tmpdir(), 'desktop-office-'))
      try {
        const profile = join(directory, 'profile')
        await mkdir(join(profile, 'user'), { recursive: true })
        await writeFile(
          join(profile, 'user', 'registrymodifications.xcu'),
          `<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item></oor:items>`,
        )
        const input = join(directory, `document${extname(file)}`)
        await writeFile(input, await readFile(file))
        try {
          await run(
            libreOfficeExecutable(),
            [
              `-env:UserInstallation=${pathToFileURL(profile).href}`,
              '--headless',
              '--nologo',
              '--norestore',
              '--convert-to',
              'pdf',
              '--outdir',
              directory,
              input,
            ],
            {
              timeout: 30000,
              killSignal: 'SIGKILL',
              signal,
              maxBuffer: 1024 * 1024,
              windowsHide: true,
            },
          )
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new Error(
              'Installez LibreOffice pour lire les documents bureautiques dans ce panneau.',
            )
          throw new Error(
            'Conversion interrompue ou impossible (limite : 30 secondes).',
          )
        }
        let body: Uint8Array
        try {
          body = await readPdf(join(directory, 'document.pdf'))
        } catch {
          throw new Error(
            'Aucun aperçu produit. Le document peut être protégé, endommagé ou non pris en charge.',
          )
        }
        return { body, mime: 'application/pdf', title }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  conversion = task
  return task
}
async function readPdf(path: string): Promise<Uint8Array> {
  if ((await stat(path)).size > MAX)
    throw new Error('Le PDF dépasse la limite de 50 Mo.')
  const bytes = await readFile(path)
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
    throw new Error(
      'Le fichier PDF est invalide ou la conversion n’a pas produit de PDF.',
    )
  return bytes
}
