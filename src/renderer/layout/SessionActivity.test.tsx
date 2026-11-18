import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionActivity } from './SessionActivity.js'
import { INITIAL_ATTENTION, elapsedLabel } from '../../shared/sessionAttention.js'

test('completed attention shows its frozen duration, last activity and unread result', () => {
  const html = renderToStaticMarkup(<SessionActivity attention={{ ...INITIAL_ATTENTION, phase: 'failed',
    startedAt: 1000, endedAt: 62000, lastActivityAt: 62000, unread: true }} />)
  expect(html).toContain('En erreur')
  expect(html).toContain('Non consulté')
  expect(html).toContain('1 min 1 s')
  expect(html).toContain('1970-01-01T00:01:02.000Z')
  expect(elapsedLabel(-1)).toBe('0 s')
  expect(elapsedLabel(3660000)).toBe('1 h 1 min')
})
