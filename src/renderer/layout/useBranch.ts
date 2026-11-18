/**
 * Branche Git d'un dossier de travail, pour la carte de survol.
 *
 * Mise en cache par dossier et partagée par toutes les lignes : survoler une
 * liste de trente conversations ne doit pas lancer trente `git branch`. Le
 * cache vit au module — une conversation survolée deux fois ne repaie pas, et
 * la barre latérale se remonte souvent.
 *
 * Volontairement sans invalidation : une branche changée en cours de session
 * s'affichera périmée jusqu'au redémarrage. C'est le bon compromis ici — cette
 * ligne est une indication de repérage, pas une source pour décider d'un
 * commit, et le panneau Modifications donne l'état réel.
 */

import * as React from 'react'

/** `null` : dossier hors dépôt. `undefined` : pas encore su. */
const cache = new Map<string, string | null>()
const enCours = new Map<string, Promise<void>>()

export function useBranch(cwd: string, actif: boolean): string | null | undefined {
  const [, refaire] = React.useReducer((n: number) => n + 1, 0)

  React.useEffect(() => {
    if (!actif || !cwd || cache.has(cwd)) return
    let vivant = true
    const demande =
      enCours.get(cwd) ??
      window.engine
        .repository(cwd)
        .then(info => {
          cache.set(cwd, info.branch || null)
        })
        .catch(() => {
          // Hors dépôt, Git absent, dossier disparu : la carte se passe de la
          // ligne plutôt que d'afficher une erreur pour une indication.
          cache.set(cwd, null)
        })
        .finally(() => {
          enCours.delete(cwd)
        })
    enCours.set(cwd, demande)
    void demande.then(() => {
      if (vivant) refaire()
    })
    return () => {
      vivant = false
    }
  }, [cwd, actif])

  return cache.get(cwd)
}
