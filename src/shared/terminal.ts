/** Public target catalogue. Native launch arguments never cross into the renderer. */
export type TerminalTarget = { id: string; label: string; description: string }
export type TerminalTargets = { targets: TerminalTarget[]; reason?: string }

/** Main-process capability, produced by a trusted distribution adapter. */
export type RemoteTerminal = { key: string; file: string; args: string[] }
export type TerminalTargetProvider = {
  list(): Promise<TerminalTargets>
  resolve(id: string): Promise<RemoteTerminal>
}

/** Without a distribution adapter, only local terminals are offered. */
export const LOCAL_TERMINALS_ONLY: TerminalTargetProvider = {
  list: async () => ({ targets: [] }),
  resolve: async () => { throw new Error('Aucune cible de terminal distante n’est configurée.') },
}
