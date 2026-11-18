/**
 * Réglages de session : mode de permission, modèle, effort.
 *
 * Conservés côté rendu et poussés au processus principal à chaque changement.
 * Ils survivent au relancement de l'application — ce sont des habitudes de
 * travail, pas des choix qu'on refait chaque matin.
 *
 * Le moteur les reçoit en drapeaux de lancement (`--permission-mode`,
 * `--model`, `--effort`) parce qu'il repart en sous-processus neuf à chaque
 * tour ; un changement en cours de tour est en plus poussé par requête de
 * contrôle.
 */

import * as React from 'react'
import { savedModel } from '#desktop/model-selection'
import {
  DEFAULT_SESSION_SETTINGS,
  ESSENTIAL_TOOLS,
  type EffortLevel,
  type PermissionMode,
  type SessionSettings,
} from '#desktop/session-protocol'

export { ESSENTIAL_TOOLS }

const KEY = 'desktop:settings'

/**
 * Modes proposés.
 *
 * Sans interruption refuse les actions non autorisées ; Ignorer les permissions
 * les autorise. Ces deux choix ont des effets opposés.
 */
export const PERMISSION_MODES: Array<{
  id: PermissionMode
  label: string
  hint: string
  apart?: boolean
}> = [
  {
    id: 'default',
    label: 'Manuel',
    hint: 'Demander avant chaque action sensible',
  },
  {
    id: 'acceptEdits',
    label: 'Accepter les modifications',
    hint: 'Autorise les éditions de fichiers ; les commandes et outils externes peuvent demander',
  },
  {
    id: 'plan',
    label: 'Plan',
    hint: 'Établir un plan, sans rien modifier',
  },
  {
    id: 'dontAsk',
    label: 'Sans interruption',
    hint: 'Ne jamais demander ; ce qui aurait demandé est refusé',
  },
  {
    // À part : ce n'est pas un degré de plus sur la même échelle, c'est la
    // suppression de l'échelle. Le présenter comme un quatrième choix invite
    // à le prendre sans y penser.
    id: 'bypassPermissions',
    label: 'Ignorer les permissions',
    hint: 'Plus aucune vérification — à réserver aux dossiers jetables',
    apart: true,
  },
]

export const EFFORTS: Array<{ id: EffortLevel; label: string }> = [
  { id: 'low', label: 'Faible' },
  { id: 'medium', label: 'Moyen' },
  { id: 'high', label: 'Élevé' },
  { id: 'max', label: 'Maximum' },
]

export function loadSettings(): SessionSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SESSION_SETTINGS
    const parsed = JSON.parse(raw) as Partial<SessionSettings>
    return {
      // Chaque champ est revalidé : une valeur enregistrée par une version
      // antérieure ferait échouer le lancement du moteur, qui rejette les
      // drapeaux inconnus — et l'application paraîtrait cassée sans raison.
      permissionMode: PERMISSION_MODES.some(m => m.id === parsed.permissionMode)
        ? parsed.permissionMode!
        : 'default',
      model: savedModel(parsed.model),
      effort: EFFORTS.some(e => e.id === parsed.effort) ? parsed.effort! : null,
      // Un dossier autorisé appartient à un projet, pas aux préférences
      // globales. Le principal recharge les sources du projet de destination.
      extraDirs: [],
      tools: Array.isArray(parsed.tools) ? parsed.tools : null,
      mcpServers: Array.isArray(parsed.mcpServers) ? parsed.mcpServers.filter((id): id is string => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(id)) : null,
    }
  } catch {
    return DEFAULT_SESSION_SETTINGS
  }
}

export function useSettings(settings: SessionSettings, setSettings: React.Dispatch<React.SetStateAction<SessionSettings>>) {

  const setPermissionMode = React.useCallback(
    (permissionMode: PermissionMode) =>
      setSettings(s => ({ ...s, permissionMode })),
    [setSettings],
  )
  const setModel = React.useCallback(
    (model: string | null) => setSettings(s => ({ ...s, model })),
    [setSettings],
  )
  const setEffort = React.useCallback(
    (effort: EffortLevel | null) => setSettings(s => ({ ...s, effort })),
    [setSettings],
  )

  const setReducedTools = React.useCallback(
    (reduced: boolean) =>
      setSettings(s => ({ ...s, tools: reduced ? ESSENTIAL_TOOLS : null })),
    [setSettings],
  )

  return {
    settings,
    setPermissionMode,
    setModel,
    setEffort,
    setReducedTools,
  }
}
