/**
 * Modifications effectuées pendant la session en cours.
 *
 * Reconstituées depuis le fil plutôt que suivies à part : le fil est déjà la
 * source de vérité de ce que le modèle a fait, et un registre parallèle
 * finirait par diverger — un refus de permission oublié, une reprise de
 * session, et le panneau annoncerait des modifications qui n'ont pas eu lieu.
 *
 * Ne comptent que les éditions **appliquées** : un appel refusé ou en échec
 * n'a rien changé sur le disque, et l'afficher comme une modification serait
 * un mensonge sur l'état du dossier.
 */

import type { ThreadEntry } from '#desktop/session-protocol'
import { asFileChange, type FileChange } from '../thread/Diff.js'

export type SessionFile = {
  path: string
  /** Nom court, pour l'affichage ; le chemin complet reste en infobulle. */
  name: string
  /** Une entrée par édition appliquée, dans l'ordre du fil. */
  edits: FileChange[]
}

export function collectSessionChanges(entries: ThreadEntry[]): SessionFile[] {
  const byPath = new Map<string, SessionFile>()

  for (const entry of entries) {
    if (entry.kind !== 'tool') continue
    if (entry.decision === 'deny' || entry.isError) continue
    // Sans résultat, l'outil n'a pas rendu la main : l'édition est peut-être
    // en cours, elle n'est pas encore un fait.
    if (entry.result === undefined) continue

    const change = asFileChange(entry.name, entry.input)
    if (!change) continue

    const existing = byPath.get(change.path)
    if (existing) existing.edits.push(change)
    else {
      byPath.set(change.path, {
        path: change.path,
        name: change.path.split(/[\\/]/).pop() ?? change.path,
        edits: [change],
      })
    }
  }

  return [...byPath.values()]
}
