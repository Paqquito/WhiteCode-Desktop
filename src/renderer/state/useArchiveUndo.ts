/**
 * Annuler le dernier archivage par `Ctrl+Z`.
 *
 * Archiver est le seul geste de la liste qui fasse **disparaître** une ligne.
 * C'est aussi celui qu'on déclenche par erreur, l'icône étant à deux pixels de
 * l'épingle. Sans retour en arrière immédiat, il faut comprendre où la
 * conversation est partie avant de pouvoir la récupérer — ce qui suppose de
 * savoir qu'un dossier d'archives existe.
 *
 * Une seule marche arrière, la dernière : une pile d'annulation sur des
 * décisions persistées entrerait en concurrence avec celles d'une autre
 * fenêtre, et personne ne se souvient de son troisième archivage.
 *
 * `Ctrl+Z` n'est pris que hors saisie. Dans un champ ou le composeur, il
 * appartient au texte, et le détourner ferait perdre une frappe pour
 * ressusciter une conversation qu'on ne regardait plus.
 */

import * as React from 'react'

type Annulable = { cwd: string; sessionId: string; titre: string }

export function useArchiveUndo(
  restaurer: (cible: Annulable) => void,
): {
  /** À appeler juste après un archivage réussi. */
  noter: (cible: Annulable) => void
  /** La cible en attente, pour l'annoncer à l'écran. */
  enAttente: Annulable | null
  oublier: () => void
} {
  const [enAttente, setEnAttente] = React.useState<Annulable | null>(null)

  React.useEffect(() => {
    if (!enAttente) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'z' || !(event.ctrlKey || event.metaKey) || event.shiftKey) return
      const cible = event.target as HTMLElement | null
      const saisie =
        cible?.tagName === 'INPUT' ||
        cible?.tagName === 'TEXTAREA' ||
        cible?.isContentEditable
      if (saisie) return
      event.preventDefault()
      setEnAttente(null)
      restaurer(enAttente)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enAttente, restaurer])

  return {
    noter: setEnAttente,
    enAttente,
    oublier: () => setEnAttente(null),
  }
}
