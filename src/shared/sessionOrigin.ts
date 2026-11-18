/**
 * Provenance d'une session.
 *
 * Le type seul, séparé de sa lecture et de son écriture sur disque
 * (`session/sessionOrigins.ts`) — même partage que `routines.ts` et
 * `routinesStore.ts`, et pour la même raison : le rendu affiche une provenance
 * mais ne doit jamais tirer `node:fs` dans son paquet.
 */

export type SessionOrigin = {
  kind: 'routine'
  routineId: string
  cron: string
  firedAt: number
}
