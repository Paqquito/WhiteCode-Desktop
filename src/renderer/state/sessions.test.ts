import { expect, test } from 'bun:test'
import { mergeSessionProjects, newerSession } from './sessions.js'
import { initialThreadState, threadReducer } from '../../shared/thread.js'
import { DEFAULT_SESSION_SETTINGS } from '../../shared/protocol.js'
import { INITIAL_ATTENTION } from '../../shared/sessionAttention.js'
import { compareSessions } from '../../shared/sessionMeta.js'
import type { SessionSnapshot } from '../../main/preload.js'

test('a late IPC snapshot cannot overwrite background progress or another session', () => {
  const snapshot: SessionSnapshot = { id: 'a', cwd: '/a', revision: 5, updatedAt: 1,
    attention: INITIAL_ATTENTION, settings: DEFAULT_SESSION_SETTINGS, state: threadReducer(initialThreadState, { type: 'user-submit', text: 'alpha' }) }
  const current = { a: snapshot, b: { ...snapshot, id: 'b' } }
  expect(newerSession(current, { ...snapshot, revision: 3 })).toBe(current)
  expect(newerSession(current, { ...snapshot, revision: 6 }).b).toBe(current.b)
})

test('live sessions are navigable before initialization and replace only their own transcript row', () => {
  const a: SessionSnapshot = { id: 'runtime-a', cwd: '/a', revision: 1, updatedAt: 2,
    attention: INITIAL_ATTENTION, settings: DEFAULT_SESSION_SETTINGS, state: threadReducer(initialThreadState, { type: 'user-submit', text: 'alpha' }) }
  const b = { ...a, id: 'runtime-b', state: { ...a.state, status: { ...a.state.status, sessionId: 'saved-b' } } }
  const projects = [{ name: 'a', derivedName: 'a', cwd: '/a', storageDir: '/storage/a', updatedAt: 1,
    sessions: [{ id: 'saved-b', title: 'old', derivedTitle: 'old', updatedAt: 1, bytes: 123 }, { id: 'untouched', title: 'past', derivedTitle: 'past', updatedAt: 0, bytes: 10 }] }]
  const merged = mergeSessionProjects(projects, [a, b])
  expect(merged[0]!.sessions.map(s => s.id).sort()).toEqual(['runtime-a', 'runtime-b', 'untouched'])
  expect(merged[0]!.sessions[0]!.activity).toBe('running')
  expect(projects[0]!.sessions).toHaveLength(2)
})

test('ce que l’utilisateur a décidé survit à la reprise de la conversation', () => {
  // Une session reprise remplace sa ligne stockée par un instantané vivant.
  // Sans report explicite, renommer puis écrire rendrait son titre déduit sous
  // les yeux et la désépinglerait en silence.
  const vivante: SessionSnapshot = { id: 'runtime', cwd: '/a', revision: 1, updatedAt: 9,
    attention: INITIAL_ATTENTION, settings: DEFAULT_SESSION_SETTINGS,
    state: { ...threadReducer(initialThreadState, { type: 'user-submit', text: 'premier message' }),
      status: { ...initialThreadState.status, sessionId: 'stockee' } } }
  const projects = [{ name: 'a', derivedName: 'a', cwd: '/a', storageDir: '/s', updatedAt: 1, sessions: [
    { id: 'stockee', title: 'Nom choisi', derivedTitle: 'premier message', pinned: true, updatedAt: 1, bytes: 1 },
  ] }]
  const [reprise] = mergeSessionProjects(projects, [vivante])[0]!.sessions
  expect(reprise!.title).toBe('Nom choisi')
  expect(reprise!.pinned).toBe(true)
  // Le titre déduit, lui, suit la conversation vivante.
  expect(reprise!.derivedTitle).toBe('premier message')
})

test('une conversation jamais renommée suit son premier message', () => {
  const vivante: SessionSnapshot = { id: 'runtime', cwd: '/a', revision: 1, updatedAt: 9,
    attention: INITIAL_ATTENTION, settings: DEFAULT_SESSION_SETTINGS,
    state: { ...threadReducer(initialThreadState, { type: 'user-submit', text: 'nouveau sujet' }),
      status: { ...initialThreadState.status, sessionId: 'stockee' } } }
  const projects = [{ name: 'a', derivedName: 'a', cwd: '/a', storageDir: '/s', updatedAt: 1, sessions: [
    { id: 'stockee', title: 'ancien titre', derivedTitle: 'ancien titre', updatedAt: 1, bytes: 1 },
  ] }]
  // `title === derivedTitle` : rien n'a été choisi, donc rien à préserver.
  expect(mergeSessionProjects(projects, [vivante])[0]!.sessions[0]!.title).toBe('nouveau sujet')
})

test('opening saved history does not reorder either list; a new prompt does', () => {
  const projects = [{ name: 'project', derivedName: 'project', cwd: '/p', storageDir: '/s', updatedAt: 200,
    sessions: [
      { id: 'recent', title: 'Recent', derivedTitle: 'Recent', updatedAt: 200, bytes: 100 },
      { id: 'old', title: 'Old', derivedTitle: 'Old', updatedAt: 100, bytes: 100 },
    ] }]
  const resumed: SessionSnapshot = { id: 'runtime-old', cwd: '/p', updatedAt: 100, revision: 0,
    settings: DEFAULT_SESSION_SETTINGS, attention: INITIAL_ATTENTION,
    state: threadReducer(initialThreadState, { type: 'load-transcript', sessionId: 'old', entries: [{ kind: 'user', text: 'Old' }] }) }
  const order = (session: SessionSnapshot) => mergeSessionProjects(projects, [session])[0]!.sessions.sort(compareSessions).map(s => s.title)
  expect(order(resumed)).toEqual(['Recent', 'Old'])
  expect(order({ ...resumed, revision: 1 })).toEqual(['Recent', 'Old'])
  expect(order({ ...resumed, updatedAt: 300, state: threadReducer(resumed.state, { type: 'user-submit', text: 'New prompt' }) })).toEqual(['Old', 'Recent'])
})
