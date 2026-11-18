import { BrowserPanel } from './BrowserPanel.js'
/**
 * Colonne des panneaux.
 *
 * Empile les panneaux ouverts à droite de la conversation, dans l'ordre
 * d'ouverture, séparés par des poignées. La colonne disparaît entièrement
 * quand rien n'est ouvert : une conversation seule mérite toute la largeur.
 *
 * Chaque panneau garde une hauteur réglable **sauf le dernier**, qui absorbe
 * la place restante. Si tous étaient fixes, la moindre variation de hauteur de
 * la fenêtre laisserait un vide en bas de la colonne ou provoquerait un
 * débordement — et l'utilisateur devrait rajuster à chaque redimensionnement.
 */

import { NativePanel } from '../nativeViews.js'
import * as React from 'react'
import {
  PANEL_HEIGHT_MAX,
  PANEL_HEIGHT_MIN,
  type useLayout,
} from '../state/useLayout.js'
import { panelLabel, type PanelId } from '../state/usePanels.js'
import type { PluginPanelManifest } from '../../shared/pluginPanel.js'
import { PluginPanel } from './PluginPanel.js'
import { Splitter } from '../ui/Splitter.js'
import type { ThreadEntry } from '../../shared/protocol.js'
import type { ReviewComment } from '../state/useReview.js'
import { AgentsPanel } from './AgentsPanel.js'
import { ChangesPanel } from './ChangesPanel.js'
import { FilesPanel } from './FilesPanel.js'
import { PlanPanel } from './PlanPanel.js'
import { Panel, PanelEmpty } from '../ui/Panel.js'
import { TerminalPanel } from './TerminalPanel.js'

/** Ce que le panneau des modifications consomme de la revue. */
type ReviewApi = {
  forFile: (file: string) => ReviewComment[]
  add: (draft: Omit<ReviewComment, 'id'>) => void
  remove: (id: string) => void
}

export function PanelHost({
  sessionId,
  open,
  workspace,
  entries,
  busy,
  layout,
  review,
  fileTarget,
  onClose,
  onPrompt,
  pluginPanels = [],
}: {
  sessionId: string | null
  open: PanelId[]
  workspace: string
  entries: ThreadEntry[]
  busy: boolean
  layout: ReturnType<typeof useLayout>
  review: ReviewApi
  /** Fichier désigné depuis la conversation, à ouvrir dans l'explorateur. */
  fileTarget: { path: string } | null
  onClose: (id: PanelId) => void
  /** Prépare une demande dans la zone de saisie, sans l'envoyer. */
  onPrompt: (text: string) => void
  pluginPanels?: readonly PluginPanelManifest[]
}): React.ReactNode {
  const slots = React.useRef(new Map<PanelId, HTMLElement>())
  const previous = React.useRef<PanelId[]>([])

  /**
   * Amène dans la vue le panneau qui vient d'être ouvert.
   *
   * La colonne défile quand les hauteurs demandées dépassent sa place — c'est
   * un choix assumé plus haut, préféré à l'écrasement du dernier panneau. Mais
   * rien ne faisait défiler : au quatrième panneau, le bouton s'allumait et
   * l'utilisateur ne voyait rien apparaître, le nouveau venu étant empilé sous
   * la limite visible (constat D03 de l'audit du 14 septembre 2026).
   *
   * Seuls les panneaux **nouvellement ouverts** sont visés : refermer un
   * panneau, ou revenir sur la session, ne doit pas déplacer la colonne sous
   * les yeux de quelqu'un qui lisait autre chose.
   */
  React.useEffect(() => {
    const nouveaux = open.filter(id => !previous.current.includes(id))
    previous.current = open
    const dernier = nouveaux[nouveaux.length - 1]
    if (dernier) {
      slots.current.get(dernier)?.scrollIntoView({ block: 'nearest' })
    }
  }, [open])

  if (open.length === 0) return null

  return (
    <div className="panel-host">
      {open.map((id, index) => {
        const last = index === open.length - 1
        return (
          <React.Fragment key={id}>
            <div
              className="panel-slot"
              ref={node => {
                if (node) slots.current.set(id, node)
                else slots.current.delete(id)
              }}
              style={
                last
                  ? { flex: '1 1 auto', minHeight: PANEL_HEIGHT_MIN }
                  : { flex: `0 0 ${layout.panelHeight(id)}px` }
              }
            >
              {renderPanel(id, sessionId, workspace, entries, busy, review, fileTarget, onClose, onPrompt, pluginPanels)}
            </div>

            {!last && (
              <Splitter
                axis="y"
                value={layout.panelHeight(id)}
                min={PANEL_HEIGHT_MIN}
                max={PANEL_HEIGHT_MAX}
                onChange={height => layout.setPanelHeight(id, height)}
                label={`Hauteur du panneau ${panelLabel(id, pluginPanels)}`}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

function renderPanel(
  id: PanelId,
  sessionId: string | null,
  workspace: string,
  entries: ThreadEntry[],
  busy: boolean,
  review: ReviewApi,
  fileTarget: { path: string } | null,
  onClose: (id: PanelId) => void,
  onPrompt: (text: string) => void,
  pluginPanels: readonly PluginPanelManifest[],
): React.ReactNode {
  if (id.startsWith('module:')) return <NativePanel id={id.slice(7)} workspace={workspace} onClose={() => onClose(id)} />
  if (id.startsWith('plugin:')) {
    const manifest = pluginPanels.find(panel => id === `plugin:${panel.id}`)
    return manifest ? <PluginPanel manifest={manifest} cwd={workspace} onClose={() => onClose(id)} onWork={onPrompt} /> : null
  }
  switch (id) {
    case 'browser':
      return <BrowserPanel key={`${sessionId}:${workspace}`} sessionId={sessionId} workspace={workspace} onClose={() => onClose('browser')} />
    case 'plan':
      return <PlanPanel entries={entries} onClose={() => onClose('plan')} />
    case 'agents':
      return <AgentsPanel entries={entries} onClose={() => onClose('agents')} />
    case 'files':
      return (
        <FilesPanel
          sessionId={sessionId}
          root={workspace}
          target={fileTarget}
          onClose={() => onClose('files')}
        />
      )
    case 'terminal':
      return <TerminalPanel cwd={workspace} onClose={() => onClose('terminal')} />
    case 'changes':
      return (
        <ChangesPanel
          cwd={workspace}
          entries={entries}
          busy={busy}
          review={review}
          onClose={() => onClose('changes')}
        />
      )
  }
}
