import * as React from 'react'
import type { Turn } from '#desktop/tool-activity'
import { toolLabel, toolState } from '#desktop/tool-activity'
import { sessionFiles } from '#desktop/conversation-files'
import { Icon } from '../ui/Icon.js'
import { FileLinkContext } from './fileLink.js'

/**
 * Pied d'une réponse : où elle en est, ce qui a échoué, ce qu'elle a produit.
 *
 * L'arrêt n'est plus proposé ici : le composeur porte le seul bouton Arrêter.
 * Deux contrôles pour la même action laissaient croire qu'ils n'arrêtaient pas
 * la même chose. Le fil dit plutôt ce qui se passe (« Commande en cours… »).
 */
export function TurnSummary({ turn, busy, cancelling, waiting, waitingLabel, onPermission, onEdit, onReview }: {
  turn: Turn; busy: boolean; cancelling: boolean; waiting: boolean; waitingLabel?: string;
  onPermission?: () => void; onEdit?: (text: string) => void; onReview?: () => void;
}) {
  const openFile = React.useContext(FileLinkContext)
  const files = sessionFiles(turn.entries).written
  const failed = turn.entries.filter(e => e.kind === 'tool' && toolState(e) === 'failed').length
  const outcome = turn.user?.outcome
  const active = turn.entries.findLast(e => e.kind === 'tool' && toolState(e) === 'working')
  const label = busy ? cancelling ? 'Arrêt en cours…' : waiting ? waitingLabel ?? 'Votre autorisation est requise' : active?.kind === 'tool' ? `${toolLabel(active.name)} en cours…` : 'Réponse en cours…'
    : outcome === 'done' ? 'Demande terminée' : outcome === 'failed' ? 'La demande a échoué' : outcome === 'interrupted' ? 'Demande interrompue' : null
  if (!busy && !outcome && files.length === 0 && failed === 0) return null
  return <footer className={`turn-summary ${busy ? 'working' : outcome ?? 'unknown'}`}>
    {label && <div className="turn-state"><span role={busy ? 'status' : undefined}>{label}</span>
      {busy && waiting && onPermission && <button type="button" onClick={onPermission}>Examiner l’autorisation</button>}
      {!busy && (outcome === 'failed' || outcome === 'interrupted') && turn.user && onEdit && <button type="button" onClick={() => onEdit(turn.user!.text)} title="Remettre la demande dans le composeur sans l’envoyer">Reprendre la demande</button>}
    </div>}
    {failed > 0 && <p className="turn-tool-warning">{failed} outil{failed > 1 ? 's ont échoué' : ' a échoué'}.{outcome === 'done' ? ' La demande a néanmoins abouti.' : busy ? ' Le travail continue.' : ''}</p>}
    {/* Une rangée de pastilles, l'action de revue en bout de rangée : les
        sorties se lisent d'un regard au lieu de s'empiler en boutons. */}
    {files.length > 0 && <div className="turn-deliverables" role="group" aria-label="Fichiers modifiés ou transmis">
      {files.map(path => <button type="button" className="file-chip" key={path} disabled={!openFile} title={path} onClick={() => openFile?.(path)}><Icon name="file" size={13} /><span>{path.split(/[\\/]/).pop()}</span></button>)}
      {onReview && <button type="button" className="turn-review" onClick={onReview}>Voir les modifications Git</button>}
    </div>}
  </footer>
}
