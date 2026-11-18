import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Desktop application folder (with `dist/distribution.json`) and engine folder, as used by integration tests. */
export const APP_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const ENGINE_ROOT = resolve(process.env.DESKTOP_ENGINE_DIR ?? resolve(APP_ROOT, '..', 'WhiteCode'))
export const TEST_ROOTS = { appRoot: APP_ROOT, engineRoot: ENGINE_ROOT }
/** Plugin catalogue repository (`DESKTOP_EXTENSIONS_DIR`, or the sibling `WhiteCode-Extensions`). */
export const EXTENSIONS_ROOT = resolve(process.env.DESKTOP_EXTENSIONS_DIR ?? resolve(APP_ROOT, '..', 'WhiteCode-Extensions'))
