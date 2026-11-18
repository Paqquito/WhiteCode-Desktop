import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionMetaStore } from './sessionMeta.js'
import { compareSessions, displayTitle } from '../../shared/sessionMeta.js'

const magasin = () => new SessionMetaStore(mkdtempSync(join(tmpdir(), 'sample-meta-')))

test('rien n’est retenu tant que rien n’a été décidé', () => {
  expect(magasin().read('/p', 's')).toBeUndefined()
})

test('un changement partiel n’efface pas le reste', () => {
  const s = magasin()
  s.update('/p', 's', { title: 'Migration Git' })
  s.update('/p', 's', { pinned: true })
  // Épingler après avoir renommé doit conserver le nom : l'appelant n'a pas à
  // relire puis réécrire l'état complet, deux fenêtres le feraient à contretemps.
  expect(s.read('/p', 's')).toEqual({ title: 'Migration Git', pinned: true })
})

test('un titre vide rend le titre déduit, il n’en pose pas un vide', () => {
  const s = magasin()
  s.update('/p', 's', { title: 'Nom choisi' })
  s.update('/p', 's', { title: '   ' })
  // C'est la seule façon d'annuler un renommage.
  expect(s.read('/p', 's')).toBeUndefined()
})

test('le fichier disparaît quand il ne reste rien à retenir', () => {
  const racine = mkdtempSync(join(tmpdir(), 'sample-meta-'))
  const s = new SessionMetaStore(racine)
  s.update('/p', 's', { pinned: true })
  expect(readdirSync(racine).length).toBe(1)
  s.update('/p', 's', { pinned: false })
  // Sans cette suppression, hésiter laisserait un fichier vide par session.
  expect(readdirSync(racine)).toEqual([])
})

test('deux sessions du même dossier ne se mélangent pas, ni deux dossiers', () => {
  const s = magasin()
  s.update('/p', 'a', { title: 'A' })
  s.update('/p', 'b', { title: 'B' })
  s.update('/autre', 'a', { title: 'Ailleurs' })
  expect(s.read('/p', 'a')?.title).toBe('A')
  expect(s.read('/p', 'b')?.title).toBe('B')
  expect(s.read('/autre', 'a')?.title).toBe('Ailleurs')
})

test('un champ abîmé n’emporte pas les autres', () => {
  const racine = mkdtempSync(join(tmpdir(), 'sample-meta-'))
  const s = new SessionMetaStore(racine)
  s.update('/p', 's', { title: 'Bon titre', pinned: true })
  const [nom] = readdirSync(racine)
  writeFileSync(join(racine, nom!), '{"title":"Bon titre","pinned":"oui","archived":true}')
  // `pinned` n'est pas un booléen : il est ignoré, le titre et l'archive restent.
  expect(s.read('/p', 's')).toEqual({ title: 'Bon titre', archived: true })
})

test('un fichier illisible ne bloque pas la conversation', () => {
  const racine = mkdtempSync(join(tmpdir(), 'sample-meta-'))
  const s = new SessionMetaStore(racine)
  s.update('/p', 's', { title: 'X' })
  writeFileSync(join(racine, readdirSync(racine)[0]!), 'ceci n’est pas du JSON')
  expect(s.read('/p', 's')).toBeUndefined()
})

test('un titre démesuré est coupé, pas refusé', () => {
  const s = magasin()
  s.update('/p', 's', { title: 'x'.repeat(500) })
  // Un message collé par mégarde ne doit pas déformer la barre latérale.
  expect(s.read('/p', 's')?.title?.length).toBe(120)
})

test('le titre choisi l’emporte, sinon celui du transcript', () => {
  expect(displayTitle({ title: 'Choisi' }, 'Déduit')).toBe('Choisi')
  expect(displayTitle(undefined, 'Déduit')).toBe('Déduit')
  expect(displayTitle({ title: '  ' }, 'Déduit')).toBe('Déduit')
})

test('les épinglées passent devant, sans bousculer la chronologie entre elles', () => {
  const liste = [
    { id: 'vieille-epinglee', pinned: true, updatedAt: 10 },
    { id: 'recente', updatedAt: 30 },
    { id: 'neuve-epinglee', pinned: true, updatedAt: 20 },
    { id: 'ancienne', updatedAt: 5 },
  ]
  expect([...liste].sort(compareSessions).map(s => s.id)).toEqual([
    'neuve-epinglee', 'vieille-epinglee', 'recente', 'ancienne',
  ])
})
