import * as React from 'react'
import type { GitSummary } from '../../main/preload.js'

/** A late response must never populate another project's panel. */
export function useGitStatus(cwd: string, active: boolean) {
  const [result, setResult] = React.useState<{ cwd: string; summary: GitSummary } | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [revision, setRevision] = React.useState(0)
  const owner = React.useRef(cwd); owner.current = cwd
  const request = React.useRef(0)
  const refresh = React.useCallback(async () => {
    const id = ++request.current
    setLoading(true)
    try {
      const summary = cwd ? await window.engine.gitSummary(cwd) : { available: false as const, reason: 'Aucun dossier de travail.' }
      if (owner.current === cwd && id === request.current) { setResult({ cwd, summary }); setRevision(n => n + 1) }
    } catch (error) {
      if (owner.current === cwd && id === request.current) setResult({ cwd, summary: { available: false, reason: String(error) } })
    } finally { if (owner.current === cwd && id === request.current) setLoading(false) }
  }, [cwd])
  React.useEffect(() => { if (active) void refresh(); return () => { request.current++ } }, [active, refresh])
  return { summary: result?.cwd === cwd ? result.summary : null, loading, revision, refresh }
}
