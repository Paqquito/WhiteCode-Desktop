import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectMetaStore } from './projectMeta.js'
import { compareProjects, projectName } from '../../shared/projectMeta.js'

const magasin = () => new ProjectMetaStore(mkdtempSync(join(tmpdir(), 'sample-proj-')))

test('un projet ne retient rien tant que rien n’a été décidé', () => {
  expect(magasin().read('/p')).toBeUndefined()
})

test('renommer n’efface pas les sources, et réciproquement', () => {
  const s = magasin()
  s.update('/p', { name: 'Copilote' })
  s.update('/p', { sources: ['/lib'] })
  expect(s.read('/p')).toEqual({ name: 'Copilote', sources: ['/lib'] })
})

test('un nom vide rend celui du dossier', () => {
  const s = magasin()
  s.update('/p', { name: 'Choisi' })
  s.update('/p', { name: '  ' })
  expect(s.read('/p')).toBeUndefined()
  expect(projectName(undefined, 'Example')).toBe('Example')
  expect(projectName({ name: 'Choisi' }, 'Example')).toBe('Choisi')
})

test('le même dossier deux fois n’est pas ouvert deux fois au moteur', () => {
  const s = magasin()
  s.update('/p', { sources: ['/lib', '/lib', ' /lib ', '/autre'] })
  expect(s.read('/p')?.sources).toEqual(['/lib', '/autre'])
})

test('une liste de sources vidée disparaît', () => {
  const s = magasin()
  s.update('/p', { sources: ['/lib'] })
  s.update('/p', { sources: [] })
  expect(s.read('/p')).toBeUndefined()
})

test('le fichier disparaît quand il ne reste rien', () => {
  const racine = mkdtempSync(join(tmpdir(), 'sample-proj-'))
  const s = new ProjectMetaStore(racine)
  s.update('/p', { pinned: true })
  expect(readdirSync(racine).length).toBe(1)
  s.update('/p', { pinned: false })
  expect(readdirSync(racine)).toEqual([])
})

test('deux projets ne se mélangent pas', () => {
  const s = magasin()
  s.update('/a', { name: 'A' })
  s.update('/b', { name: 'B' })
  expect(s.read('/a')?.name).toBe('A')
  expect(s.read('/b')?.name).toBe('B')
})

test('les épinglés passent devant, sans bousculer la chronologie entre eux', () => {
  const liste = [
    { id: 'vieux-epingle', pinned: true, updatedAt: 10 },
    { id: 'recent', updatedAt: 30 },
    { id: 'neuf-epingle', pinned: true, updatedAt: 20 },
  ]
  expect([...liste].sort(compareProjects).map(p => p.id)).toEqual([
    'neuf-epingle', 'vieux-epingle', 'recent',
  ])
})

test('« retiré » est une décision comme une autre, réversible', () => {
  // Elle n'efface rien : elle se pose et se retire, et le dossier réapparaît.
  const s = magasin()
  s.update('/p', { removed: true })
  expect(s.read('/p')?.removed).toBe(true)
  s.update('/p', { removed: false })
  expect(s.read('/p')).toBeUndefined()
})

test('les instructions seules persistent, restent propres au projet et peuvent être effacées', () => {
  const s = magasin()
  s.update('/a', { instructions: '  Français\nConserver les conventions.  ' })
  expect(s.read('/a')?.instructions).toBe('Français\nConserver les conventions.')
  expect(s.read('/b')).toBeUndefined()
  s.update('/a', { name: 'A' })
  expect(s.read('/a')?.instructions).toContain('conventions')
  s.update('/a', { instructions: '' })
  expect(s.read('/a')).toEqual({ name: 'A' })
})
