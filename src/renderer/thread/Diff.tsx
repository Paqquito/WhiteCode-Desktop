/**
 * Rendu des modifications de fichiers proposées par le modèle.
 *
 * Sans cela, une édition s'affiche en JSON brut : deux longues chaînes
 * échappées, illisibles. Or c'est l'information que l'on relit le plus dans un
 * outil de code — et celle sur laquelle on accorde ou refuse une permission.
 *
 * Le diff est calculé dans le rendu, et non demandé au moteur : les chaînes
 * sont déjà présentes dans l'entrée de l'outil, et un aller-retour n'apporterait
 * rien.
 */

import * as React from 'react'
import { DiffBody, DiffStat } from '../diff/DiffView.js'
import {
  collapseContext,
  countChanges,
  diffLines,
  type DiffRow,
} from '../diff/model.js'

/** Entrée reconnue comme une modification de fichier. */
export type FileChange =
  | { tool: 'edit'; path: string; before: string; after: string; all: boolean }
  | { tool: 'write'; path: string; content: string }

/**
 * Reconnaît une entrée d'outil comme modification de fichier.
 *
 * Rend `null` pour tout le reste : l'appelant retombe alors sur l'affichage
 * JSON générique, qui reste correct pour les autres outils.
 */
export function asFileChange(
  toolName: string,
  input: unknown,
): FileChange | null {
  if (!input || typeof input !== 'object') return null
  const native = input as Record<string, unknown>
  const record = toolName === 'edit_file' ? { ...native, file_path: native.path, old_string: native.old_text, new_string: native.new_text, replace_all: native.all_occurrences } : toolName === 'write_file' ? { ...native, file_path: native.path } : native
  const path = typeof record.file_path === 'string' ? record.file_path : null
  if (!path) return null

  if (
    (toolName === 'Edit' || toolName === 'FileEdit' || toolName === 'edit_file') &&
    typeof record.old_string === 'string' &&
    typeof record.new_string === 'string'
  ) {
    return {
      tool: 'edit',
      path,
      before: record.old_string,
      after: record.new_string,
      all: record.replace_all === true,
    }
  }

  if (
    (toolName === 'Write' || toolName === 'FileWrite' || toolName === 'write_file') &&
    typeof record.content === 'string'
  ) {
    return { tool: 'write', path, content: record.content }
  }

  return null
}

/** Lignes d'un changement, sous la forme attendue par l'affichage. */
export function changeRows(change: FileChange): DiffRow[] {
  return change.tool === 'write'
    ? change.content
        .split('\n')
        .map((text, index) => ({ kind: 'add' as const, text, newNo: index + 1 }))
    : collapseContext(diffLines(change.before, change.after))
}

export function FileChangeView({
  change,
}: {
  change: FileChange
}): React.ReactNode {
  const rows = React.useMemo(() => changeRows(change), [change])
  const { added, removed } = countChanges(rows)

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-path" title={change.path}>
          {change.path}
        </span>
        <DiffStat added={added} removed={removed} />
        {change.tool === 'edit' && change.all && (
          <span className="diff-flag">toutes les occurrences</span>
        )}
      </div>
      <DiffBody rows={rows} />
    </div>
  )
}
