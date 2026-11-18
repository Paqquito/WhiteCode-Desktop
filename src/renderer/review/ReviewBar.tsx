/**
 * Revue en attente d'envoi.
 *
 * Apparaît au-dessus du composeur dès qu'une ligne est annotée, et disparaît
 * quand la revue part. Sa place est là et pas dans le panneau des
 * modifications : les commentaires peuvent porter sur plusieurs fichiers, et
 * l'endroit où l'on décide d'envoyer est celui d'où l'on parle au modèle.
 *
 * Repliée par défaut, dépliable : trois remarques tiennent sur une ligne, mais
 * une revue de vingt notes remplirait l'écran au moment précis où l'on veut
 * encore voir la conversation.
 */

import * as React from 'react'
import type { ReviewComment } from '../state/useReview.js'
import { Icon } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'

export function ReviewBar({
  comments,
  disabled,
  onSend,
  onClear,
  onRemove,
}: {
  comments: ReviewComment[]
  disabled: boolean
  onSend: () => void
  onClear: () => void
  onRemove: (id: string) => void
}): React.ReactNode {
  const [open, setOpen] = React.useState(false)
  const files = new Set(comments.map(c => c.file)).size

  return (
    <div className="review-bar">
      <div className="review-head">
        <button
          type="button"
          className="review-toggle"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          <Icon name="comment" size={13} />
          <span>
            {comments.length} remarque{comments.length > 1 ? 's' : ''} sur{' '}
            {files} fichier{files > 1 ? 's' : ''}
          </span>
        </button>

        <button type="button" className="ghost" onClick={onClear}>
          Tout effacer
        </button>
        <button
          type="button"
          className="primary"
          onClick={onSend}
          disabled={disabled}
          title={
            disabled
              ? 'Une réponse est en cours : attendez la fin pour envoyer la revue'
              : 'Envoyer la revue au modèle'
          }
        >
          Envoyer la revue
        </button>
      </div>

      {open && (
        <ul className="review-list">
          {comments.map(comment => (
            <li key={comment.id}>
              <span className="review-where">
                {comment.file.split('/').pop()}
                {comment.line !== null && `:${comment.line}`}
              </span>
              <span className="review-text">{comment.text}</span>
              <IconButton icon="close" size={11} onClick={() => onRemove(comment.id)} title="Retirer" label="Retirer la remarque" />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
