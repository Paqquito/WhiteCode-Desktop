import * as React from 'react'
import type { SessionSettings, ThreadEntry } from '#desktop/session-protocol'

/** Only completed file tools are evidence. Shell commands and mere mentions
 * do not prove that a file was read or produced. */
export function sessionFiles(entries: ThreadEntry[]) {
  const read = new Set<string>(), written = new Set<string>()
  for (const entry of entries) {
    if (entry.kind !== 'tool' || entry.result === undefined || entry.unresolved || entry.interrupted || entry.decision === 'deny') continue
    if (!entry.input || typeof entry.input !== 'object') continue
    const input = entry.input as Record<string, unknown>
    if (entry.isError) continue
    if (entry.name === 'deliver_file') for (const line of entry.result.split('\n')) {
      const delivered = /^Delivered: (.+) \((?:attach|render)\)$/.exec(line)
      if (delivered) written.add(delivered[1]!)
    }
    const path = input.file_path ?? input.path
    if (typeof path !== 'string' || !path) continue
    if (['Read', 'read_file'].includes(entry.name)) read.add(path)
    if (['Write', 'Edit', 'MultiEdit', 'SendUserFile', 'write_file', 'edit_file'].includes(entry.name)) written.add(path)
  }
  return { read: [...read], written: [...written] }
}
export function ConversationContext({ workspace, project, worktree, entries, settings, resources = [], onRemoveDirectory, onOpenFile }: {
  resources?: Array<{ id: string; name: string; kind: string; remove: () => void }>;
  workspace: string; project: string; worktree?: { branch: string; root: string }; entries: ThreadEntry[];
  settings: SessionSettings; onRemoveDirectory: (dir: string) => void; onOpenFile: (path: string) => void;
}) {
  const files = React.useMemo(() => sessionFiles(entries), [entries])
  return <details className="conversation-context">
    <summary title={workspace}><span className="context-project">{project || workspace.split(/[\\/]/).filter(Boolean).pop() || 'Aucun dossier'}</span><span>{worktree ? `Copie Git · ${worktree.branch}` : 'Dossier local'}</span><span className="context-count">Contexte{files.written.length > 0 ? ` · ${files.written.length} fichier${files.written.length > 1 ? 's' : ''} de sortie` : ''}</span></summary>
    <div className="context-content">
      <h3>Dossier de travail</h3><p className="context-path">{workspace}</p>
      <p>{worktree ? `Copie séparée de ${worktree.root}. Les changements restent sur la branche ${worktree.branch} jusqu’à leur intégration.` : 'Les modifications sont faites dans ce dossier.'}</p>
      {settings.extraDirs.length > 0 && <><h3>Dossiers supplémentaires autorisés</h3>{settings.extraDirs.map(dir => <div className="context-row" key={dir}><span className="context-path">{dir}</span><button type="button" onClick={() => onRemoveDirectory(dir)} aria-label={`Retirer l’accès à ${dir}`}>Retirer</button></div>)}<p>Le retrait concerne les prochains envois ; les informations déjà lues restent dans le fil.</p></>}
      {settings.projectInstructions && <><h3>Instructions du projet</h3><p className="context-instructions">{settings.projectInstructions}</p></>}
      {resources.length > 0 && <><h3>Ressources actives dans l’application</h3>{resources.map(item => <div className="context-row" key={item.id}><span>{item.name} · {item.kind}</span><button type="button" onClick={item.remove} aria-label={`Désactiver ${item.name} dans l’application`}>Désactiver</button></div>)}<p>Leur activation est partagée entre les conversations. Disponible ne signifie pas déjà consulté.</p></>}
      <h3>Fichiers consultés ({files.read.length})</h3>{files.read.map(path => <button type="button" className="context-file" key={path} onClick={() => onOpenFile(path)}>{path}</button>)}
      <h3>Fichiers modifiés ou transmis ({files.written.length})</h3>{files.written.map(path => <button type="button" className="context-file" key={path} onClick={() => onOpenFile(path)}>{path}</button>)}
      <p>Ce résumé recense les outils de fichiers terminés avec succès. Les commandes du terminal peuvent modifier d’autres fichiers : consultez le panneau Modifications.</p>
    </div>
  </details>
}
