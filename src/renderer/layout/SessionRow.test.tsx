/**
 * Ce que les deux listes doivent offrir sur une conversation — lot L02.
 *
 * Le rendu statique n'ouvre pas le menu : cela demanderait un clic. Ce qui est
 * éprouvé ici, c'est que chaque ligne porte bien son déclencheur nommé, que
 * l'état décidé se voit, et que l'ordre place les épinglées en tête. Le
 * contenu du menu est éprouvé sur le composant seul, en le forçant ouvert par
 * son état initial — voir `SessionRow` : le menu est local à la ligne.
 */

import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Project, SessionSummary } from '../../main/preload.js'
import { ProjectList } from './ProjectList.js'
import { SessionList } from './SessionList.js'

const actionsInertes = () => ({
  meta: () => {}, fork: () => {}, worktree: () => {}, reveal: () => {}, copy: () => {},
})
const projetInerte = () => ({
  meta: () => {}, newSession: () => {}, worktree: () => {}, reveal: () => {},
  archiveAll: () => {}, edit: () => {}, remove: () => {},
})

const session = (over: Partial<SessionSummary> & { id: string }): SessionSummary => ({
  title: over.title ?? 'Conversation', derivedTitle: over.derivedTitle ?? 'Conversation',
  updatedAt: 1, bytes: 10, ...over,
})

const projet = (sessions: SessionSummary[]): Project => ({
  name: 'Example', derivedName: 'Example', cwd: '/p', storageDir: '', updatedAt: 1, sessions,
})

const rendus = (p: Project) => [
  renderToStaticMarkup(<SessionList projects={[p]} activeSessionId={null} loading={false}
    onOpenSession={() => {}} actionsFor={actionsInertes} />),
  renderToStaticMarkup(<ProjectList projects={[p]} activeSessionId={null} activeCwd="/p" loading={false}
    onOpenSession={() => {}} actionsFor={actionsInertes} projectActions={projetInerte} />),
]

test('chaque conversation porte ses deux outils, nommés par elle', () => {
  for (const html of rendus(projet([session({ id: 'a', title: 'Migration Git' })]))) {
    // Nommés par la conversation : dans une liste, « Épingler » seul ne dirait
    // pas laquelle, et c'est tout ce qu'un lecteur d'écran entendrait.
    expect(html).toContain('aria-label="Épingler Migration Git"')
    expect(html).toContain('aria-label="Archiver Migration Git"')
  }
})

test('les outils disent l’état, pas seulement l’action', () => {
  const [epinglee] = rendus(projet([session({ id: 'a', title: 'T', pinned: true })]))
  expect(epinglee).toContain('aria-pressed="true"')
  expect(epinglee).toContain('aria-label="Détacher T"')
  const [archivee] = rendus(projet([session({ id: 'a', title: 'T', archived: true })]))
  // L'outil bascule : sur une archivée, il propose l'inverse.
  expect(archivee).toContain('aria-label="Sortir de l’archive T"')
})

test('la ligne ne montre plus depuis quand la conversation dort', () => {
  // L'horodatage changeait à chaque rendu sans jamais aider à choisir ; il est
  // passé dans la carte de survol, avec le dossier et la branche.
  const [plate, groupee] = rendus(projet([session({ id: 'a', title: 'T', updatedAt: 0 })]))
  for (const html of [plate!, groupee!]) {
    expect(html).not.toContain('il y a')
    expect(html).not.toContain('session-meta')
  }
})

test('une épinglée se voit, et passe devant', () => {
  const p = projet([
    session({ id: 'recente', title: 'Récente', updatedAt: 30 }),
    session({ id: 'epinglee', title: 'Épinglée', pinned: true, updatedAt: 10 }),
  ])
  for (const html of rendus(p)) {
    expect(html).toContain('session-pin')
    // L'ordre : l'épinglée apparaît avant la récente dans le balisage.
    expect(html.indexOf('Épinglée')).toBeLessThan(html.indexOf('Récente'))
  }
})

test('une archivée reste une ligne ordinaire, marquée', () => {
  // Le rendu ne la cache pas : c'est la barre latérale qui décide de la
  // montrer. Archiver ne doit pas devenir une suppression déguisée.
  for (const html of rendus(projet([session({ id: 'a', archived: true })]))) {
    expect(html).toMatch(/class="session[^"]*\barchived\b/)
  }
})

test('les deux modes restent distincts, sans dupliquer la ligne', () => {
  const [plate, groupee] = rendus(projet([session({ id: 'a', title: 'Titre' })]))
  // La liste plate mélange les projets, d'où la pastille de repérage ; la vue
  // groupée les sépare déjà par un en-tête.
  expect(plate).toContain('session flat')
  expect(plate).toContain('session-indicator')
  expect(groupee).toContain('session-indicator')
  expect(groupee).toContain('project-name')
  expect(groupee).not.toContain('session flat')
})

test('une conversation non lue se signale', () => {
  for (const html of rendus(projet([session({ id: 'a', unread: true })]))) {
    expect(html).toMatch(/class="session[^"]*\bunread\b/)
  }
})
