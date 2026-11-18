import { expect, test } from 'bun:test'
import { placeCard } from './SessionHoverCard.js'

/**
 * La carte est ancrée sur la **barre latérale**, pas sur la ligne survolée.
 * Ancrée sur la ligne, elle partait avec elle dès qu'un titre débordait, et se
 * retrouvait au milieu de l'écran, détachée de ce qu'elle décrivait.
 */

test('la carte se colle au bord de la barre, quelle que soit la ligne', () => {
  const haute = placeCard({ sidebarRight: 276, rowTop: 100 }, 120, 900)
  const basse = placeCard({ sidebarRight: 276, rowTop: 400 }, 120, 900)
  expect(haute.left).toBe(basse.left)
  expect(haute.left).toBe(284)
})

test('elle suit la poignée quand la barre est élargie', () => {
  expect(placeCard({ sidebarRight: 460, rowTop: 10 }, 120, 900).left).toBe(468)
})

test('elle s’aligne sur sa ligne tant qu’elle tient', () => {
  expect(placeCard({ sidebarRight: 276, rowTop: 400 }, 120, 900).top).toBe(400)
})

test('elle remonte plutôt que de sortir par le bas', () => {
  // Une ligne en bas de barre : la carte dépasserait de 120 px.
  const { top } = placeCard({ sidebarRight: 276, rowTop: 850 }, 120, 900)
  expect(top).toBe(900 - 120 - 10)
})

test('une carte plus haute que la fenêtre reste lisible par le haut', () => {
  // Le calcul remonterait sous zéro ; la marge du haut l'emporte.
  expect(placeCard({ sidebarRight: 276, rowTop: 400 }, 2000, 900).top).toBe(10)
})
