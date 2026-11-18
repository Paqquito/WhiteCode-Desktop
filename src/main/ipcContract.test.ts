/**
 * Le pont IPC est complet dans les deux sens.
 *
 * `preload.ts` est la seule surface ouverte au rendu ; `index.ts` est le seul
 * endroit qui y répond. Les deux listes doivent coïncider exactement, et rien
 * ne les y oblige aujourd'hui : un canal perdu ne se voit ni au typage — les
 * noms sont des chaînes — ni aux tests, qui éprouvent les modules et non leur
 * câblage. Il ne se voit qu'à l'usage, sur le seul chemin concerné.
 *
 * C'est le filet de R03, qui redistribue ces 74 canaux par domaine. Un canal
 * oublié, mal orthographié ou enregistré deux fois tombe ici plutôt que devant
 * l'utilisateur.
 *
 * Ce que ce test **ne** couvre **pas**, et qu'aucune lecture de source ne
 * couvrira : l'ordre de construction. Un canal peut être correctement
 * enregistré et lire un objet pas encore bâti. Cela demande l'application
 * lancée.
 *
 * La lecture se fait sur le texte, à dessein. Importer `index.ts` ouvrirait une
 * fenêtre Electron et lancerait l'application.
 */

import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(HERE, name), 'utf8')

/** Les noms sont des littéraux : les chercher tels quels est fiable ici. */
function channels(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map(match => match[1]!)
}

const preload = read('preload.ts')
/** Ce que le rendu appelle et attend en retour. */
const invoked = channels(preload, /ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)
/** Ce que le rendu écoute, et que le principal doit donc émettre. */
const listened = channels(preload, /ipcRenderer\.on\(\s*'([^']+)'/g)
/**
 * Ce à quoi le processus principal répond.
 *
 * Balayé sur tout `main/` depuis R03 : les canaux ne sont plus enregistrés dans
 * `index.ts` mais à côté de leur domaine. Le test avait été écrit avant, et
 * c'est lui qui a signalé le déplacement — ce qu'on lui demande.
 */
/**
 * Ce que le principal pousse vers la fenêtre.
 *
 * Balayé sur tout `main/`, et non sur `index.ts` seul : `terminal.ts` émet ses
 * deux canaux directement, sans passer par le relais. C'est ce test qui l'a
 * montré. Le relais n'est donc pas le seul chemin, et supposer le contraire
 * aurait rendu la garde fausse.
 */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.ts$/.test(path) && !/\.test\.ts$/.test(path)) out.push(path)
  }
  return out
}
const handled = sources(HERE).flatMap(file =>
  channels(readFileSync(file, 'utf8'), /(?:ipcMain|applicationIpc)\.(?:handle|on)\(\s*'([^']+)'/g),
)
const emitted = sources(HERE).flatMap(file =>
  channels(readFileSync(file, 'utf8'), /(?:toRenderer|\.send)\(\s*'([^']+)'/g),
)

test('chaque appel du rendu trouve son répondant, et réciproquement', () => {
  expect([...new Set(invoked)].sort()).toEqual([...new Set(handled)].sort())
})

test('aucun canal n’est enregistré deux fois', () => {
  const seen = new Map<string, number>()
  for (const channel of handled) seen.set(channel, (seen.get(channel) ?? 0) + 1)
  expect([...seen].filter(([, count]) => count > 1)).toEqual([])
})

test('chaque événement écouté par le rendu est émis par le principal', () => {
  const missing = [...new Set(listened)].filter(c => !emitted.includes(c))
  expect(missing).toEqual([])
})

test('le compte ne baisse pas en silence', () => {
  // Le compte est tenu à la main : l'égalité ci-dessus ne tomberait pas si un
  // canal disparaissait des **deux** côtés à la fois. À mettre à jour
  // sciemment quand on en ajoute un — c'est le but, que ça se remarque.
  // L10 ajoute surface:open, surface:bounds, surface:close et surface:command.
  // L09 ajoute routines:update et routines:history.
  // L07 ajoute preferences:get, preferences:save et preferences:test.
  // L06 ajoute git:action et git:pr.
  // 74 au sortir de R03, plus `sessions:meta`, `workspace:reveal` et `projects:meta` (L02).
  // L11 ajoute activity:read (agrégats locaux, module activé seulement).
  // La séparation de la marque blanche retire les canaux propres à une distribution
  expect(new Set(handled).size).toBe(106)
  expect(new Set(listened).size).toBe(11)
})

test('les motifs savent reconnaître et savent ignorer', () => {
  // Sans contre-exemple, un motif qui ne reconnaît rien rendrait deux listes
  // vides, donc égales, donc vertes.
  const sample = `ipcMain.handle('a:one', x)\nipcMain.on('a:two', y)\nipcRenderer.invoke('a:one')\n// ipcMain.handle(variable, z)\n`
  expect(channels(sample, /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)).toEqual(['a:one', 'a:two'])
  expect(channels(sample, /ipcRenderer\.(?:invoke|send)\(\s*'([^']+)'/g)).toEqual(['a:one'])
})
