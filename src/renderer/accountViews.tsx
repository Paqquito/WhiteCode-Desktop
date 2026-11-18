import * as React from 'react'
import { Icon } from './ui/Icon.js'

export function AccountGate({ children }: { children: React.ReactNode }) { return <>{children}</> }
export function AccountControls({ onOpenSettings }: { onOpenSettings: () => void }) {
  return <button type="button" className="sidebar-settings" onClick={onOpenSettings}><Icon name="settings" />Paramètres</button>
}
