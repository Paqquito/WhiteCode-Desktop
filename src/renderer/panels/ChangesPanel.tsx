/**
 * Panneau des modifications.
 *
 * Deux sources, deux questions différentes, d'où deux onglets :
 *
 *  - **Git** répond à « qu'est-ce qui n'est pas encore commité ? ». Il couvre
 *    tout le dossier, y compris ce qui a été fait à la main ou par un autre
 *    outil, et survit au redémarrage de l'application.
 *  - **Session** répond à « qu'a fait le modèle depuis que je lui parle ? ».
 *    Il ignore le reste et disparaît avec la session.
 *
 * Les fusionner donnerait une liste qui ne répond bien à aucune des deux.
 */

import * as React from 'react'
import type { GitFile } from '../../main/preload.js'
import type { ThreadEntry } from '#desktop/session-protocol'
import { DiffBody, DiffStat } from '../diff/DiffView.js'
import { countChanges, parseUnifiedDiff, type DiffRow } from '../diff/model.js'
import { collectSessionChanges, type SessionFile } from '../diff/session.js'
import { languageOf } from '../code/Highlight.js'
import type { ReviewComment } from '../state/useReview.js'
import { useGitStatus } from '../state/useGitStatus.js'
import { changeRows } from '../thread/Diff.js'
import { GitWorkflow } from '#desktop/repository-actions'
import { Icon } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'
import { Panel, PanelEmpty } from '../ui/Panel.js'

type Source = 'git' | 'session'
const githubState = (value: string) => ({ OPEN: 'Ouverte', CLOSED: 'Fermée', MERGED: 'Fusionnée', SUCCESS: 'Réussi', FAILURE: 'Échec', ERROR: 'Erreur', IN_PROGRESS: 'En cours', PENDING: 'En attente', QUEUED: 'En attente', CANCELLED: 'Annulé', SKIPPED: 'Ignoré', NEUTRAL: 'Neutre', TIMED_OUT: 'Délai dépassé', COMPLETED: 'Terminé' }[value] ?? value)

export function ChangesPanel({
  cwd,
  entries,
  busy,
  review,
  onClose,
}: {
  cwd: string
  entries: ThreadEntry[]
  /** Un tour en cours : le disque va encore bouger, on relit à la fin. */
  busy: boolean
  /** Revue en cours : les diffs Git deviennent annotables. */
  review: {
    forFile: (file: string) => ReviewComment[]
    add: (draft: Omit<ReviewComment, 'id'>) => void
    remove: (id: string) => void
  }
  onClose: () => void
}): React.ReactNode {
  const [source, setSource] = React.useState<Source>('git')
  const git = useGitStatus(cwd, source === 'git')

  // Relecture à la fin du tour : c'est là que le disque vient de changer.
  const wasBusy = React.useRef(busy)
  const refresh = git.refresh
  React.useEffect(() => {
    if (wasBusy.current && !busy && source === 'git') void refresh()
    wasBusy.current = busy
  }, [busy, source, refresh])

  const sessionFiles = React.useMemo(
    () => collectSessionChanges(entries),
    [entries],
  )

  return (
    <Panel
      title="Modifications"
      icon="diff"
      onClose={onClose}
      padded={false}
      actions={
        source === 'git' ? (
          <IconButton icon="refresh" size={14} onClick={() => void refresh()} title="Relire l’état Git" />
        ) : null
      }
    >
      <div className="tabs" role="tablist" aria-label="Source des modifications">
        <TabButton
          icon="branch"
          label="Git"
          active={source === 'git'}
          count={git.summary?.available ? git.summary.files.length : undefined}
          onClick={() => setSource('git')}
        />
        <TabButton
          icon="sparkle"
          label="Conversation"
          active={source === 'session'}
          count={sessionFiles.length}
          onClick={() => setSource('session')}
        />
      </div>

      {source === 'git' ? (
        <GitChanges key={cwd} cwd={cwd} state={git} review={review} busy={busy} />
      ) : (
        <SessionChanges files={sessionFiles} review={review} />
      )}
    </Panel>
  )
}

function TabButton({
  icon,
  label,
  active,
  count,
  onClick,
}: {
  icon: 'branch' | 'sparkle'
  label: string
  active: boolean
  count?: number
  onClick: () => void
}): React.ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? 'tab active' : 'tab'}
      onClick={onClick}
    >
      <Icon name={icon} size={13} />
      <span>{label}</span>
      {count !== undefined && count > 0 && (
        <span className="tab-count">{count}</span>
      )}
    </button>
  )
}

// --- Git --------------------------------------------------------------------

/** Libellé des lettres de `git status`, qui n'évoquent rien hors contexte. */
const STATUS_LABEL: Record<string, string> = {
  M: 'modifié',
  A: 'ajouté',
  D: 'supprimé',
  R: 'renommé',
  C: 'copié',
  U: 'en conflit',
  '?': 'non suivi',
}

function GitChanges({
  cwd,
  state,
  review,
  busy,
}: {
  cwd: string
  busy: boolean
  state: ReturnType<typeof useGitStatus>
  review: {
    forFile: (file: string) => ReviewComment[]
    add: (draft: Omit<ReviewComment, 'id'>) => void
    remove: (id: string) => void
  }
}): React.ReactNode {
  const { summary, loading } = state
  const [pending, setPending] = React.useState(false)
  const [workflowPending, setWorkflowPending] = React.useState(false)
  const [message, setMessage] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [pr, setPr] = React.useState<Awaited<ReturnType<typeof window.engine.pullRequest>> | null>(null)
  const [prLoading, setPrLoading] = React.useState(false)
  const act = async (action: Parameters<typeof window.engine.gitAction>[1]) => {
    if (pending || workflowPending || busy) return
    setPending(true); setError(null); setNotice(null)
    try {
      await window.engine.gitAction(cwd, action)
      if (action.kind === 'commit') { setMessage(''); setNotice('Commit créé localement.') }
      await state.refresh()
    } catch (error) { setError(String(error)); await state.refresh() }
    finally { setPending(false) }
  }
  const loadPr = async () => {
    setPrLoading(true)
    try { setPr(await window.engine.pullRequest(cwd)) }
    catch (error) { setPr({ available: false, reason: String(error) }) }
    finally { setPrLoading(false) }
  }

  if (!summary) {
    return (
      <div className="panel-pad">
        <PanelEmpty>Lecture de l’état Git…</PanelEmpty>
      </div>
    )
  }
  if (!summary.available) {
    return (
      <div className="panel-pad">
        <PanelEmpty>{summary.reason}</PanelEmpty>
      </div>
    )
  }

  return (
    <>
      <div className="changes-head">
        <Icon name="branch" size={13} />
        <span className="changes-branch" title="Branche courante">
          {summary.branch}
        </span>
        <span className="changes-count">
          {summary.files.length === 0
            ? 'arbre propre'
            : `${new Set(summary.files.map(file => file.path)).size} fichier${new Set(summary.files.map(file => file.path)).size > 1 ? 's' : ''}`}
        </span>
        {loading && <span className="changes-loading">…</span>}
      </div>

      <div className="git-actions">
        {summary.files.some(file => file.status === 'U') && <p className="file-error" role="alert">Conflits à résoudre dans les fichiers, puis à indexer. Le commit reste bloqué.</p>}
        {error && <p className="file-error" role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <p>{summary.files.filter(file => file.staged).length} changement{summary.files.filter(file => file.staged).length > 1 ? 's indexés' : ' indexé'} pour le commit.</p>
        <label>Message du commit<input aria-label="Message du commit" value={message} onChange={event => setMessage(event.target.value)} disabled={pending || workflowPending} placeholder="Décrire les changements indexés…" /></label>
        <button type="button" className="btn" disabled={busy || pending || workflowPending || !message.trim() || !summary.files.some(file => file.staged) || summary.files.some(file => file.status === 'U')} onClick={() => void act({ kind: 'commit', message })}>{pending ? 'Opération en cours…' : 'Créer le commit local'}</button>
        <button type="button" className="btn" disabled={prLoading} onClick={() => void loadPr()}>{prLoading ? 'Lecture GitHub…' : 'Consulter PR / CI'}</button>
        {pr && (pr.available ? <div className="git-pr"><strong>{pr.title}</strong><p>{githubState(pr.state)}</p><p className="git-pr-url">{pr.url}</p>{pr.checks.length ? <ul>{pr.checks.map((check, index) => <li key={index}>{check.name} : {githubState(check.state)}</li>)}</ul> : <p>Aucun contrôle CI renseigné.</p>}</div> : <p role="status">{pr.reason}</p>)}
      </div>
      <GitWorkflow cwd={cwd} disabled={busy || pending} revision={state.revision} onChange={state.refresh} onPending={setWorkflowPending} />
      {summary.files.length === 0 ? (
        <div className="panel-pad">
          <PanelEmpty>
            Rien à valider : le dossier est identique au dernier commit.
          </PanelEmpty>
        </div>
      ) : (
        <div className="changes-list">
          {summary.files.map(file => (
            <GitFileRow
              key={`${file.path}:${file.staged}`}
              cwd={summary.root ?? cwd}
              revision={state.revision}
              disabled={pending || workflowPending || busy}
              onAction={() => void act({ kind: file.staged ? "unstage" : "stage", path: file.path })}
              file={file}
              review={review}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Une ligne de fichier, dépliable.
 *
 * Le diff n'est demandé qu'à l'ouverture : sur un dépôt en cours de refonte,
 * charger d'emblée les diffs de deux cents fichiers coûterait plusieurs
 * secondes pour n'en lire qu'un.
 */
function GitFileRow({
  cwd,
  file,
  review,
  revision,
  disabled,
  onAction,
}: {
  revision: number
  disabled: boolean
  onAction: () => void
  cwd: string
  file: GitFile
  review: {
    forFile: (file: string) => ReviewComment[]
    add: (draft: Omit<ReviewComment, 'id'>) => void
    remove: (id: string) => void
  }
}): React.ReactNode {
  const [open, setOpen] = React.useState(false)
  const [rows, setRows] = React.useState<DiffRow[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setRows(null)
    setError(null)
    let cancelled = false
    void window.engine
      .gitDiff(cwd, file.path, file.staged, file.status === '?')
      .then(text => {
        if (!cancelled) {
          if (/^(Binary files|GIT binary patch)/m.test(text)) setError('Fichier binaire : aperçu textuel indisponible.')
          else setRows(parseUnifiedDiff(text))
        }
      })
      .catch(e => {
        if (!cancelled) setError(String(e))
      })
    return () => {
      cancelled = true
    }
  }, [open, cwd, file.path, file.staged, file.status, revision])

  const name = file.path.split('/').pop() ?? file.path
  const dir = file.path.slice(0, file.path.length - name.length).replace(/\/$/, '')
  const reviewPath = `${cwd.replace(/[\\/]$/, "")}/${file.path}`
  const noted = review.forFile(reviewPath).filter(comment => comment.scope === (file.staged ? "git:index" : "git:worktree")).length

  return (
    <section className={open ? 'change open' : 'change'}>
      <button
        type="button"
        className="change-head"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title={file.path}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span
          className={`change-status s-${file.status === '?' ? 'untracked' : file.status.toLowerCase()}`}
          title={STATUS_LABEL[file.status] ?? file.status}
        >
          {file.status}
        </span>
        <span className="change-name">{name}</span>
        {dir && <span className="change-dir">{dir}</span>}
        {file.staged && <span className="change-staged">indexé</span>}
        {noted > 0 && (
          <span className="change-noted" title={`${noted} commentaire(s)`}>
            <Icon name="comment" size={11} />
            {noted}
          </span>
        )}
        <DiffStat added={file.added} removed={file.removed} />
      </button>

      <div className="change-actions"><button type="button" className="btn" disabled={disabled} onClick={onAction}>{file.staged ? 'Désindexer' : file.status === 'U' ? 'Indexer la résolution' : 'Indexer'}</button></div>
      {open && (
        <div className="change-body">
          {error ? (
            <div className="diff-body empty">{error}</div>
          ) : rows ? (
            <DiffBody
              rows={rows}
              language={languageOf(file.path)}
              file={reviewPath}
              scope={file.staged ? "git:index" : "git:worktree"}
              comments={review.forFile(reviewPath)}
              onAddComment={review.add}
              onRemoveComment={review.remove}
            />
          ) : (
            <div className="diff-body empty">Lecture du diff…</div>
          )}
        </div>
      )}
    </section>
  )
}

// --- Session ----------------------------------------------------------------

function SessionChanges({ files, review }: { files: SessionFile[]; review: Parameters<typeof ChangesPanel>[0]['review'] }): React.ReactNode {
  if (files.length === 0) {
    return (
      <div className="panel-pad">
        <PanelEmpty>
          Aucun fichier modifié dans cette session. Les éditions refusées ou en
          échec ne comptent pas : elles n’ont rien changé sur le disque.
        </PanelEmpty>
      </div>
    )
  }
  return (
    <div className="changes-list">
      <p className="session-diff-note">Historique des éditions appliquées. Les numéros de ligne se rapportent aux extraits de chaque édition.</p>
      {files.map(file => (
        <SessionFileRow key={file.path} file={file} review={review} />
      ))}
    </div>
  )
}

function SessionFileRow({ file, review }: { file: SessionFile; review: Parameters<typeof ChangesPanel>[0]['review'] }): React.ReactNode {
  const [open, setOpen] = React.useState(false)

  // Chaque édition garde son propre diff : les fusionner donnerait un résultat
  // faux, la seconde s'appliquant à un texte que la première a déjà transformé.
  const perEdit = React.useMemo(
    () => file.edits.map(edit => changeRows(edit)),
    [file],
  )
  const total = perEdit.reduce(
    (acc, rows) => {
      const { added, removed } = countChanges(rows)
      return { added: acc.added + added, removed: acc.removed + removed }
    },
    { added: 0, removed: 0 },
  )

  return (
    <section className={open ? 'change open' : 'change'}>
      <button
        type="button"
        className="change-head"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title={file.path}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        <span className="change-name">{file.name}</span>
        {file.edits.length > 1 && (
          <span className="change-edits">{file.edits.length} éditions</span>
        )}
        <DiffStat added={total.added} removed={total.removed} />
      </button>

      {open && (
        <div className="change-body">
          {perEdit.map((rows, index) => (
            <DiffBody key={index} rows={rows} language={languageOf(file.path)} file={file.path} scope={`session:${index}`} comments={review.forFile(file.path)} onAddComment={review.add} onRemoveComment={review.remove} />
          ))}
        </div>
      )}
    </section>
  )
}
