/**
 * En-tête de la conversation.
 *
 * Porte l'identité de la session à gauche et les bascules de panneaux à
 * droite. Les bascules vivent ici plutôt que dans les panneaux eux-mêmes :
 * un panneau fermé ne peut pas offrir le bouton qui le rouvre.
 */

import type { SessionOrigin } from '../../shared/sessionOrigin.js'
import { RoutineOrigin } from './RoutineOrigin.js'

import { nativeId, nativePanels } from '../nativeViews.js'
import * as React from 'react'
import { panelLabel, type BuiltinPanelId, type PanelId } from '../state/usePanels.js'
import type { PluginPanelManifest } from '../../shared/pluginPanel.js'
import { SessionMenu } from './SessionMenu.js'
import { Icon, type IconName } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'

export type ConversationActions = {
  newConversation: () => void
  chooseFolder: () => void
  worktree: () => void
  routines: () => void
  toggleSplit: () => void
  splitPending: boolean
}

const TOOL_PANELS: BuiltinPanelId[] = ['files', 'terminal', 'changes', 'browser', 'plan', 'agents']
const PANEL_ICONS: Record<BuiltinPanelId, IconName> = { files: 'folder', terminal: 'terminal', changes: 'diff', browser: 'globe', plan: 'list', agents: 'brain' }

export function TopBar({
  title,
  chat = false,
  sessionActions,
  split = false,
  origin,
  project,
  sidebarHidden,
  onShowSidebar,
  isPanelOpen,
  onTogglePanel,
  onOpenRestore,
  onOpenConnections,
  pluginPanels = [],
}: {
  title: string
  chat?: boolean
  sessionActions?: ConversationActions
  split?: boolean
  origin?: SessionOrigin
  project: string
  sidebarHidden: boolean
  onShowSidebar: () => void
  isPanelOpen: (id: PanelId) => boolean
  onTogglePanel: (id: PanelId) => void
  onOpenRestore: () => void
  onOpenConnections: () => void
  pluginPanels?: readonly PluginPanelManifest[]
}): React.ReactNode {
  const trigger = React.useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)
  const closeMenu = React.useCallback(() => { setMenu(null); trigger.current?.focus({ preventScroll: true }) }, [])
  const panelTrigger = React.useRef<HTMLButtonElement>(null)
  const [panelMenu, setPanelMenu] = React.useState<{ x: number; y: number } | null>(null)
  const closePanelMenu = React.useCallback(() => { setPanelMenu(null); panelTrigger.current?.focus({ preventScroll: true }) }, [])
  const allPanels: PanelId[] = [...TOOL_PANELS.filter(id => !chat || id !== 'changes'), ...nativePanels.map(entry => nativeId(entry.id)), ...pluginPanels.map(panel => `plugin:${panel.id}` as const)]
  const count = allPanels.filter(isPanelOpen).length
  return (
    <header className="topbar">
      {sidebarHidden && (
        <IconButton icon="sidebar" onClick={onShowSidebar} title="Afficher le panneau" label="Afficher le panneau latéral" />
      )}

      <span className="topbar-title" title={title}>{title}</span>
      {sessionActions && <>
        <button ref={trigger} type="button" className="icon-button" aria-label="Actions de la conversation"
          aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={() => {
            const rect = trigger.current!.getBoundingClientRect()
            setMenu(menu ? null : { x: rect.left, y: rect.bottom + 6 })
          }}><Icon name="more" /></button>
        {menu && <SessionMenu at={menu} onClose={closeMenu} anchor={trigger} groups={[
          [{ label: 'Nouvelle conversation', onClick: sessionActions.newConversation }],
          ...(chat ? [] : [[{ label: 'Choisir un autre dossier…', onClick: sessionActions.chooseFolder },
           { label: 'Travailler dans une copie Git…', onClick: sessionActions.worktree },
           { label: 'Routines du projet…', onClick: sessionActions.routines }]]),
          [{ label: split ? 'Revenir à une conversation' : 'Afficher une seconde conversation',
             disabled: sessionActions.splitPending ? 'Ouverture en cours' : undefined, onClick: sessionActions.toggleSplit },
           { label: 'Points de restauration…', onClick: onOpenRestore }],
        ]} />}
      </>}
      {project && !sessionActions && <span className="topbar-chip">{project}</span>}

      <RoutineOrigin origin={origin} detailed />

      <div className="topbar-actions">
        {!sessionActions && <IconButton icon="history" onClick={onOpenRestore} title="Points de restauration des fichiers" />}
        <button ref={panelTrigger} type="button" className={`topbar-menu-trigger${count ? ' active' : ''}`}
            aria-haspopup="menu" aria-expanded={Boolean(panelMenu)}
            aria-label={`Panneaux${count ? ` (${count} ouvert${count > 1 ? 's' : ''})` : ''}`}
            title={count ? `${count} panneau${count > 1 ? 'x' : ''} ouvert${count > 1 ? 's' : ''}` : 'Ouvrir un panneau'}
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              setMenu(null)
              setPanelMenu(panelMenu ? null : { x: rect.left, y: rect.bottom + 6 })
            }}>
            <Icon name="options" size={14} />Panneaux{count > 0 && <span className="topbar-menu-count" aria-hidden="true">{count}</span>}<Icon name="chevron-down" size={12} />
          </button>
        <button type="button" className="topbar-menu-trigger" aria-label="Connecteurs" title="Les services que l’IA peut consulter" onClick={() => { setPanelMenu(null); setMenu(null); onOpenConnections() }}><Icon name="plugin" size={14} />Connecteurs</button>
        {panelMenu && <SessionMenu at={panelMenu} onClose={closePanelMenu} anchor={panelTrigger} groups={[allPanels.map(id => ({
          label: panelLabel(id, pluginPanels), icon: (id.startsWith('plugin:') || id.startsWith('module:')) ? 'extension' : PANEL_ICONS[id as BuiltinPanelId], checked: isPanelOpen(id), onClick: () => onTogglePanel(id),
        }))]} />}
      </div>
    </header>
  )
}
