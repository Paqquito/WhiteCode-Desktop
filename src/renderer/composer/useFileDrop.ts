/**
 * Dépôt de fichiers sur le composeur.
 *
 * Extrait parce que son seul point délicat se lisait mal au milieu de
 * trois cents autres lignes : l'état de survol est tenu par un **compteur**,
 * pas par un booléen. Survoler un enfant émet `dragleave` sur le parent, et un
 * simple drapeau ferait clignoter la surbrillance à chaque passage d'un
 * élément à l'autre.
 *
 * Les gestionnaires sont rendus prêts à poser sur l'élément : la règle
 * « annuler `dragover`, sans quoi le navigateur ouvre le fichier à la place »
 * n'a pas à être réapprise par le prochain appelant.
 */

import * as React from 'react'

export function useFileDrop(onFiles: (files: FileList) => void): {
  /** Vrai pendant qu'un fichier survole la zone. */
  over: boolean
  /** À étaler sur l'élément qui reçoit le dépôt. */
  handlers: {
    onDragEnter: (event: React.DragEvent) => void
    onDragOver: (event: React.DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: React.DragEvent) => void
  }
  /** Remet l'état à plat — au changement de session, par exemple. */
  reset: () => void
} {
  const [over, setOver] = React.useState(false)
  const depth = React.useRef(0)

  const reset = React.useCallback(() => {
    setOver(false)
    depth.current = 0
  }, [])

  return {
    over,
    reset,
    handlers: {
      onDragEnter: event => {
        if (!event.dataTransfer.types.includes('Files')) return
        depth.current++
        setOver(true)
      },
      onDragOver: event => {
        if (event.dataTransfer.types.includes('Files')) {
          // Sans cette annulation, le navigateur ouvre le fichier à la place.
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDrop: event => {
        event.preventDefault()
        depth.current = 0
        setOver(false)
        if (event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files)
      },
    },
  }
}
