/**
 * Les deux décisions de D02.
 *
 * Le constat portait sur une colonne de lecture de 285 px dans un panneau de
 * 460. La réponse tient en deux choses qu'on peut éprouver sans navigateur :
 * l'arborescence se masque et le choix est retenu, et un Markdown s'ouvre
 * rendu.
 *
 * Ce que ce fichier ne couvre pas, et qu'il faut regarder à l'œil : la largeur
 * réelle des colonnes. Une grille CSS ne s'observe pas dans du balisage
 * statique.
 */

import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FilesPanel, opensRendered } from './FilesPanel.js'

/**
 * `localStorage` n'existe pas hors navigateur.
 *
 * Le composant s'en passe — il retombe sur « visible » si le stockage manque —
 * mais c'est précisément la persistance qu'on veut éprouver ici, donc il faut
 * un stockage. Le plus court qui suffise.
 */
const stockage = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => stockage.get(k) ?? null,
  setItem: (k: string, v: string) => void stockage.set(k, v),
  removeItem: (k: string) => void stockage.delete(k),
}

const panel = () =>
  renderToStaticMarkup(
    <FilesPanel sessionId="s" root="/r" target={null} onClose={() => {}} />,
  )

test('un Markdown s’ouvre rendu, le reste s’ouvre en source', () => {
  expect(opensRendered('/p/README.md', null)).toBe(true)
  expect(opensRendered('/p/notes.markdown', null)).toBe(true)
  expect(opensRendered('/p/main.ts', null)).toBe(false)
  // Un fichier sans extension n'est pas un Markdown : le rendre effacerait sa
  // mise en forme réelle — indentation, alignements — sans prévenir.
  expect(opensRendered('/p/Makefile', null)).toBe(false)
  expect(opensRendered(null, null)).toBe(false)
})

test('le choix de l’utilisateur prime sur le type', () => {
  expect(opensRendered('/p/README.md', false)).toBe(false)
  // Mais il ne transforme pas un fichier de code en document : demander
  // l'aperçu d'un `.ts` n'a pas de sens, et rien dans l'interface ne le propose.
  expect(opensRendered('/p/main.ts', true)).toBe(false)
})

test('l’arborescence est visible par défaut, et masquable', () => {
  localStorage.removeItem('desktop:files-tree')
  const html = panel()
  expect(html).toContain('class="files"')
  expect(html).not.toContain('tree-hidden')
  expect(html).toContain('aria-label="Masquer l’arborescence"')
})

test('le choix de masquer est retenu d’une ouverture à l’autre', () => {
  // C'est tout l'intérêt : quelqu'un qui lit du code dans ce panneau ne veut
  // pas redemander la largeur à chaque fois.
  localStorage.setItem('desktop:files-tree', 'hidden')
  const html = panel()
  expect(html).toContain('tree-hidden')
  expect(html).toContain('aria-label="Afficher l’arborescence"')
  expect(html).toContain('aria-pressed="true"')
  // Et l'arborescence n'est pas seulement invisible : elle n'est pas rendue,
  // donc elle ne charge aucun dossier.
  expect(html).not.toContain('file-tree')
  localStorage.removeItem('desktop:files-tree')
})
