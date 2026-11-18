/**
 * Rattachement d'un terminal laissé en vie.
 *
 * Depuis le constat D07, fermer le panneau détache au lieu de tuer : le shell
 * survit avec ce qui y tourne, et la réouverture doit le retrouver. `find`
 * est ce qui rend la reprise possible, et deux erreurs y sont coûteuses —
 * ne rien retrouver, ce qui laisse un processus orphelin invisible, ou
 * retrouver le mauvais, ce qui livre un shell distant à qui demandait le
 * local.
 */

import { afterEach, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'

import { Terminals, defaultShell } from './terminal.js'

// These tests cover attachment bookkeeping. Real PTY IO is covered by
// TerminalPanel.electron.test.ts and worktrees.electron.test.ts, in Electron.
// Spawning/killing immediately here races ConPTY startup and even starts SSH.
const terminals = new Terminals(() => null, () => ({
  write() {},
  resize() {},
  kill() {},
  onData: () => ({ dispose() {} }),
  onExit: () => ({ dispose() {} }),
}))
const ouverts: string[] = []

function ouvrir(cwd: string, remote?: Parameters<Terminals['create']>[3]): string {
  const id = terminals.create(cwd, 80, 24, remote)
  ouverts.push(id)
  return id
}

afterEach(() => {
  while (ouverts.length) terminals.kill(ouverts.pop()!)
})

const DISTANT = { key: '["serveur.test",22,"moi"]', file: 'ssh', args: ['moi@serveur.test'] }

test('deux ports du même serveur ne rattachent pas le même terminal', () => {
  const first = ouvrir(tmpdir(), DISTANT)
  const other = { ...DISTANT, key: '["serveur.test",2222,"moi"]' }
  expect(terminals.find(tmpdir(), other)).toBeNull()
  const second = ouvrir(tmpdir(), other)
  expect(terminals.find(tmpdir(), DISTANT)?.id).toBe(first)
  expect(terminals.find(tmpdir(), other)?.id).toBe(second)
})

test('un autre projet ne récupère pas une session distante laissée ouverte', () => {
  ouvrir(tmpdir(), DISTANT)
  expect(terminals.find('/un/autre/projet', DISTANT)).toBeNull()
})

test('sans terminal ouvert, il n’y a rien à rattacher', () => {
  expect(terminals.find(tmpdir())).toBeNull()
})

test('un terminal local est retrouvé par son dossier', () => {
  const id = ouvrir(tmpdir())
  expect(terminals.find(tmpdir())?.id).toBe(id)
})

test('un autre dossier ne rattache pas le terminal du voisin', () => {
  // Sans cette distinction, ouvrir le terminal d'un projet donnerait le shell
  // d'un autre, avec son historique et son répertoire courant.
  ouvrir(tmpdir())
  expect(terminals.find('/un/autre/dossier')).toBeNull()
})

test('le local et le distant ne se confondent pas', () => {
  // Les deux partagent leur `cwd` : c'est la cible qui les sépare.
  const local = ouvrir(tmpdir())
  const distant = ouvrir(tmpdir(), DISTANT)

  expect(terminals.find(tmpdir())?.id).toBe(local)
  expect(terminals.find(tmpdir(), DISTANT)?.id).toBe(distant)
})

test('un terminal arrêté n’est plus rattachable', () => {
  // C'est ce qui distingue « détaché » de « mort » : après un arrêt explicite,
  // la réouverture doit ouvrir un shell neuf, pas chercher un fantôme.
  const id = ouvrir(tmpdir())
  terminals.kill(id)
  ouverts.pop()

  expect(terminals.find(tmpdir())).toBeNull()
})

test('le shell choisi est respecté, et un shell absent retombe sur celui du système', () => {
  const system = defaultShell('system')
  if (process.platform === 'win32') {
    expect(defaultShell('cmd').file).toBe('cmd.exe')
    expect(defaultShell('powershell').file).toBe('powershell.exe')
  }
  const path = process.env.PATH
  process.env.PATH = ''
  try { expect(defaultShell('pwsh')).toEqual(system) } finally { process.env.PATH = path }
})
