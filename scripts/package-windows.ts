import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import { Resvg } from '@resvg/resvg-js'

if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('Windows x64 requis.')
const desktop = resolve(import.meta.dir, '..')
const engine = resolve(process.env.DESKTOP_ENGINE_DIR ?? join(desktop, '..', 'WhiteCode'))
const distribution = JSON.parse(await readFile(join(desktop, 'dist/distribution.json'), 'utf8'))
const { product, slug, cli, bundleId } = distribution
if (!/^[a-z][a-z0-9-]+$/.test(slug) || !/^[a-z][a-z0-9-]+$/.test(cli)) throw Error('Identité invalide.')
const manifest = JSON.parse(await readFile(join(engine, 'dist/manifest.json'), 'utf8'))
const binary = cli + '.exe'
const binaryBytes = await readFile(join(engine, 'dist', binary))
const receipt = manifest.deliverables.find((item: { file: string }) => item.file === binary)
if (manifest.source?.identity !== distribution.identityHash || receipt?.sha256 !== createHash('sha256').update(binaryBytes).digest('hex')) {
  throw Error('Le moteur et le desktop doivent être construits avec la même identité.')
}
const output = resolve(process.env.DESKTOP_RELEASE_DIR ?? join(desktop, 'release'))
await mkdir(output, { recursive: true })
const stage = await mkdtemp(join(output, slug + '-'))
await cp(join(desktop, 'node_modules/electron/dist'), stage, { recursive: true })
const app = join(stage, 'resources/app')
await mkdir(app, { recursive: true })
await cp(join(desktop, 'dist'), join(app, 'dist'), { recursive: true })
await writeFile(join(app, 'package.json'), JSON.stringify({ name: slug + '-desktop', productName: product, version: manifest.version, main: 'dist/index.js' }))
const runtime = join(stage, 'resources/engine/dist')
await mkdir(runtime, { recursive: true })
await writeFile(join(runtime, binary), binaryBytes)
await cp(join(engine, 'dist/manifest.json'), join(runtime, 'manifest.json'))
// Older engine builds may only provide their standalone executable and receipt.
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
  if (manifest.deliverables.some((entry: { file: string }) => entry.file === file)) {
    await cp(join(engine, 'dist', file), join(runtime, file))
  }
}
const pty = join(app, 'node_modules/node-pty')
await mkdir(pty, { recursive: true })
for (const path of ['package.json', 'LICENSE', 'lib', 'prebuilds/win32-x64']) {
  await cp(join(desktop, 'node_modules/node-pty', path), join(pty, path), { recursive: true })
}
const png = await readFile(join(app, 'dist/renderer/assets/icon.png'))
const icon = new Data.IconFile()
for (const size of [16, 24, 32, 48, 64, 128, 256]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}"><image width="${size}" height="${size}" xlink:href="data:image/png;base64,${png.toString('base64')}"/></svg>`
  icon.icons.push({ data: Data.RawIconItem.from(new Resvg(svg).render().asPng(), size, size, 32) })
}
await writeFile(join(stage, slug + '.ico'), Buffer.from(icon.generate()))
const exePath = join(stage, slug + '.exe')
await rename(join(stage, 'electron.exe'), exePath)
if (existsSync(join(stage, 'electron_wer.dll'))) await rename(join(stage, 'electron_wer.dll'), join(stage, slug + '_wer.dll'))
const exe = NtExecutable.from(await readFile(exePath), { ignoreCert: true })
const resources = NtExecutableResource.from(exe)
const [group] = Resource.IconGroupEntry.fromEntries(resources.entries)
if (!group) throw Error('Icône Windows absente.')
Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icon.icons.map(i => i.data))
const [version] = Resource.VersionInfo.fromEntries(resources.entries)
if (!version) throw Error('Version Windows absente.')
for (const lang of version.getAllLanguagesForStringValues()) version.setStringValues(lang, {
  ProductName: product, FileDescription: product, ProductVersion: manifest.version, InternalName: slug, OriginalFilename: slug + '.exe',
})
version.outputToResourceEntries(resources.entries)
resources.outputResource(exe)
await writeFile(exePath, Buffer.from(exe.generate()))
console.log(exePath)
if (process.env.INNO_SETUP_COMPILER) {
  const result = spawnSync(process.env.INNO_SETUP_COMPILER, ['/Qp', '/DStage=' + stage, '/DProduct=' + product, '/DSlug=' + slug,
    '/DBundleId=' + bundleId, '/DVersion=' + manifest.version, join(desktop, 'scripts/windows.iss')], { stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw result.error ?? Error('Construction de l’installeur impossible.')
}
