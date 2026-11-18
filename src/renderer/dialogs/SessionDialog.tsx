import * as React from 'react'
import { Dialog } from '../ui/Dialog.js'
import type { ManagedWorktree, RepositoryInfo, SessionSnapshot, WorktreeRequest } from '../../main/preload.js'

export function SessionDialog({ cwd: initial, isolatedInitially = false, onCreate, onClose }: {
  cwd: string
  isolatedInitially?: boolean
  onCreate: (cwd: string, request?: WorktreeRequest) => Promise<SessionSnapshot | undefined>
  onClose: () => void
}): React.ReactNode {
  const [cwd, setCwd] = React.useState(initial)
  const [isolated, setIsolated] = React.useState(isolatedInitially)
  const [repo, setRepo] = React.useState<RepositoryInfo | null>(null)
  const [gitError, setGitError] = React.useState('')
  const [branch, setBranch] = React.useState(`session/${crypto.randomUUID().slice(0, 8)}`)
  const [base, setBase] = React.useState('HEAD')
  const [existingBranch, setExistingBranch] = React.useState(false)
  const [path, setPath] = React.useState('')
  const [trees, setTrees] = React.useState<ManagedWorktree[]>([])
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const errorId = React.useId()
  React.useEffect(() => {
    let cancelled = false
    setRepo(null); setGitError('Lecture du dépôt…')
    const timer = setTimeout(() => {
      void window.engine.repository(cwd).then(info => {
        if (cancelled) return
        setRepo(info); setGitError('')
        setPath(`${info.root}-session-${crypto.randomUUID().slice(0, 8)}`)
      }).catch(reason => { if (!cancelled) setGitError(`Worktree indisponible pour ce dossier : ${String(reason)}`) })
    }, 200)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [cwd])
  React.useEffect(() => { void window.engine.listWorktrees().then(setTrees).catch(reason => setError(String(reason))) }, [])

  async function create(folder: string, request?: WorktreeRequest) {
    setBusy(true); setError('')
    try {
      const snapshot = await onCreate(folder, request)
      if (snapshot) onClose()
      else setError('La conversation n’a pas pu être ouverte. Le détail de l’erreur s’affiche dans le fil.')
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  async function remove(id: string) {
    setBusy(true); setError('')
    try {
      await window.engine.removeWorktree(id)
      setTrees(await window.engine.listWorktrees()); setConfirmRemove(null)
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <Dialog title={isolatedInitially ? 'Une copie Git pour cette tâche' : 'Où voulez-vous travailler ?'} className="session-dialog" onClose={onClose} dismissible={!busy}>
    <form onSubmit={event => { event.preventDefault(); void create(cwd, isolated ? { path, branch, base, existingBranch } : undefined) }}>
      <p className="session-intro">{isolatedInitially
        ? 'Essayez des changements dans un dossier séparé. Les fichiers de votre dossier actuel restent intacts.'
        : 'Choisissez les fichiers auxquels la nouvelle conversation aura accès. La conversation actuelle reste disponible.'}</p>
      <fieldset disabled={busy}>
        <label>Dossier du projet<input value={cwd} onChange={event => setCwd(event.target.value)} required /></label>
        <button type="button" onClick={() => { void window.engine.chooseWorkspace().then(folder => { if (folder) setCwd(folder) }).catch(reason => setError(String(reason))) }}>Choisir le dossier…</button>
        <details className="session-advanced" open={isolatedInitially || undefined}>
          <summary>Options Git avancées</summary>
          <label className="session-choice"><input type="checkbox" checked={isolated} disabled={!repo && !isolated}
            onChange={event => setIsolated(event.target.checked)} />Travailler dans une copie séparée (worktree)</label>
          {!repo && <p className="hint" role="status">{gitError}</p>}
        {isolated && <div className="worktree-options">
          <p className="hint">Seuls les fichiers commités seront présents. Les modifications locales du projet restent dans leur dossier.</p>
          <label>Dossier du nouveau worktree<input value={path} onChange={event => setPath(event.target.value)} required /></label>
          <label className="session-choice"><input type="checkbox" checked={existingBranch} disabled={!repo?.branches.length} onChange={event => { setExistingBranch(event.target.checked); setBranch(event.target.checked ? repo?.branches[0] ?? '' : `session/${crypto.randomUUID().slice(0, 8)}`) }} />Utiliser une branche existante{repo && !repo.branches.length ? ' (aucune branche libre)' : ''}</label>
          <label>{existingBranch ? 'Branche existante (libre)' : 'Nouvelle branche'}
            {existingBranch ? <select value={branch} onChange={event => setBranch(event.target.value)}>{repo?.branches.map(name => <option key={name}>{name}</option>)}</select>
              : <input value={branch} onChange={event => setBranch(event.target.value)} required />}
          </label>
          {!existingBranch && <label>Référence de départ<input value={base} onChange={event => setBase(event.target.value)} placeholder="HEAD, branche ou commit" required /></label>}
          <p className="hint">Le moteur, les fichiers, le terminal local et la revue utiliseront ce nouveau dossier. Les dépendances du projet peuvent nécessiter une installation.</p>
        </div>}
        </details>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>Annuler</button>
          <button type="submit" className="primary" disabled={!cwd.trim() || (isolated && !repo)}>{busy ? 'Opération en cours…' : isolated ? 'Créer la copie et commencer' : 'Commencer dans ce dossier'}</button>
        </div>
        {trees.length > 0 && <details className="saved-worktrees"><summary>Worktrees conservés ({trees.length})</summary>
          <p className="hint">Ouvrir démarre une nouvelle conversation dans le même worktree. Pour reprendre un historique, utiliser la barre latérale. Le nettoyage conserve la branche et refuse les fichiers modifiés, non suivis ou ignorés. Une session ouverte, même masquée, protège son dossier jusqu’au redémarrage de l’application ; enregistrer les éditions avant de quitter.</p>
          {trees.map(tree => <div className="saved-worktree" key={tree.id}>
            <strong>{tree.branch}</strong><code>{tree.path}</code>
            <div className="dialog-actions">
              <button type="button" onClick={() => void create(tree.path)}>Ouvrir</button>
              {confirmRemove === tree.id ? <>
                <span>Retirer ce dossier ? La branche sera conservée.</span>
                <button type="button" onClick={() => void remove(tree.id)}>Confirmer le nettoyage</button>
                <button type="button" onClick={() => setConfirmRemove(null)}>Conserver</button>
              </> : <button type="button" onClick={() => setConfirmRemove(tree.id)}>Nettoyer…</button>}
            </div>
          </div>)}
        </details>}
      </fieldset>
      {error && <p id={errorId} role="alert" className="session-error">{error}</p>}
    </form>
  </Dialog>
}
