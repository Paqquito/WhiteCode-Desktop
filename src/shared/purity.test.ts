/**
 * `shared/` ne touche ni au disque ni à Electron.
 *
 * C'est la couche que les deux moitiés lisent : le processus principal et le
 * **rendu**. Un `node:fs` qui s'y glisse entre dans le paquet du rendu, et le
 * piège a déjà été payé — le paquet était passé de 1469 à 2001 Ko avant qu'on
 * remonte à un module partagé touchant au disque. Le commentaire qui l'explique
 * n'a rien empêché ; ce test, si.
 *
 * La règle porte sur les imports **de valeur**. `import type` disparaît à la
 * compilation et ne pèse rien : l'interdire couperait `shared/` des types du
 * processus principal sans rien gagner.
 */

import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Ce qu'un module du rendu ne peut pas embarquer. */
const FORBIDDEN = /^(node:|electron$|electron\/)/

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) out.push(path)
  }
  return out
}

test('aucun module de shared/ n’importe node: ou electron en valeur', () => {
  const guilty: string[] = []
  for (const file of sources(HERE)) {
    const text = readFileSync(file, 'utf8')
    // `import … from 'x'` et `import 'x'`, en écartant `import type`.
    for (const match of text.matchAll(
      /^import\s+(?!type\b)(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm,
    )) {
      if (FORBIDDEN.test(match[1]!)) guilty.push(`${file} → ${match[1]}`)
    }
  }
  expect(guilty).toEqual([])
})

test('le test de garde sait accuser', () => {
  // Sans ce contre-exemple, un motif qui ne reconnaît rien passerait au vert.
  const sample = `import { readFileSync } from 'node:fs'\nimport type { X } from 'electron'\n`
  const hits = [...sample.matchAll(/^import\s+(?!type\b)(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)]
    .map(m => m[1]!)
    .filter(s => FORBIDDEN.test(s))
  expect(hits).toEqual(['node:fs'])
})

test('shared/ n’est pas vide, sans quoi la garde ne garde rien', () => {
  expect(sources(HERE).length).toBeGreaterThanOrEqual(6)
})
