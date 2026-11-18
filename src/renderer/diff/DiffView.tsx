/**
 * Affichage d'un diff.
 *
 * Un seul composant pour les deux sources — modifications du modèle et état
 * Git — parce qu'un diff doit se lire pareil d'un panneau à l'autre. Un rouge
 * qui change de nuance selon l'endroit force à réapprendre la couleur à chaque
 * fois.
 *
 * Quand `file` est fourni, chaque ligne devient annotable : une bulle apparaît
 * dans la gouttière au survol, et le commentaire s'affiche sous la ligne. Sans
 * `file`, le diff reste en lecture seule — un diff du fil, déjà passé, n'a pas
 * de raison d'être commenté.
 */

import * as React from 'react'
import { Highlight } from '../code/Highlight.js'
import type { ReviewComment } from '../state/useReview.js'
import { Icon } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'
import type { DiffRow } from './model.js'

export function DiffBody({
  rows,
  scope,
  language,
  file,
  comments,
  onAddComment,
  onRemoveComment,
}: {
  rows: DiffRow[]
  scope?: string
  language?: string | null
  /** Active l'annotation ; c'est aussi la clé sous laquelle elle est classée. */
  file?: string
  comments?: ReviewComment[]
  onAddComment?: (draft: Omit<ReviewComment, 'id'>) => void
  onRemoveComment?: (id: string) => void
}): React.ReactNode {
  const [editing, setEditing] = React.useState<number | null>(null)

  if (rows.length === 0) {
    return <div className="diff-body empty">Aucune différence.</div>
  }

  const annotatable = Boolean(file && onAddComment)

  return (
    <div className={annotatable ? 'diff-body annotatable' : 'diff-body'}>
      {rows.map((row, index) => {
        if (row === 'gap') {
          return (
            <div key={index} className="diff-gap">
              ⋯
            </div>
          )
        }

        const attached = comments?.filter(
          c => c.scope === scope && c.excerpt === row.text && (row.newNo !== undefined ? c.line === row.newNo : c.line === null && c.oldLine === row.oldNo),
        )

        return (
          <React.Fragment key={index}>
            <div className={`diff-line ${row.kind}`}>
              {annotatable && (
                <button
                  type="button"
                  className="diff-annotate"
                  onClick={() => setEditing(editing === index ? null : index)}
                  title="Commenter cette ligne"
                  aria-label={`Commenter la ligne ${row.newNo ?? row.oldNo ?? ''}`}
                >
                  <Icon name="comment" size={11} />
                </button>
              )}
              <span className="diff-no">{row.oldNo ?? ''}</span>
              <span className="diff-no">{row.newNo ?? ''}</span>
              <span className="diff-sign">
                {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}
              </span>
              <span className="diff-text">
                {row.text ? (
                  <Highlight code={row.text} language={language} />
                ) : (
                  ' '
                )}
              </span>
            </div>

            {attached?.map(comment => (
              <div key={comment.id} className="diff-comment">
                <Icon name="comment" size={12} />
                <span className="diff-comment-text">{comment.text}</span>
                {onRemoveComment && (
                  <IconButton icon="close" size={11} onClick={() => onRemoveComment(comment.id)} title="Supprimer le commentaire" />
                )}
              </div>
            ))}

            {editing === index && file && onAddComment && (
              <CommentDraft
                onCancel={() => setEditing(null)}
                onSubmit={text => {
                  onAddComment({
                    file,
                    scope,
                    oldLine: row.oldNo,
                    line: row.newNo ?? null,
                    excerpt: row.text,
                    text,
                  })
                  setEditing(null)
                }}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

/**
 * Saisie d'un commentaire.
 *
 * Le focus est pris à l'ouverture : la bulle est cliquée puis on écrit, sans
 * second clic. Échap referme, Ctrl+Entrée valide — Entrée seule insère un
 * saut de ligne, une remarque de revue tenant rarement sur une phrase.
 */
function CommentDraft({
  onSubmit,
  onCancel,
}: {
  onSubmit: (text: string) => void
  onCancel: () => void
}): React.ReactNode {
  const [text, setText] = React.useState('')
  const ref = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    <div className="diff-draft">
      <textarea
        ref={ref}
        value={text}
        rows={2}
        placeholder="Remarque sur cette ligne…"
        onChange={event => setText(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Escape') onCancel()
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            if (text.trim()) onSubmit(text.trim())
          }
        }}
      />
      <div className="diff-draft-actions">
        <button type="button" className="ghost" onClick={onCancel}>
          Annuler
        </button>
        <button
          type="button"
          className="primary"
          disabled={!text.trim()}
          onClick={() => onSubmit(text.trim())}
        >
          Ajouter
        </button>
      </div>
    </div>
  )
}

/** Compteur d'ajouts et de retraits, tel qu'il apparaît dans les en-têtes. */
export function DiffStat({
  added,
  removed,
}: {
  added: number
  removed: number
}): React.ReactNode {
  return (
    <>
      {added > 0 && <span className="diff-add">+{added}</span>}
      {removed > 0 && <span className="diff-remove">−{removed}</span>}
    </>
  )
}
