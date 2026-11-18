import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readDocument, libreOfficeExecutable } from './documents.js'
import { browserUrl } from '../../shared/browser.js'

test('browser URLs admit web and localhost but reject privileged schemes and credentials', () => {
  expect(browserUrl('example.com')).toBe('https://example.com/')
  expect(browserUrl('localhost:3000')).toBe('http://localhost:3000/')
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hello',
    'https://user:secret@example.com',
    '',
  ])
    expect(() => browserUrl(url)).toThrow()
})
test('document preview confines real paths and preserves the HTML draft', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-doc-'))
  const outside = await mkdtemp(join(tmpdir(), 'sample-doc-outside-'))
  try {
    const html = join(directory, 'page.html')
    await writeFile(html, '<h1>Original</h1>')
    expect(
      Buffer.from(
        (await readDocument(directory, html, '<h1>Brouillon</h1>')).body,
      ).toString(),
    ).toContain('Brouillon')
    await writeFile(join(outside, 'outside.html'), '<h1>Secret</h1>')
    await symlink(outside, join(directory, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(
      readDocument(directory, join(directory, 'outside', 'outside.html')),
    ).rejects.toThrow('hors du projet')
    const bad = join(directory, 'bad.pdf')
    await writeFile(bad, 'not a pdf')
    await expect(readDocument(directory, bad)).rejects.toThrow('invalide')
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
test('office conversion uses LibreOffice locally without modifying the original', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-office-test-'))
  try {
    const input = join(directory, 'fixture.rtf'),
      source = '{\\rtf1\\ansi\\b Revue du projet\\b0\\par Un document de test.}'
    await writeFile(input, source)
    const pdf = await readDocument(directory, input)
    expect(await readFile(input, 'utf8')).toBe(source)
      expect(pdf.mime).toBe('application/pdf')
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 35000)

test('DOCX, XLSX and PPTX fixtures convert to readable PDF data', async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { pathToFileURL } = await import('node:url')
  const directory = await mkdtemp(join(tmpdir(), 'sample-office-formats-'))
  try {
    await writeFile(
      join(directory, 'word.rtf'),
      '{\\rtf1\\ansi L10 document Word}',
    )
    await writeFile(
      join(directory, 'sheet.csv'),
      'Fonction,Etat\nApercu,Disponible\n',
    )
    await writeFile(
      join(directory, 'slides.fodp'),
      `<?xml version="1.0" encoding="UTF-8"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation"><office:body><office:presentation><draw:page draw:name="L10"><draw:frame svg:x="1cm" svg:y="1cm" svg:width="20cm" svg:height="4cm"><draw:text-box><text:p>L10 presentation de test</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document>`,
    )
    for (const [input, extension] of [
      ['word.rtf', 'docx'],
      ['sheet.csv', 'xlsx'],
      ['slides.fodp', 'pptx'],
    ]) {
      await promisify(execFile)(
        libreOfficeExecutable(),
        [
          `-env:UserInstallation=${pathToFileURL(join(directory, 'export-profile')).href}`,
          '--headless',
          '--convert-to',
          extension!,
          '--outdir',
          directory,
          join(directory, input!),
        ],
        { timeout: 30000, windowsHide: true },
      )
      const path = join(directory, input!.replace(/\.[^.]+$/, `.${extension}`))
      const data = await readDocument(directory, path)
      expect(Buffer.from(data.body).subarray(0, 5).toString()).toBe('%PDF-')
      expect(data.body.byteLength).toBeGreaterThan(1000)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
