import { DOCUMENT_PREVIEW, HTML_PREVIEW } from '../../shared/browser.js'
import { DocumentPreview } from './WebSurface.js'
/**
 * Explorateur de fichiers.
 *
 * Arborescence à gauche, contenu à droite. Le contenu est lu **un niveau à la
 * fois** : un dossier de projet contient `node_modules`, et le parcourir
 * entièrement bloquerait l'application pour un contenu que personne ne déplie.
 *
 * ## L'édition est directe
 *
 * Pas de bascule entre lecture et écriture : le fichier ouvert est modifiable
 * tel quel, et `Ctrl+S` enregistre. Un bouton « Modifier » ajoutait un geste
 * avant chaque correction et faisait perdre la coloration une fois activé —
 * deux frictions pour aucun bénéfice, puisque rien n'est écrit sur le disque
 * tant qu'on n'a pas enregistré.
 *
 * Les onglets conservent les brouillons lors du changement de fichier. Perdre une
 * correction parce qu'on a cliqué à côté est le genre de détail qui fait
 * abandonner un éditeur intégré.
 *
 * ## Deux colonnes dans un panneau étroit
 *
 * À sa largeur d'ouverture, le panneau fait 460 px : l'arborescence en prend
 * 175 et il reste 285 px pour lire, où une ligne de code sur deux se coupe. Le
 * constat D02 partait de là.
 *
 * L'arborescence se masque donc, et le choix est retenu. C'est la réponse la
 * plus directe : un clic rend toute la largeur à la lecture, et le panneau
 * n'oublie pas qu'on préfère lire. Élargir à la poignée reste possible et
 * profite désormais entièrement au texte — la colonne de gauche cesse de
 * grandir passé 260 px, au lieu de réclamer 38 % de tout ce qu'on lui donne.
 *
 * ## Lire n'est pas éditer
 *
 * Un Markdown s'ouvre **rendu**. C'est ce qu'on vient y chercher neuf fois sur
 * dix — un README se lit —, et le voir en source brute était le second grief
 * de D02. La bascule vers la source est explicite et ne quitte pas le fichier :
 * l'aperçu montre le brouillon en cours, pas le disque, donc on peut corriger,
 * revenir voir le rendu, et enregistrer ensuite.
 */

import * as React from 'react'
import type { DirEntry, FileContent } from '../../main/preload.js'
import { CodeEditor } from '../code/CodeEditor.js'
import { languageOf } from '../code/Highlight.js'
import { Icon } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'
import { Panel, PanelEmpty } from '../ui/Panel.js'
import { Markdown } from '../thread/Markdown.js'
import { useFileTabs, isDirty } from './useFileTabs.js'

/** Fichiers dont un rendu vaut mieux que la source à l'ouverture. */
const MARKDOWN = /\.(md|markdown|mdx)$/i

/**
 * Faut-il montrer le rendu plutôt que la source ?
 *
 * Extrait parce que c'est une décision de produit et non un détail
 * d'affichage : un Markdown s'ouvre **rendu**, c'est ce qu'on vient y chercher
 * neuf fois sur dix. `chosen` est ce que l'utilisateur a demandé pour ce
 * fichier-ci, `null` tant qu'il n'a rien demandé.
 */
export function opensRendered(path: string | null, chosen: boolean | null): boolean {
  if (!path || !(MARKDOWN.test(path) || HTML_PREVIEW.test(path))) return false
  return chosen ?? true
}

/**
 * Arborescence masquée ou non, retenue d'une fois sur l'autre.
 *
 * Dans `localStorage` et non dans la session : c'est une préférence de lecture,
 * elle n'appartient pas à une conversation en particulier.
 */
const TREE_KEY = 'desktop:files-tree'

function useTreeVisible(): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = React.useState(() => {
    try {
      return localStorage.getItem(TREE_KEY) !== 'hidden'
    } catch {
      return true
    }
  })
  return [
    visible,
    next => {
      setVisible(next)
      try {
        localStorage.setItem(TREE_KEY, next ? 'shown' : 'hidden')
      } catch {
        // Un stockage indisponible ne doit pas empêcher de masquer l'arbre ;
        // le choix vaudra pour la session en cours, sans être retenu.
      }
    },
  ]
}

export function FilesPanel({
  sessionId,
  root,
  target,
  onClose,
}: {
  sessionId: string | null
  root: string
  /**
   * Fichier à ouvrir, demandé de l'extérieur.
   *
   * C'est ce qui permet à un chemin cliqué dans la conversation d'aboutir ici.
   * La sélection reste locale au panneau le reste du temps : la remonter
   * entièrement obligerait la coquille à connaître un détail d'affichage.
   */
  target: { path: string } | null
  onClose: () => void
}): React.ReactNode {
  const { tabs, selected, active, openFile, save, reload, close, setDraft } = useFileTabs(sessionId, root)
  const content = active?.content ?? null
  const draft = active?.draft ?? null
  const saving = active?.saving ?? false
  const error = active?.error ?? null
  const saved = active?.saved ?? false
  const dirty = active ? isDirty(active) : false
  const [treeVisible, setTreeVisible] = useTreeVisible()
  const [preview, setPreview] = React.useState<boolean | null>(null)
  React.useEffect(() => setPreview(null), [selected])
  React.useEffect(() => { if (target) void openFile(target.path) }, [target, sessionId, root])

  const name = selected?.split(/[\\/]/).pop() ?? ''
  const text = draft ?? (content?.ok === true ? content.text : '')
  const canPreview = Boolean(selected && (MARKDOWN.test(selected) || HTML_PREVIEW.test(selected)))
  const isDocument = Boolean(selected && DOCUMENT_PREVIEW.test(selected))
  const showPreview = opensRendered(selected, preview)

  return (
    <Panel
      title="Fichiers"
      icon="folder"
      onClose={onClose}
      padded={false}
      scroll={false}
      actions={
        <>
          <IconButton
            icon="sidebar"
            size={14}
            variant={treeVisible ? undefined : 'active'}
            pressed={!treeVisible}
            onClick={() => setTreeVisible(!treeVisible)}
            title={treeVisible ? 'Masquer l’arborescence' : 'Afficher l’arborescence'}
            label={treeVisible ? 'Masquer l’arborescence' : 'Afficher l’arborescence'}
          />
          {selected && <IconButton icon="refresh" size={14} onClick={() => void reload()} disabled={saving} title="Recharger depuis le disque" label="Recharger le fichier" />}
          {content?.ok === true && !isDocument && (
            <IconButton icon="save" size={14} variant={dirty ? 'accent' : undefined} onClick={() => void save()} disabled={!dirty || saving} title="Enregistrer (Ctrl+S)" label="Enregistrer" />
          )}
        </>
      }
    >
      <div className={treeVisible ? 'files' : 'files tree-hidden'}>
        {treeVisible && (
        <div className="file-tree">
          <TreeLevel
            root={root}
            dir={undefined}
            depth={0}
            selected={selected}
            onOpenFile={openFile}
          />
        </div>
        )}

        <div className="file-view">
          {tabs.length > 0 && <div className="file-tabs" role="tablist" aria-label="Fichiers ouverts" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            if (index < 0) return
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
            buttons[next]?.focus(); buttons[next]?.click()
          }}>
            {tabs.map(tab => <div className="file-tab" key={tab.token}>
              <button type="button" role="tab" aria-selected={selected === tab.path} tabIndex={selected === tab.path ? 0 : -1} title={tab.path} onClick={() => void openFile(tab.path)}>
                <span>{tab.path.split(/[\\/]/).pop()}</span>{isDirty(tab) && <span aria-label="Modifié">●</span>}
              </button>
              <button type="button" aria-label={`Fermer ${tab.path.split(/[\\/]/).pop()}`} disabled={tab.saving} onClick={() => close(tab)}>×</button>
            </div>)}
          </div>}

          {selected && (
            <div className="file-head">
              <span className="file-name" title={selected}>
                {name}
              </span>
              {dirty && <span className="file-dirty">non enregistré</span>}
              {saving && <span className="file-dirty">enregistrement…</span>}
              {saved && <span className="file-saved">enregistré</span>}
              {canPreview && content?.ok === true && (
                <div className="tabs file-modes" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={showPreview}
                    className={showPreview ? 'tab active' : 'tab'}
                    onClick={() => setPreview(true)}
                  >
                    <Icon name="file" size={13} />
                    <span>Aperçu</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!showPreview}
                    className={showPreview ? 'tab' : 'tab active'}
                    onClick={() => setPreview(false)}
                  >
                    <Icon name="code" size={13} />
                    <span>Source</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {error && <div className="file-error" role="alert">{error}</div>}

          <div className="file-body">
            {!selected && (
              <div className="panel-pad">
                <PanelEmpty>Sélectionnez un fichier.</PanelEmpty>
              </div>
            )}
            {selected && !content && !isDocument && (
              <div className="panel-pad">
                <PanelEmpty>Lecture…</PanelEmpty>
              </div>
            )}
            {selected && isDocument && <DocumentPreview key={`${root}:${selected}`} root={root} path={selected} revision={active?.token} />}
            {content?.ok === false && !isDocument && (
              <div className="panel-pad">
                <PanelEmpty>
                  {content.reason === 'binary' && 'Fichier binaire.'}
                  {content.reason === 'too-large' && 'Fichier trop volumineux.'}
                  {content.reason === 'unreadable' && 'Fichier illisible.'}
                </PanelEmpty>
              </div>
            )}
            {content?.ok === true && showPreview && selected && HTML_PREVIEW.test(selected) && <DocumentPreview root={root} path={selected} html={text} revision={active?.token} />}
            {content?.ok === true && showPreview && selected && !HTML_PREVIEW.test(selected) && (
              // Le brouillon et non le disque : on corrige dans la source, on
              // revient voir le rendu, et l'enregistrement vient après.
              <div key={selected} className="file-preview" tabIndex={0} role="region" aria-label={`Aperçu de ${name}`}>
                <Markdown text={text} />
              </div>
            )}
            {content?.ok === true && !showPreview && !isDocument && (
              <CodeEditor
                value={text}
                language={languageOf(content.path)}
                // Un fichier tronqué est modifiable en apparence mais
                // l'enregistrer écraserait la partie non lue.
                readOnly={content.truncated}
                onChange={setDraft}
                onSave={() => void save()}
              />
            )}
          </div>
        </div>
      </div>
    </Panel>
  )
}

/**
 * Un niveau d'arborescence.
 *
 * Récursif par composant plutôt que par données : chaque niveau charge le sien
 * à l'ouverture, ce qui répartit le coût au lieu de le concentrer au premier
 * affichage.
 */
function TreeLevel({
  root,
  dir,
  depth,
  selected,
  onOpenFile,
}: {
  root: string
  dir: string | undefined
  depth: number
  selected: string | null
  onOpenFile: (path: string) => void
}): React.ReactNode {
  const [entries, setEntries] = React.useState<DirEntry[] | null>(null)
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set())

  React.useEffect(() => {
    let alive = true
    setEntries(null)
    void window.engine.readDirectory(root, dir).then(result => {
      if (alive) setEntries(result)
    }).catch(() => { if (alive) setEntries([]) })
    return () => {
      alive = false
    }
  }, [root, dir])

  if (!entries) {
    return depth === 0 ? <p className="tree-loading">Lecture…</p> : null
  }

  return (
    <>
      {entries.length === 0 && <p className="tree-loading">Dossier vide ou inaccessible.</p>}
      {entries.map(entry => {
        const isOpen = expanded.has(entry.path)
        return (
          <React.Fragment key={entry.path}>
            <button
              type="button"
              className={`tree-row${entry.path === selected ? ' selected' : ''}`}
              style={{ paddingLeft: 8 + depth * 13 }}
              onClick={() => {
                if (entry.kind === 'dir') {
                  setExpanded(current => {
                    const next = new Set(current)
                    if (next.has(entry.path)) next.delete(entry.path)
                    else next.add(entry.path)
                    return next
                  })
                } else {
                  onOpenFile(entry.path)
                }
              }}
              title={entry.name}
            >
              {entry.kind === 'dir' ? (
                <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={11} />
              ) : (
                <span className="tree-spacer" />
              )}
              <Icon
                name={
                  entry.kind === 'dir' ? (isOpen ? 'folder-open' : 'folder') : 'file'
                }
                size={13}
              />
              <span className="tree-name">{entry.name}</span>
            </button>

            {entry.kind === 'dir' && isOpen && (
              <TreeLevel
                root={root}
                dir={entry.path}
                depth={depth + 1}
                selected={selected}
                onOpenFile={onOpenFile}
              />
            )}
          </React.Fragment>
        )
      })}
    </>
  )
}
