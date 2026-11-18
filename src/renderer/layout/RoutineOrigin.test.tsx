import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RoutineOrigin } from './RoutineOrigin.js'
import { SessionList } from './SessionList.js'
import { ProjectList } from './ProjectList.js'
import { TopBar } from './TopBar.js'
import type { Project } from '../../main/workspace/projects.js'

const actionsInertes = () => ({
  meta: () => {}, fork: () => {}, worktree: () => {}, reveal: () => {}, copy: () => {},
})
const projetInerte = () => ({
  meta: () => {}, newSession: () => {}, worktree: () => {}, reveal: () => {},
  archiveAll: () => {}, edit: () => {}, remove: () => {},
})

const origin = { kind: 'routine' as const, routineId: 'daily-report', cron: '0 9 * * *', firedAt: 1789372800000 }
const project: Project = { name: 'project', derivedName: 'project', cwd: '/project', storageDir: '', updatedAt: 1,
  sessions: [{ id: 'routine-session', title: 'Rapport', derivedTitle: 'Rapport', updatedAt: 1, bytes: 1, origin }] }

test('routine marker appears in both navigation modes and the header, with accessible provenance', () => {
  const outputs = [
    renderToStaticMarkup(<SessionList projects={[project]} activeSessionId={null} loading={false} onOpenSession={() => {}} actionsFor={actionsInertes} />),
    renderToStaticMarkup(<ProjectList projects={[project]} activeSessionId={null} activeCwd="/project" loading={false} onOpenSession={() => {}} actionsFor={actionsInertes} projectActions={projetInerte} />),
    renderToStaticMarkup(<TopBar title="Rapport" project="project" origin={origin} sidebarHidden={false}
      onShowSidebar={() => {}} isPanelOpen={() => false} onTogglePanel={() => {}} onOpenRestore={() => {}} onOpenConnections={() => {}} />),
  ]
  for (const html of outputs) {
    expect(html).toContain('routine-origin')
    expect(html).toContain('Lancée par la routine daily-report')
    expect(html).toContain('0 9 * * *')
  }
  expect(outputs[2]).toContain('<time dateTime=')
  expect(renderToStaticMarkup(<RoutineOrigin />)).toBe('')
})
