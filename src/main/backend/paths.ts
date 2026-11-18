import { join } from 'node:path'

/** Desktop-owned metadata, separate from the engine's own project configuration (its `PROJECT_DIR`). */
let folder = '.desktop'
/** Called once at startup with a name derived from the distribution identity. */
export function configureProjectDataDirectory(name: string): void {
  if (!/^\.[a-z][a-z0-9-]{1,63}$/.test(name)) throw new Error('Dossier de données de projet invalide.')
  folder = name
}
export const projectDataDirectory = (cwd: string): string => join(cwd, folder)
