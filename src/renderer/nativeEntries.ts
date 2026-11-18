import type { ModuleViews } from '../../packages/desktop-modules/index.js'
/** Standalone renderer tests and the base distribution have no native modules. */
export const nativeEntries: { id: string; views: ModuleViews }[] = []
