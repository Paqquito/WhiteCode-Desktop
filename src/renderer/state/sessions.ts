import type { Project, SessionSnapshot } from '../../main/preload.js'

/** Ignore an old IPC reply arriving after a newer streaming snapshot. */
export function newerSession(current: Record<string, SessionSnapshot>, next: SessionSnapshot): Record<string, SessionSnapshot> {
  if ((current[next.id]?.revision ?? -1) > next.revision) return current
  return { ...current, [next.id]: next }
}

/** Show live sessions before a transcript exists, without duplicating their disk entry. */
export function mergeSessionProjects(projects: Project[], sessions: SessionSnapshot[]): Project[] {
  const result = projects.map(project => ({ ...project, sessions: [...project.sessions] }))
  const norm = (cwd: string) => navigator.platform.startsWith('Win')
    ? cwd.replace(/\\/g, '/').toLowerCase() : cwd
  for (const session of sessions) {
    if (!session.state.entries.length) continue
    let project = result.find(p => norm(p.cwd) === norm(session.cwd))
    if (!project) {
      const nom = session.chat ? 'Chat' : session.cwd.split(/[\\/]/).pop() ?? session.cwd
      project = { cwd: session.cwd, name: nom, derivedName: nom,
        ...(session.chat ? { chat: true } : {}), storageDir: '', sessions: [], updatedAt: session.updatedAt }
      result.push(project)
    }
    // Ce que l'utilisateur a décidé de cette conversation survit à sa reprise.
    // Sans ce report, renommer une session puis y écrire lui rendrait son titre
    // déduit sous les yeux, et la désépinglerait en silence.
    const decided = project.sessions.find(
      s => s.id === session.id || s.id === session.state.status.sessionId,
    )
    project.sessions = project.sessions.filter(s => s.id !== session.id && s.id !== session.state.status.sessionId)
    const first = session.state.entries.find(e => e.kind === 'user')
    const derived = first?.kind === 'user' ? first.text.slice(0, 160) : 'Conversation'
    project.sessions.unshift({ id: session.id,
      title: decided?.title && decided.title !== decided.derivedTitle ? decided.title : derived,
      derivedTitle: derived,
      pinned: decided?.pinned, archived: decided?.archived, unread: decided?.unread,
      updatedAt: Math.max(session.updatedAt, decided?.updatedAt ?? 0), bytes: decided?.bytes ?? 0,
      attention: session.attention, origin: session.origin,
      activity: session.state.pending ? 'permission' : session.state.status.busy ? 'running' : undefined })
    project.updatedAt = Math.max(project.updatedAt, session.updatedAt)
  }
  return result.sort((a, b) => b.updatedAt - a.updatedAt)
}
