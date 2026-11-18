import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionIndicator } from './SessionIndicator.js'

test('running uses an orbit, unread completion a notification, idle a hollow dot', () => {
  const running = renderToStaticMarkup(<SessionIndicator phase="working" />)
  expect(running).toContain('session-orbit')
  expect(running).toContain('aria-label="En cours"')
  const completed = renderToStaticMarkup(<SessionIndicator phase="done" unread />)
  expect(completed).toContain('indicator-unread')
  expect(completed).toContain('aria-label="Nouvelle réponse"')
  expect(completed).not.toContain('session-orbit')
  const read = renderToStaticMarkup(<SessionIndicator phase="done" />)
  expect(read).toContain('indicator-idle')
  expect(read).toContain('aria-label="Inactif"')
  expect(renderToStaticMarkup(<SessionIndicator />)).toContain('aria-label="Inactif"')
})

test('errors and permissions stay marked even when read, each with its own shape', () => {
  // Lot E (UX-15) : un triangle pour l'erreur, une pastille pleine pour une
  // réponse attendue — la même icône pour les deux ne disait pas laquelle.
  const failed = renderToStaticMarkup(<SessionIndicator phase="failed" />)
  expect(failed).toContain('indicator-failed')
  expect(failed).toContain('aria-label="Une erreur est survenue"')
  expect(failed).toContain('<path')
  const waiting = renderToStaticMarkup(<SessionIndicator phase="waiting" />)
  expect(waiting).toContain('indicator-waiting')
  expect(waiting).toContain('aria-label="Réponse requise"')
  expect(waiting).toContain('session-indicator-dot')
  expect(waiting).not.toContain('<path')
})
