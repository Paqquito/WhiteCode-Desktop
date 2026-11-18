/**
 * Ce que l'utilisateur décide d'une conversation.
 *
 * Le moteur ne connaît ni épingle, ni archive, ni titre choisi : il écrit des
 * transcripts, et le titre affiché est déduit du premier message. Ces trois
 * décisions appartiennent donc à l'application, et sont rangées à côté des
 * transcripts plutôt que dedans — réécrire un fichier du moteur pour y poser
 * un nom serait le corrompre au premier changement de format.
 *
 * Même partage que `sessionOrigin.ts` : le type ici, la lecture et l'écriture
 * dans `main/session/sessionMeta.ts`, pour que le rendu n'entraîne pas
 * `node:fs` dans son paquet.
 */

export type SessionMeta = {
  /**
   * Titre choisi, qui remplace celui déduit du premier message.
   *
   * Absent tant que rien n'a été renommé : c'est ce qui permet au titre déduit
   * de suivre la conversation quand on ne l'a pas figé.
   */
  title?: string
  /** Épinglée : remonte en tête de liste, hors de l'ordre chronologique. */
  pinned?: boolean
  /** Archivée : sortie de la liste sans être effacée. */
  archived?: boolean
  /**
   * Marquée non lue à la main.
   *
   * Distincte du non-lu d'activité (`SessionAttention`), qui appartient au
   * moteur et retombe dès qu'on ouvre la conversation. Celle-ci est une
   * intention — « j'y reviens » — et survit donc au redémarrage.
   */
  unread?: boolean
}

/** Rien de retenu — sert à distinguer « pas de fichier » de « fichier vide ». */
export function isEmptyMeta(meta: SessionMeta): boolean {
  return !meta.title && !meta.pinned && !meta.archived && !meta.unread
}

/**
 * Titre à afficher.
 *
 * Le titre choisi l'emporte ; sinon celui déduit du transcript. Un titre vide
 * ou fait d'espaces ne compte pas — l'accepter effacerait le nom à l'écran
 * sans que rien ne le dise.
 */
export function displayTitle(meta: SessionMeta | undefined, derived: string): string {
  const chosen = meta?.title?.trim()
  return chosen || derived
}

/**
 * Ordre d'affichage : les épinglées d'abord, le reste par activité.
 *
 * L'épingle ne change pas la date : deux sessions épinglées restent entre
 * elles dans l'ordre chronologique, sinon épingler la seconde la ferait passer
 * devant la première sans raison visible.
 */
export function compareSessions(
  a: { pinned?: boolean; updatedAt: number },
  b: { pinned?: boolean; updatedAt: number },
): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt
}
