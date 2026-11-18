/**
 * Retour des fichiers à un tour précédent.
 *
 * Deux temps, jamais un seul : on montre ce qui changerait, puis on demande
 * confirmation. Une restauration réécrit de vrais fichiers, et la liste des
 * tours ne dit pas à elle seule ce qu'ils contenaient — seul l'aperçu le sait.
 *
 * Les tours sont présentés du plus récent au plus ancien : on revient presque
 * toujours sur ce qu'on vient de faire.
 */

import * as React from 'react'
import type { RestorePoint, RewindResult } from '../../main/preload.js'
import { Icon } from '../ui/Icon.js'
import { Dialog } from '../ui/Dialog.js'

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

export function RestoreDialog({ sessionId, busy, onClose }: {
  sessionId: string
  /** Un tour en cours dans le dossier : l'écriture sera refusée. */
  busy: boolean
  onClose: () => void
}): React.ReactNode {
  const [points, setPoints] = React.useState<RestorePoint[] | null>(null)
  const [selected, setSelected] = React.useState<RestorePoint | null>(null)
  const [preview, setPreview] = React.useState<RewindResult | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [applying, setApplying] = React.useState(false)
  const [restored, setRestored] = React.useState(false)
  const [error, setError] = React.useState('')


  React.useEffect(() => {
    let cancelled = false
    window.engine.listRestorePoints(sessionId)
      .then(list => { if (!cancelled) setPoints(list) })
      .catch(reason => { if (!cancelled) { setPoints([]); setError(String(reason)) } })
    return () => { cancelled = true }
  }, [sessionId])

  async function choose(point: RestorePoint) {
    setSelected(point); setPreview(null); setRestored(false); setError(''); setPreviewing(true)
    try {
      setPreview(await window.engine.rewindFiles(sessionId, point.messageId, true))
    } catch (reason) { setError(String(reason)) }
    finally { setPreviewing(false) }
  }

  async function apply(point: RestorePoint) {
    setApplying(true); setError('')
    try {
      const result = await window.engine.rewindFiles(sessionId, point.messageId, false, preview?.fingerprint)
      if (result.canRewind) {
        setRestored(true); setSelected(null); setPreview(null)
      } else {
        setError(result.error || 'La restauration a échoué.')
      }
    } catch (reason) { setError(String(reason)) }
    finally { setApplying(false) }
  }

  const changed = preview?.filesChanged ?? []
  const ordered = points ? [...points].reverse() : []

  return <Dialog title="Points de restauration" className="session-dialog restore-dialog" onClose={onClose} dismissible={!applying}
    footer={<button type="button" onClick={onClose} disabled={applying}>Fermer</button>}>

    {points === null && <p className="hint" role="status">Lecture de l’historique…</p>}

    {points !== null && ordered.length === 0 && !error && (
      <p className="hint">
        Aucun message de cette conversation ne peut être restauré. Les points de restauration
        apparaissent après une réponse ayant modifié des fichiers.
      </p>
    )}

    {restored && <p className="restore-done" role="status">
      <Icon name="check" size={13} /> Fichiers restaurés. La conversation, elle, n’a pas changé :
      le modèle garde en mémoire les modifications qu’il a faites.
    </p>}

    {ordered.length > 0 && <ul className="restore-points">
      {ordered.map(point => {
        const active = selected?.messageId === point.messageId
        return <li key={point.messageId} className={active ? 'restore-point active' : 'restore-point'}>
          <button type="button" className="restore-choose" onClick={() => void choose(point)}
            disabled={previewing || applying} aria-expanded={active}>
            <span className="restore-text">{point.text}</span>
            <span className="restore-date">{formatDate(point.at)}</span>
          </button>

          {active && <div className="restore-preview">
            {previewing && <p className="hint" role="status">Calcul de l’aperçu…</p>}

            {!previewing && preview && !preview.canRewind && (
              <p className="hint">{preview.error || 'Ce message ne peut pas être restauré.'}</p>
            )}

            {!previewing && preview?.canRewind && <>
              {changed.length === 0
                ? <p className="hint">Aucun fichier n’a changé depuis ce message : la restauration ne ferait rien.</p>
                : <>
                  <p className="hint">
                    Revenir ici modifierait {changed.length === 1 ? '1 fichier' : `${changed.length} fichiers`}
                    {typeof preview.insertions === 'number' && typeof preview.deletions === 'number'
                      ? ` (+${preview.insertions} / −${preview.deletions} lignes)` : ''}.
                  </p>
                  <ul className="restore-files">
                    {changed.map((file: string) => <li key={file}><code>{file}</code></li>)}
                  </ul>
                  <p className="restore-warning">
                    {preview.conflicts?.length ? 'Des modifications faites hors de l’agent ont été détectées. Confirmer signifie qu’elles seront écrasées.' : 'Ces fichiers reviendront à leur état au point sélectionné. Les modifications manuelles détectées nécessitent votre accord.'} Si les fichiers changent après cet aperçu, WhiteCode demandera un nouvel accord.
                  </p>
                </>}

              {busy && <p className="restore-warning">
                Une réponse est en cours dans ce dossier. Attendez sa fin ou interrompez-le
                avant de restaurer.
              </p>}

              <div className="dialog-actions">
                <button type="button" onClick={() => { setSelected(null); setPreview(null) }} disabled={applying}>
                  Ne pas restaurer
                </button>
                <button type="button" className="primary" disabled={busy || applying || changed.length === 0}
                  onClick={() => void apply(point)}>
                  {applying ? 'Restauration en cours…' : 'Restaurer ces fichiers'}
                </button>
              </div>
            </>}
          </div>}
        </li>
      })}
    </ul>}

    {error && <p role="alert" className="session-error">{error}</p>}

  </Dialog>
}
