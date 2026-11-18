/**
 * Le manifeste de style et ses morceaux ne doivent pas diverger.
 *
 * Rien, dans ce dépôt, ne surveille l'apparence : aucun test ne rendrait
 * visible une règle perdue. La découpe de `styles.css` en seize fichiers crée
 * deux manières nouvelles de perdre du style sans que rien ne proteste — un
 * fichier oublié dans la liste, ou une règle écrite dans le manifeste, que le
 * build ignore. Les deux tombent ici.
 *
 * Ce test ne dit rien du rendu. Il dit que tout ce qui est écrit est livré.
 */

import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const manifeste = readFileSync(join(HERE, 'styles.css'), 'utf8')

/** Les chemins importés, dans leur ordre — qui est celui de la cascade. */
const importes = [...manifeste.matchAll(/^@import\s+'\.\/styles\/([^']+)'\s*;/gm)].map(
  m => m[1]!,
)

test('le manifeste ne contient que des @import et des commentaires', () => {
  const intrus = manifeste
    .split('\n')
    .map(l => l.replace(/\/\*.*?\*\//g, '').trim())
    .filter(l => l && !l.startsWith('/*') && !l.startsWith('*') && !l.startsWith('@import'))
  // Une règle posée ici serait silencieusement perdue : le build ne recopie
  // que ce que les imports désignent.
  expect(intrus).toEqual([])
})

test('chaque fichier de styles/ est importé, et chaque import existe', () => {
  const surDisque = readdirSync(join(HERE, 'styles')).filter(n => n.endsWith('.css')).sort()
  expect([...importes].sort()).toEqual(surDisque)
})

test('aucun morceau n’est vide, et aucun n’est importé deux fois', () => {
  expect(new Set(importes).size).toBe(importes.length)
  for (const nom of importes) {
    const contenu = readFileSync(join(HERE, 'styles', nom), 'utf8')
    expect(contenu.trim().length).toBeGreaterThan(0)
    // Une tranche doit se terminer par un saut de ligne : c'est lui qui sépare
    // sa dernière règle de la première de la suivante à la recomposition.
    expect(contenu.endsWith('\n')).toBe(true)
  }
})

test('les morceaux ne se réimportent pas entre eux', () => {
  // Un `@import` dans une tranche serait laissé tel quel par le build et
  // partirait chercher un fichier absent de `dist/`.
  for (const nom of importes) {
    expect(readFileSync(join(HERE, 'styles', nom), 'utf8')).not.toContain('@import')
  }
})

/**
 * Jetons de style (lot A de l'audit UX).
 *
 * Tailles, rayons, ombres et couleurs se déclarent une fois, dans `base.css`
 * (et dans le bloc sombre de `preferences.css`), puis s'emploient par leur
 * nom. Seize tailles et dix rayons s'étaient accumulés faute de garde-fou :
 * ce test refuse tout nouveau littéral hors des déclarations de jetons.
 *
 * Seule exception : la visionneuse d'images (`.lightbox`), toujours sombre
 * quel que soit le thème, garde ses blancs translucides.
 */
const regles = (nom: string) =>
  readFileSync(join(HERE, 'styles', nom), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((ligne, i) => ({ ligne: ligne.trim(), ou: `${nom}:${i + 1}` }))
    // Une déclaration de jeton (`--fs-md: 13.5px`) est précisément l'endroit
    // où la valeur littérale a sa place.
    .filter(({ ligne }) => ligne && !ligne.startsWith('--'))

const fautes = (test: (ligne: string) => boolean, sauf: string[] = []) =>
  importes.filter(n => !sauf.includes(n)).flatMap(regles).filter(({ ligne }) => test(ligne)).map(({ ou, ligne }) => `${ou}  ${ligne}`)

test('les tailles de police passent par l’échelle --fs-*', () => {
  // Dans `font: 600 var(--fs-xs)/15px …`, ce qui suit la barre est une
  // hauteur de ligne, pas une taille : elle reste libre.
  const raccourcis = (l: string) => [...l.matchAll(/(?:^|[\s;{])font:\s*([^;}]+)/g)].map(m => m[1]!.replace(/\/[\d.]+px/g, ''))
  expect(fautes(l => /font-size:\s*[\d.]+px/.test(l) || raccourcis(l).some(v => /\b[\d.]+px/.test(v)))).toEqual([])
})

test('les rayons passent par --r-*, 999px pour les pastilles', () => {
  const valeurs = (l: string) => [...l.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;}]+)/g)].map(m => m[1]!)
  expect(fautes(l => valeurs(l).some(v => /\b(?!999px)\d+(\.\d+)?px/.test(v)))).toEqual([])
})

test('les ombres portées passent par --shadow-*', () => {
  expect(fautes(l => /box-shadow:[^;]*(rgba\(|#[0-9a-f]{3,8}\b)/i.test(l))).toEqual([])
})

test('aucune couleur hexadécimale hors des jetons', () => {
  expect(fautes(l => /#[0-9a-f]{3,8}\b/i.test(l))).toEqual([])
})
