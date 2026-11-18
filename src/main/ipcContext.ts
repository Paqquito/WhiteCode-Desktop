/**
 * Ce qu'un domaine peut demander au processus principal.
 *
 * Les canaux IPC étaient des fermetures dans `index.ts` : elles lisaient
 * directement `window`, `engines`, `requestedSession`. Réparties par domaine,
 * ces lectures doivent devenir des paramètres — et ce passage est le seul
 * endroit où une régression peut se loger, car il rend explicite ce qui était
 * implicite.
 *
 * ## Des accesseurs, jamais des valeurs
 *
 * `window` et `engines` sont **réassignés** : la fenêtre est recréée à
 * l'activation, le gestionnaire est remis à `null` à la fermeture puis rebâti à
 * la demande. Passer leur valeur figerait chaque domaine sur l'instance vivante
 * au moment du câblage — c'est-à-dire sur `null`, puisque le câblage précède
 * `app.whenReady()`. D'où des fonctions partout, sans exception.
 *
 * La distinction entre `engines()` et `enginesIfAny()` compte autant. Le premier
 * construit le gestionnaire s'il manque ; le second se contente de regarder.
 * `models:remove`, `start` et `stop` lisaient `engines?.isBusy` — sans moteur,
 * la réponse est « pas occupé », et surtout aucun moteur n'est créé. Les faire
 * passer par `engines()` monterait un gestionnaire complet pour répondre à une
 * question sur le serveur local.
 */

import type { BrowserWindow } from 'electron'
import type { EngineManager } from '#desktop/conversation-manager'
import type { ManagedWorktree } from './vcs/worktrees.js'

export type MainContext = {
  /** La fenêtre vivante, ou `null` entre deux. Un dialogue sans elle n'ouvre rien. */
  window: () => BrowserWindow | null
  /** Pousse un événement vers le rendu ; sans effet si la fenêtre est partie. */
  toRenderer: (channel: string, payload: unknown) => void
  /** Le gestionnaire de moteurs, construit au besoin. */
  engines: () => EngineManager
  /** Le gestionnaire s'il existe déjà — n'en construit aucun. */
  enginesIfAny: () => EngineManager | null
  /**
   * Sérialise les opérations qui touchent à l'arborescence de travail.
   *
   * Ouvrir une session ou un terminal ne doit pas croiser la suppression d'un
   * worktree.
   */
  workspaceAction: <T>(action: () => Promise<T> | T) => Promise<T>
  /** Le worktree correspondant à un dossier, s'il en est un. */
  worktreeFor: (cwd: string) => Promise<ManagedWorktree | undefined>
  /** Dossier de l'application (`dist/distribution.json`) et dossier du moteur (exécutable dans `dist/`). */
  appRoot: string
  engineRoot: string
  /** Dépôt du moteur, où il écrit ses transcriptions. */
  engineHome: string
  /** L'identifiant qu'une notification a demandé d'ouvrir, s'il y en a un. */
  requestedSession: () => string | null
  /**
   * Le rendu annonce la conversation qu'il affiche.
   *
   * Acquitte du même geste une navigation plus récente que le clic sur une
   * notification, et marque le rendu comme prêt.
   */
  selectSession: (id: string | null) => void
}
