/**
 * Ce que l'utilisateur décide d'un projet.
 *
 * Un projet n'existe nulle part comme objet : c'est un dossier de travail
 * **déduit** des transcripts que le moteur a écrits. Il n'a donc ni nom propre,
 * ni réglages, ni existence en dehors de ses conversations.
 *
 * Ces trois décisions lui en donnent une, du côté de l'application seulement —
 * même partage que `sessionMeta.ts`, et pour la même raison : le type ici, le
 * disque dans `main/workspace/projectMeta.ts`.
 */

export type ProjectMeta = {
  /** Nom choisi, qui remplace celui du dossier. */
  name?: string
  /** Épinglé : remonte en tête de liste. */
  pinned?: boolean
  /**
   * Dossiers sources ajoutés au projet.
   *
   * Repris dans les dossiers supplémentaires de chaque nouvelle session ouverte
   * ici. C'est le seul réglage de projet qui change ce que le moteur peut lire,
   * d'où sa place : posé une fois, il évite de le redonner à chaque session.
   */
  sources?: string[]
  /** Consignes reprises par les nouvelles conversations du projet. */
  instructions?: string
  /**
   * Retiré de la liste.
   *
   * **Ne supprime rien.** Les transcripts restent où le moteur les a écrits ;
   * seule la liste cesse de montrer ce dossier. Effacer une conversation est
   * une opération de fichiers, elle ne se déclenche pas depuis un menu.
   */
  removed?: boolean
}

export function isEmptyProjectMeta(meta: ProjectMeta): boolean {
  return !meta.instructions && !meta.name && !meta.pinned && !meta.removed && !(meta.sources?.length)
}

/** Le nom choisi l'emporte ; sinon celui du dossier. */
export function projectName(meta: ProjectMeta | undefined, derived: string): string {
  return meta?.name?.trim() || derived
}

/**
 * Ordre d'affichage : les épinglés d'abord, le reste par activité.
 *
 * Même règle que pour les conversations : l'épingle ne rejoue pas la
 * chronologie entre deux projets épinglés.
 */
export function compareProjects(
  a: { pinned?: boolean; updatedAt: number },
  b: { pinned?: boolean; updatedAt: number },
): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
  return b.updatedAt - a.updatedAt
}
