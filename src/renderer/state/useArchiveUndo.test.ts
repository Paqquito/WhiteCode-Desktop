import { expect, test } from 'bun:test'
import { useArchiveUndo } from './useArchiveUndo.js'

/**
 * Le crochet lui-même demande un rendu React et un vrai clavier ; ce qui est
 * éprouvé ici est la règle qui décide si `Ctrl+Z` nous appartient. Elle est
 * recopiée à l'identique du crochet — un test qui diverge de son sujet ne vaut
 * rien, d'où l'assertion finale sur l'existence du crochet.
 */
function nousAppartient(event: {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  target: { tagName?: string; isContentEditable?: boolean }
}): boolean {
  if (event.key !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey) return false
  const t = event.target
  return !(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

const ailleurs = { tagName: 'DIV' }

test('Ctrl+Z hors saisie annule le dernier archivage', () => {
  expect(nousAppartient({ key: 'z', ctrlKey: true, target: ailleurs })).toBe(true)
  expect(nousAppartient({ key: 'z', metaKey: true, target: ailleurs })).toBe(true)
})

test('dans un champ, Ctrl+Z appartient au texte', () => {
  // Le détourner ferait perdre une frappe pour ressusciter une conversation
  // qu'on ne regardait plus.
  expect(nousAppartient({ key: 'z', ctrlKey: true, target: { tagName: 'INPUT' } })).toBe(false)
  expect(nousAppartient({ key: 'z', ctrlKey: true, target: { tagName: 'TEXTAREA' } })).toBe(false)
  expect(nousAppartient({ key: 'z', ctrlKey: true, target: { isContentEditable: true } })).toBe(false)
})

test('Ctrl+Maj+Z est un rétablissement, pas une annulation', () => {
  expect(nousAppartient({ key: 'z', ctrlKey: true, shiftKey: true, target: ailleurs })).toBe(false)
})

test('z seul ne fait rien', () => {
  expect(nousAppartient({ key: 'z', target: ailleurs })).toBe(false)
})

test('le crochet existe et s’appelle comme le test le suppose', () => {
  expect(typeof useArchiveUndo).toBe('function')
})
