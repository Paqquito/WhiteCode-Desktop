/**
 * L'en-tête d'un projet — ce qu'il offre et ce qu'il refuse.
 *
 * Le menu et la carte demandent un clic ou un survol, que le rendu statique ne
 * produit pas ; ils sont éprouvés ailleurs (`SessionMenu.test.tsx`,
 * `SessionHoverCard.test.ts`). Ici on vérifie que la ligne porte bien ses deux
 * commandes, nommées par le projet.
 */

import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Project } from '../../main/preload.js'
import { ProjectRow } from './ProjectRow.js'

const actions = {
  meta: () => {}, newSession: () => {}, worktree: () => {}, reveal: () => {},
  archiveAll: () => {}, edit: () => {}, remove: () => {},
}

const projet = (over: Partial<Project> = {}): Project => ({
  name: 'Trading-copilot', derivedName: 'Trading-copilot', cwd: '/home/f/Trading-copilot',
  storageDir: '', updatedAt: 1, sessions: [], ...over,
})

const rendre = (p: Project, open = true) =>
  renderToStaticMarkup(<ProjectRow project={p} open={open} onToggle={() => {}} actions={actions} />)

test('la ligne porte ses deux commandes, nommées par le projet', () => {
  const html = rendre(projet())
  // Nommées : dans une liste de projets, « Actions » seul ne dirait pas
  // lequel, et c'est tout ce qu'un lecteur d'écran entendrait.
  expect(html).toContain('aria-label="Actions sur Trading-copilot"')
  expect(html).toContain('aria-label="Nouvelle conversation dans Trading-copilot"')
})

test('le nom choisi remplace celui du dossier', () => {
  const html = rendre(projet({ name: 'Copilote de marché' }))
  expect(html).toContain('Copilote de marché')
  expect(html).not.toContain('>Trading-copilot<')
})

test('un projet épinglé le montre sur sa ligne', () => {
  expect(rendre(projet({ pinned: true }))).toContain('session-pin')
  expect(rendre(projet())).not.toContain('session-pin')
})

test('le repli est annoncé, pas seulement dessiné', () => {
  // Le chevron ne dit rien à un lecteur d'écran.
  expect(rendre(projet(), true)).toContain('aria-expanded="true"')
  expect(rendre(projet(), false)).toContain('aria-expanded="false"')
})

test('le chemin complet n’est pas dans la ligne', () => {
  // Il est dans la carte de survol : un chemin absolu ne tient pas dans une
  // barre latérale, et le tronquer cache justement ce qui distingue deux
  // projets homonymes.
  expect(rendre(projet())).not.toContain('/home/f/Trading-copilot')
})
