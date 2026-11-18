import { expect, test } from 'bun:test'
import { placeMenu } from './Menu.js'

/** Le composeur, en pied d'une fenêtre de 1000 px. */
const composer = { anchorTop: 920, anchorBottom: 944, viewportHeight: 1000 }

test('une liste qui tient dans la place libre n’est pas plafonnée en deçà', () => {
  // D04 : le menu des permissions se coupait en pleine description avec 880 px
  // de libre au-dessus de lui. Cinq entrées à description font ~350 px.
  const { direction, maxHeight } = placeMenu({ ...composer, optionCount: 5 })
  expect(direction).toBe('up')
  expect(maxHeight).toBeGreaterThanOrEqual(350)
})

test('le sens suit la place, et la hauteur suit le sens', () => {
  // Ancré en haut de fenêtre : rien au-dessus, tout en dessous.
  const haut = placeMenu({
    anchorTop: 40,
    anchorBottom: 64,
    viewportHeight: 1000,
    optionCount: 5,
  })
  expect(haut.direction).toBe('down')
  expect(haut.maxHeight).toBeLessThanOrEqual(1000 - 64)
})

test('fenêtre écrasée : la liste défile plutôt que de déborder', () => {
  const { direction, maxHeight } = placeMenu({
    anchorTop: 300,
    anchorBottom: 324,
    viewportHeight: 340,
    optionCount: 5,
  })
  expect(direction).toBe('up')
  // Elle ne dépasse pas le haut de la fenêtre…
  expect(maxHeight).toBeLessThanOrEqual(300)
  // …et garde de quoi s'y repérer.
  expect(maxHeight).toBeGreaterThanOrEqual(140)
})

test('une liste très longue ne couvre pas la fenêtre entière', () => {
  const { maxHeight } = placeMenu({
    anchorTop: 1400,
    anchorBottom: 1424,
    viewportHeight: 1500,
    optionCount: 40,
  })
  expect(maxHeight).toBeLessThanOrEqual(560)
})
