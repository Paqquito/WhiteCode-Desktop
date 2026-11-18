/**
 * Menu « + » du composeur.
 *
 * Rassemble tout ce qu'on peut **ajouter** à un message : des fichiers, et les
 * corpus documentaires dans lesquels le modèle aura le droit de chercher. Les
 * compétences y prendront leur place quand elles existeront — l'entrée est
 * affichée désactivée plutôt qu'absente, pour que la structure du menu ne
 * bouge pas le jour où elles arrivent.
 *
 * Les corpus sont ici plutôt que dans les paramètres parce que la question
 * « dans quoi peut-il chercher ? » se pose au moment d'écrire, pas au moment
 * de configurer. Les paramètres servent à *créer* et *indexer* un corpus ; ce
 * menu sert à décider lesquels comptent pour la suite de la conversation.
 */

import * as React from 'react'
import type { Corpus, ExtensionState } from '../../main/preload.js'
import { Icon } from '../ui/Icon.js'
import type { Tab as SettingsTab } from '#desktop/settings-dialog'

export function PlusMenu({
  corpora,
  extensions,
  disabled,
  onPickFiles,
  onToggleCorpus,
  onToggleExtension,
  onOpenSettings,
  onOpenCatalog,
}: {
  corpora: Corpus[]
  extensions: ExtensionState[]
  disabled: boolean
  onPickFiles: () => void
  onToggleCorpus: (id: string, enabled: boolean) => void
  onToggleExtension: (id: string, enabled: boolean) => void
  /**
   * Ouvre les réglages **sur l'onglet demandé**.
   *
   * La destination est un paramètre et non une convention : sans elle, les
   * deux raccourcis de ce menu appelaient le même rappel sans argument et
   * atterrissaient tous deux sur « Fournisseur », l'onglet par défaut du
   * dialogue (constat D05 de l'audit du 14 septembre 2026).
   */
  onOpenSettings: (tab: SettingsTab) => void
  onOpenCatalog?: () => void
}): React.ReactNode {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Un corpus vide n'a rien à offrir : le proposer donnerait au modèle des
  // outils qui ne rendent rien, dont il conclurait que le sujet n'est pas
  // documenté. Le critère est le nombre de fragments, pas la date
  // d'indexation — une indexation peut réussir sans rien trouver.
  const usable = corpora.filter(corpus => corpus.chunks > 0)
  // Seules les extensions installées sont proposées : une case pour quelque
  // chose d'absent du disque ne pourrait qu'échouer au prochain tour.
  const installed = extensions.filter(
    entry => entry.installed && entry.kind === 'plugin',
  )
  const activeCount =
    usable.filter(corpus => corpus.enabled).length +
    installed.filter(entry => entry.enabled).length

  return (
    <div className="menu" ref={rootRef}>
      <button
        type="button"
        className={open ? 'icon-button active' : 'icon-button'}
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Ajouter au message"
        aria-label="Ajouter au message"
      >
        <Icon name="plus" size={15} />
        {activeCount > 0 && <span className="plus-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="menu-list left up wide" role="menu">
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              onPickFiles()
              setOpen(false)
            }}
          >
            <Icon name="file" size={14} />
            <span className="menu-item-body">
              <span className="menu-item-label">
                Ajouter des fichiers ou des photos
              </span>
              <span className="menu-item-hint">
                Vous pouvez aussi les déposer ou les coller directement.
              </span>
            </span>
          </button>

          <div className="menu-separator" role="separator" />

          <div className="menu-heading">
            Bases de connaissances
            {usable.length > 0 && (
              <span className="menu-heading-note">
                {activeCount} actif{activeCount > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {usable.length === 0 ? (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onOpenSettings('corpus')
                setOpen(false)
              }}
            >
              <Icon name="search" size={14} />
              <span className="menu-item-body">
                <span className="menu-item-label">Créer une base de connaissances…</span>
                <span className="menu-item-hint">
                  Indexer un dossier pour que le modèle puisse y chercher.
                </span>
              </span>
            </button>
          ) : (
            usable.map(corpus => (
              <button
                key={corpus.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={corpus.enabled}
                className="menu-item"
                onClick={() => onToggleCorpus(corpus.id, !corpus.enabled)}
              >
                <span
                  className={corpus.enabled ? 'menu-check on' : 'menu-check'}
                  aria-hidden="true"
                >
                  {corpus.enabled && <Icon name="check" size={11} />}
                </span>
                <span className="menu-item-body">
                  <span className="menu-item-label">{corpus.name}</span>
                  <span className="menu-item-hint">
                    {corpus.documents} document(s) · {corpus.chunks} fragments
                  </span>
                </span>
              </button>
            ))
          )}

          <div className="menu-separator" role="separator" />

          <div className="menu-heading">Compétences</div>

          {installed.length === 0 ? (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                onOpenCatalog?.()
                setOpen(false)
              }}
            >
              <Icon name="sparkle" size={14} />
              <span className="menu-item-body">
                <span className="menu-item-label">Installer des extensions…</span>
                <span className="menu-item-hint">
                  Plugins de compétences, de revue et de méthode.
                </span>
              </span>
            </button>
          ) : (
            installed.map(entry => (
              <button
                key={entry.id}
                type="button"
                role="menuitemcheckbox"
                aria-checked={entry.enabled}
                className="menu-item"
                onClick={() => onToggleExtension(entry.id, !entry.enabled)}
              >
                <span
                  className={entry.enabled ? 'menu-check on' : 'menu-check'}
                  aria-hidden="true"
                >
                  {entry.enabled && <Icon name="check" size={11} />}
                </span>
                <span className="menu-item-body">
                  <span className="menu-item-label">{entry.name}</span>
                  <span className="menu-item-hint">{entry.summary}</span>
                </span>
              </button>
            ))
          )}
          {installed.length > 0 && onOpenCatalog && <button type="button" className="menu-item" onClick={() => { onOpenCatalog(); setOpen(false) }}>
            <Icon name="extension" size={14} />
            <span className="menu-item-label">Parcourir les plugins et skills…</span>
          </button>}
        </div>
      )}
    </div>
  )
}
