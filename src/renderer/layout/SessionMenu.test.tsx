/**
 * Le menu contextuel d'une conversation.
 *
 * Éprouvé sur `SessionMenu` seul : dans `SessionRow`, il n'apparaît qu'après
 * un clic droit, que le rendu statique ne produit pas. Ce qui compte ici est
 * la **composition** du menu — ses groupes, et le sort réservé à une entrée
 * sans socle.
 */

import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionMenu, type MenuEntry } from './SessionMenu.js'

const rendre = (groups: MenuEntry[][]) =>
  renderToStaticMarkup(<SessionMenu groups={groups} at={{ x: 10, y: 10 }} onClose={() => {}} />)

test('les groupes sont séparés par un filet, un de moins que de groupes', () => {
  const html = rendre([[{ label: 'A' }], [{ label: 'B' }], [{ label: 'C' }]])
  expect((html.match(/role="separator"/g) ?? []).length).toBe(2)
})

test('un groupe vide ne laisse pas de filet orphelin', () => {
  // Les groupes sont construits par condition ; l'un d'eux peut se vider.
  const html = rendre([[{ label: 'A' }], [], [{ label: 'B' }]])
  expect((html.match(/role="separator"/g) ?? []).length).toBe(1)
})

test('une entrée sans socle est grisée avec sa raison, jamais masquée', () => {
  // La masquer laisserait croire qu'elle n'a pas été pensée. « Ouvrir dans une
  // nouvelle fenêtre » est le cas réel : le processus principal n'en tient
  // qu'une.
  const html = rendre([[{ label: 'Ouvrir ailleurs', disabled: 'Une seule fenêtre' }]])
  expect(html).toContain('Ouvrir ailleurs')
  expect(html).toContain('disabled')
  expect(html).toContain('Une seule fenêtre')
})

test('chaque entrée est un élément de menu pour un lecteur d’écran', () => {
  const html = rendre([[{ label: 'A' }, { label: 'B' }]])
  expect((html.match(/role="menuitem"/g) ?? []).length).toBe(2)
  expect(html).toContain('role="menu"')
})
