import * as React from 'react'
import type { GitWorkflowState, WorkflowAction, WorkflowPR, WorkflowRequest } from '../../main/vcs/workflow.js'

/** Loaded on demand; opening the changes panel never contacts a remote. */
export function GitWorkflow({ cwd, disabled, revision, onChange, onPending }: {
  cwd: string; disabled: boolean; revision: number; onChange: () => Promise<void>; onPending: (pending: boolean) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [state, setState] = React.useState<GitWorkflowState | null>(null)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [loadedRevision, setLoadedRevision] = React.useState(-1)
  const [loading, setLoading] = React.useState(false)
  const [branch, setBranch] = React.useState('')
  const [newBranch, setNewBranch] = React.useState('')
  const [remoteName, setRemote] = React.useState('')
  const [base, setBase] = React.useState('')
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const [draft, setDraft] = React.useState(true)
  const [pr, setPr] = React.useState<WorkflowPR | null>(null)
  const [method, setMethod] = React.useState<'merge' | 'squash' | 'rebase'>('merge')
  const [confirmation, setConfirmation] = React.useState<{ request: WorkflowRequest; text: string } | null>(null)
  const confirmButton = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { if (confirmation) confirmButton.current?.focus() }, [confirmation])
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setConfirmation(null); setPr(null)
    void window.engine.gitWorkflow(cwd).then(next => {
      if (cancelled) return
      setState(next); setLoadedRevision(revision)
      setRemote(current => next.remotes.some(r => r.name === current) ? current : next.remotes[0]?.name ?? '')
      setBranch(current => next.branches.includes(current) ? current : next.branch)
    }).catch(e => { if (!cancelled) { setState(null); setError(String(e)) } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, cwd, revision])
  const remote = state?.remotes.find(r => r.name === remoteName)
  const locked = disabled || pending || loading || loadedRevision !== revision
  const ask = (action: WorkflowAction, text: string) => {
    if (!state || locked) return
    setError(''); setNotice('')
    setConfirmation({ request: { expectedBranch: state.branch, expectedHead: state.head, action }, text })
  }
  const execute = async () => {
    if (!confirmation || locked) return
    setPending(true); onPending(true); setError(''); setNotice('')
    const request = confirmation.request
    setConfirmation(null)
    try {
      setNotice(await window.engine.gitWorkflowAction(cwd, request))
      if (request.action.kind === 'create-pr') { setTitle(''); setBody('') }
    } catch (e) { setError(String(e)) }
    finally { await onChange(); setPending(false); onPending(false) }
  }
  const loadPr = async () => {
    if (locked || !remote) return
    setPending(true); onPending(true); setPr(null); setError('')
    try { setPr(await window.engine.workflowPR(cwd, remote.name)) }
    catch (e) { setError(String(e)) }
    finally { setPending(false); onPending(false) }
  }
  return <section className="git-workflow">
    <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>Branches et publication</button>
    {open && <div className="git-workflow-content">
      {loading && <p role="status">Lecture du dépôt…</p>}
      {error && <p role="alert" className="file-error">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {pending && <p role="status">Opération en cours…</p>}
      {state && <>
        <p><strong>{state.branch || 'HEAD détachée'}</strong> · {state.head ? state.head.slice(0, 8) : 'aucun commit'}</p>
        <p>{state.upstream ? `${state.upstream} · ${state.ahead} en avance, ${state.behind} en retard (dernier état local connu)` : 'Aucune branche de suivi configurée.'}</p>
        <fieldset disabled={locked || !!confirmation}>
          <legend>Branches locales</legend>
          {state.dirty && <p>Commitez les modifications avant de changer de branche.</p>}
          <label>Branche<select value={branch} onChange={e => setBranch(e.target.value)}><option value="">Choisir une branche</option>{state.branches.map(b => <option key={b}>{b}</option>)}</select></label>
          <button className="btn" disabled={!branch || branch === state.branch || state.dirty} onClick={() => ask({ kind: 'switch', branch }, `Passer de ${state.branch || 'HEAD détachée'} à ${branch} ? Les fichiers du projet seront remplacés par ceux de cette branche.`)}>Changer de branche</button>
          <label>Nouvelle branche<input value={newBranch} onChange={e => setNewBranch(e.target.value)} placeholder="fonctionnalite/exemple" /></label>
          <button className="btn" disabled={!newBranch.trim() || state.dirty || !state.head} onClick={() => ask({ kind: 'branch', branch: newBranch.trim() }, `Créer et ouvrir ${newBranch.trim()} depuis ${state.head.slice(0, 8)} ?`)}>Créer une branche</button>
        </fieldset>
        <fieldset disabled={locked || !!confirmation}>
          <legend>Publication</legend>
          <label>Dépôt distant<select value={remoteName} onChange={e => { setRemote(e.target.value); setPr(null) }}><option value="">Choisir un dépôt</option>{state.remotes.map(r => <option key={r.name}>{r.name}</option>)}</select></label>
          {remote ? <p>{remote.target}</p> : <p>Aucun dépôt distant sélectionné. Configurez-le avec Git.</p>}
          <button className="btn" disabled={!remote || !state.branch || !state.head} onClick={() => remote && ask({ kind: 'push', remote: remote.name, fingerprint: remote.fingerprint }, `Publier les commits de ${state.branch} jusqu’à ${state.head.slice(0, 8)} vers ${remote.name} (${remote.target}), branche ${state.branch} ? Les fichiers non commités ne sont pas envoyés.`)}>Publier la branche</button>
        </fieldset>
        <details className="git-pr-form">
          <summary>Pull requests · GitHub / Enterprise</summary>
          <fieldset disabled={locked || !!confirmation || !remote?.repository || !state.branch}>
            <legend>Créer une PR</legend>
            <label>Branche de destination<input value={base} onChange={e => setBase(e.target.value)} placeholder="main" /></label>
            <label>Titre de la PR<input value={title} maxLength={256} onChange={e => setTitle(e.target.value)} /></label>
            <label>Description<textarea value={body} maxLength={65000} rows={3} onChange={e => setBody(e.target.value)} /></label>
            <label className="git-checkbox"><input type="checkbox" checked={draft} onChange={e => setDraft(e.target.checked)} />Créer en brouillon</label>
            <button className="btn" disabled={!title.trim() || !base.trim() || base === state.branch} onClick={() => remote && ask({ kind: 'create-pr', remote: remote.name, fingerprint: remote.fingerprint, title, body, base: base.trim(), draft }, `Créer ${draft ? 'une PR en brouillon' : 'une PR'} sur ${remote.repository}, de ${state.branch} vers ${base.trim()} : « ${title} » ? Le titre et la description seront publiés. La branche doit déjà être publiée.`)}>Créer la PR</button>
          </fieldset>
          <button className="btn" disabled={locked || !!confirmation || !remote?.repository || !state.branch} onClick={() => void loadPr()}>Consulter la PR de cette branche</button>
          {!remote?.repository && <p>Sélectionnez un dépôt GitHub ou GitHub Enterprise en HTTPS ou SSH. GitHub CLI doit être installé et connecté.</p>}
          {pr && <div className="git-pr">
            <strong>#{pr.number} {pr.title}</strong><p>{pr.headRefName} → {pr.baseRefName} · {pr.state}{pr.isDraft ? ' · Brouillon' : ''}</p><p>{pr.url}</p>
            {pr.checks.length ? <ul>{pr.checks.map((c, i) => <li key={i}>{c.name} : {c.state}</li>)}</ul> : <p>Aucun contrôle CI renseigné.</p>}
            <label>Méthode de fusion<select disabled={locked || !!confirmation} value={method} onChange={e => setMethod(e.target.value as typeof method)}><option value="merge">Commit de fusion</option><option value="squash">Regrouper les commits (squash)</option><option value="rebase">Rebase</option></select></label>
            <button className="btn" disabled={locked || !!confirmation || pr.state !== 'OPEN' || pr.isDraft} onClick={() => remote && ask({ kind: 'merge-pr', remote: remote.name, fingerprint: remote.fingerprint, number: pr.number, head: pr.headRefOid, base: pr.baseRefName, method }, `Fusionner la PR #${pr.number} (${pr.title}) sur ${remote.repository}, ${pr.headRefName} → ${pr.baseRefName}, commit ${pr.headRefOid.slice(0, 8)}, méthode ${method} ? Les protections GitHub restent appliquées. Si une file de fusion est requise, la demande peut y être placée.`)}>Fusionner la PR</button>
          </div>}
        </details>
      </>}
      {confirmation && <div className="git-confirm" role="group" aria-label="Confirmation Git" onKeyDown={e => { if (e.key === 'Escape') setConfirmation(null) }}>
        <p>{confirmation.text}</p>
        <button ref={confirmButton} className="btn" disabled={locked} onClick={() => setConfirmation(null)}>Annuler</button>
        <button className="btn primary" disabled={locked} onClick={() => void execute()}>Confirmer</button>
      </div>}
    </div>}
  </section>
}
