import type { ComponentType } from 'react'

export type ModuleCall = (method: string, input?: unknown) => Promise<unknown>

export interface ModuleHost {
  /** Private directory in the current distribution's Electron profile. */
  directory: string
  registerIpc(method: string, handler: (input: unknown) => Promise<unknown>): void
}

export interface ModuleViewProps {
  call: ModuleCall
}
export interface ModulePanelProps extends ModuleViewProps {
  sessionId: string | null
  onPrompt(text: string): void
  workspace: string
  onClose(): void
}
export interface ModuleViews {
  label: string
  Settings?: ComponentType<ModuleViewProps>
  Panel?: ComponentType<ModulePanelProps>
}
