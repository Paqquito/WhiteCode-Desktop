/**
 * Bundling de la coquille applicative.
 *
 *     bun run build.ts          # production
 *     bun run build.ts --dev    # sourcemaps, sans minification
 *
 * Le moteur est cherché dans le dépôt voisin `../WhiteCode`, ou dans
 * `DESKTOP_ENGINE_DIR`. L'identité de marque est `identity/whitecode.identity.json`
 * du moteur, ou le fichier désigné par `DESKTOP_IDENTITY` (chemin relatif au
 * moteur ou absolu) : c'est elle qui donne le nom, les dossiers, la couleur et
 * l'icône de l'application.
 *
 * Trois cibles, trois contraintes distinctes :
 *
 *  - **main** et **preload** tournent dans Node, côté Electron. Sortie CJS :
 *    le chargeur de préchargement d'Electron est le plus fiable dans ce
 *    format, et `electron` doit rester externe — c'est le runtime hôte, pas
 *    une dépendance à embarquer.
 *  - **renderer** tourne dans Chromium. Sortie ESM, cible navigateur, React
 *    inclus dans le bundle.
 */

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { bundleModules, loadModules } from './scripts/nativeModules.js'

const ROOT = dirname(fileURLToPath(import.meta.url))
const OUT = join(ROOT, 'dist')
const DEV = process.argv.includes('--dev')

const ENGINE = resolve(ROOT, process.env.DESKTOP_ENGINE_DIR ?? join('..', 'WhiteCode'))
const identityArg = process.env.DESKTOP_IDENTITY ?? join('identity', 'whitecode.identity.json')
const identityFile = isAbsolute(identityArg) ? identityArg : join(ENGINE, identityArg)
const receipt = JSON.parse(await readFile(join(ENGINE, 'dist', 'manifest.json'), 'utf8'))
const identity = Bun.spawnSync([process.execPath, '--no-env-file', 'scripts/identity.ts', 'resolve', identityFile, '--strict', '--version', receipt.version], { cwd: ENGINE, stdout: 'pipe', stderr: 'pipe' })
if (identity.exitCode !== 0) throw new Error(`Identité de marque refusée (${identityFile}) : ${identity.stderr.toString()}`)
const resolved = JSON.parse(identity.stdout.toString())
if (receipt.source?.identity !== resolved.hash) throw Error('Le moteur a été construit avec une autre identité. Reconstruisez le moteur avant le desktop.')
await rm(OUT, { recursive: true, force: true })
await mkdir(join(OUT, 'renderer'), { recursive: true })
const value = (name: string): string | undefined => { const data = resolved.values[name]?.value; return data === undefined ? undefined : typeof data === 'string' ? data : data[resolved.defaultLanguage] ?? data.fr ?? data.en }
const required = (name: string): string => { const data = value(name); if (!data) throw new Error(`Identité incomplète : ${name}.`); return data }
const brand = { product: required('PRODUCT'), color: required('BRAND_COLOR_PRIMARY'), scheme: required('URL_SCHEME') + '-desktop' }
await writeFile(join(OUT, 'distribution.json'), JSON.stringify({ identityHash: resolved.hash, product: brand.product, slug: required('PRODUCT_SLUG'), cli: required('PRODUCT_CLI'), envPrefix: required('ENV_PREFIX'), urlScheme: required('URL_SCHEME'), instructionsFile: required('INSTRUCTIONS_FILE'), bundleId: required('PRODUCT_BUNDLE_ID'), extensionCatalogs: resolved.desktop?.extensionCatalogs ?? [] }, null, 2))

const moduleRoots = [resolve(ROOT, '..', 'WhiteCode-Extensions', 'modules')]
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== '--modules') continue
  const root = process.argv[++i]
  if (!root || root.startsWith('--')) throw Error('--modules attend un dossier de modules natifs.')
  moduleRoots.push(resolve(root))
}
const modules = await loadModules(resolved.desktop?.modules ?? [], [...new Set(moduleRoots)], OUT)

// The compiler and source-level tests consume the same selected services as the two bundles.
const configArg = process.argv.indexOf('--compiler-config')
if (configArg >= 0) {
  if (!process.argv[configArg + 1] || process.argv[configArg + 1]!.startsWith('--')) throw Error('Chemin de configuration TypeScript requis.')
  const config = resolve(process.argv[configArg + 1]!)
  const paths = Object.assign({}, ...modules.map(module => module.provides ?? {})) as Record<string, string>
  const types = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, [path]]))
  types['@whitecode/desktop-modules'] = [join(ROOT, 'packages/desktop-modules/index.d.ts')]
  // External module sources share dependencies with this Electron application.
  types.react = [join(ROOT, 'node_modules/@types/react/index.d.ts')]
  types['react/jsx-runtime'] = [join(ROOT, 'node_modules/@types/react/jsx-runtime.d.ts')]
  types.electron = [join(ROOT, 'node_modules/electron/electron.d.ts')]
  const files = [join(ROOT, 'src/bootstrap/index.ts'), join(ROOT, 'src/main/preload.ts'), join(ROOT, 'src/renderer/index.tsx'),
    ...Object.values(paths), ...modules.flatMap(module => [module.main, module.renderer].filter((p): p is string => !!p))]
  await mkdir(dirname(config), { recursive: true })
  await writeFile(config, JSON.stringify({ extends: join(ROOT, 'tsconfig.json'), compilerOptions: { paths: types, typeRoots: [join(ROOT, 'node_modules/@types')] }, files, include: [], exclude: [] }, null, 2))
}

const shared = {
  minify: !DEV,
  sourcemap: DEV ? ('linked' as const) : ('none' as const),
}

/** Processus principal et préchargement. */
const node = await Bun.build({
  entrypoints: [join(ROOT, 'src', 'bootstrap', 'index.ts'), join(ROOT, 'src', 'main', 'preload.ts')],
  outdir: OUT,
  naming: '[name].[ext]',
  plugins: [bundleModules(modules, 'main', ROOT)],
  target: 'node',
  format: 'cjs',
  // `electron` est le runtime hôte. `node-pty` est un module **natif** : le
  // bundler y fige des chemins absolus vers `node_modules`, ce qui marche sur
  // la machine de compilation et nulle part ailleurs. Chargé à l'exécution, il
  // résout ses binaires par lui-même, pour la bonne plateforme.
  external: ['electron', 'node-pty'],
  ...shared,
})

/** Interface. La marque est figée dans le bundle : aucun nom n'est écrit en dur dans les composants. */
const web = await Bun.build({
  plugins: [bundleModules(modules, 'renderer', ROOT)],
  define: { __BRAND__: JSON.stringify(brand) },
  entrypoints: [join(ROOT, 'src', 'renderer', 'index.tsx')],
  outdir: join(OUT, 'renderer'),
  naming: 'renderer.js',
  target: 'browser',
  format: 'esm',
  ...shared,
})

for (const result of [node, web]) {
  if (result.success) continue
  console.error('\nÉchec du build :\n')
  for (const log of result.logs) console.error(`  ${log.message}`)
  process.exit(1)
}


// Fichiers statiques : ils ne passent pas par le bundler.
await cp(
  join(ROOT, 'src', 'renderer', 'index.html'),
  join(OUT, 'renderer', 'index.html'),
)

/**
 * Feuille de style : les `@import` sont résolus ici, pas par le navigateur.
 *
 * `styles.css` est découpé par surface et ne contient qu'une liste d'imports.
 * La livrer telle quelle ferait charger seize fichiers en cascade au premier
 * rendu — chacun découvert à la lecture du précédent — alors que le style doit
 * être là avant la première peinture, sous peine de voir la fenêtre s'ouvrir
 * sans mise en forme puis basculer.
 *
 * L'ordre des imports **est** la cascade : il est suivi tel quel, et le résultat
 * est le fichier d'avant la découpe, octet pour octet.
 */
const ENTREE = join(ROOT, 'src', 'renderer', 'styles.css')
const manifeste = await readFile(ENTREE, 'utf8')
const morceaux: string[] = []
for (const ligne of manifeste.split('\n')) {
  const imported = /^@import\s+'([^']+)'\s*;/.exec(ligne.trim())
  if (imported) {
    morceaux.push(await readFile(join(dirname(ENTREE), imported[1]!), 'utf8'))
    continue
  }
  // Une règle écrite dans le manifeste serait silencieusement perdue.
  const reste = ligne.replace(/\/\*.*?\*\//g, '').trim()
  if (reste && !reste.startsWith('/*') && !reste.startsWith('*')) {
    console.error(`\nstyles.css ne doit contenir que des @import — trouvé : ${reste}\n`)
    process.exit(1)
  }
}
for (const module of modules) {
  for (const file of module.styles ?? []) morceaux.push(await readFile(file, 'utf8'))
}
await writeFile(join(OUT, 'renderer', 'styles.css'), morceaux.join('\n'))

/**
 * Feuille de style de xterm, copiée plutôt qu'importée depuis le bundle.
 *
 * La politique de sécurité du rendu impose `style-src 'self'` : un style
 * injecté à l'exécution par le bundler serait bloqué. Servi comme fichier, il
 * passe.
 */
await cp(
  join(ROOT, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
  join(OUT, 'renderer', 'xterm.css'),
)

/**
 * Scripts Python des corpus documentaires.
 *
 * Copiés et non bundlés : ce n'est pas du JavaScript, et ils sont lancés comme
 * des programmes à part entière par l'environnement Python dédié. Le processus
 * principal les cherche dans `dist/rag/`.
 */
await mkdir(join(OUT, 'rag'), { recursive: true })
for (const script of ['rag_index.py', 'rag_server.py']) {
  await cp(
    join(ROOT, 'src', 'main', 'rag', 'scripts', script),
    join(OUT, 'rag', script),
  )
}

/**
 * Icône de marque, dans `dist/renderer/assets/`.
 *
 * La politique de sécurité du rendu n'autorise que `img-src 'self'` : l'image
 * est servie depuis le même dossier que la page. L'icône `ICON` de l'identité
 * est reprise si c'est un PNG (Electron l'exige pour la fenêtre) ; sinon,
 * l'icône neutre de la marque blanche : un carré noir.
 */
await mkdir(join(OUT, 'renderer', 'assets'), { recursive: true })
const iconValue = value('ICON')
const iconBytes = iconValue ? await readFile(join(dirname(identityFile), iconValue)) : undefined
const brandIcon = iconValue && /\.png$/i.test(iconValue) ? iconBytes! : new Resvg(
  iconBytes ?? '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512"/></svg>',
  { fitTo: { mode: 'width', value: 512 } },
).render().asPng()
await writeFile(join(OUT, 'renderer', 'assets', 'icon.png'), brandIcon)

const total = [...node.outputs, ...web.outputs].reduce((n, o) => n + o.size, 0)
console.log(`dist — ${(total / 1024).toFixed(0)} Ko · ${brand.product}`)
