import type { ModuleHost } from '../../packages/desktop-modules/index.js'
/** Replaced by the bundler when the distribution selects native modules. */
export const nativeEntries: { id: string; register: (host: ModuleHost) => void }[] = []
