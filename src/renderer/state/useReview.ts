/**
 * Commentaires de revue.
 *
 * Annoter une ligne précise plutôt que décrire la ligne dans le fil : « la
 * garde manque ici » vaut mieux que « dans predict_races.py, vers la ligne
 * 210, dans la fonction de pénalité… ». Le contexte est déjà à l'écran, le
 * commentaire s'y accroche.
 *
 * Les commentaires s'accumulent puis partent **ensemble**, en un seul message.
 * Un envoi par commentaire déclencherait un tour à chaque note et empêcherait
 * de relire l'ensemble avant de le soumettre — or une revue se juge entière.
 */

import * as React from 'react'
import { useSessionState } from './useSessionState.js'

export type ReviewComment = {
  id: string
  /** Diff source and edit identity; annotations do not leak between versions. */
  scope?: string
  oldLine?: number
  /** Chemin du fichier, tel qu'affiché dans le panneau. */
  file: string
  /** Numéro dans le fichier modifié, ou `null` pour une ligne supprimée. */
  line: number | null
  /** La ligne commentée, citée pour que le modèle situe sans ambiguïté. */
  excerpt: string
  text: string
}

let counter = 0

const EMPTY_COMMENTS: ReviewComment[] = []

export function useReview(sessionId: string | null) {
  const [comments, setComments] = useSessionState(sessionId, EMPTY_COMMENTS, 'review')

  const add = React.useCallback(
    (draft: Omit<ReviewComment, 'id'>) => {
      setComments(current => [...current, { ...draft, file: draft.file.replace(/\\/g, "/"), id: `c${++counter}` }])
    },
    [setComments],
  )

  const remove = React.useCallback((id: string) => {
    setComments(current => current.filter(c => c.id !== id))
  }, [setComments])

  const clear = React.useCallback(() => setComments([]), [setComments])

  /** Commentaires d'un fichier, pour les afficher sous leurs lignes. */
  const forFile = React.useCallback(
    (file: string) => comments.filter(c => c.file === file.replace(/\\/g, "/")),
    [comments],
  )

  /**
   * Met la revue en forme pour le modèle.
   *
   * Groupée par fichier et citant la ligne : c'est ce qui permet au modèle de
   * retrouver l'endroit sans relire tout le diff, et de traiter les remarques
   * dans l'ordre du fichier plutôt que dans celui où on les a écrites.
   */
  const toPrompt = React.useCallback((): string => {
    const byFile = new Map<string, ReviewComment[]>()
    for (const comment of comments) {
      const list = byFile.get(comment.file)
      if (list) list.push(comment)
      else byFile.set(comment.file, [comment])
    }

    const parts: string[] = [
      'Revue de code. Remarques par fichier et par ligne :',
      '',
    ]
    for (const [file, list] of byFile) {
      parts.push(`## ${file}`)
      for (const comment of [...list].sort(byLine)) {
        const where = comment.line === null ? `ligne supprimée ${comment.oldLine ?? ''}` : `ligne ${comment.line}`
        const source = comment.scope?.startsWith("session:") ? "extrait de session" : comment.scope === "git:index" ? "index Git" : "arbre de travail"
        parts.push(`- **${where} (${source})** — \`${comment.excerpt.trim()}\``)
        parts.push(`  ${comment.text}`)
      }
      parts.push('')
    }
    return parts.join('\n').trimEnd()
  }, [comments])

  return { comments, add, remove, clear, forFile, toPrompt }
}

function byLine(a: ReviewComment, b: ReviewComment): number {
  return (a.line ?? 0) - (b.line ?? 0)
}
