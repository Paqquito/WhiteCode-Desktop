import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Deterministic model fixtures must not answer autonomous memory-extraction requests. */
export function testConfig(directory: string): string {
  mkdirSync(directory, { recursive: true })
  try {
    writeFileSync(join(directory, 'config.json'), JSON.stringify({ thinking: { enabled: false }, memory: { automatic: { enabled: false }, autoExtraction: { enabled: false }, session: { enabled: false }, recall: { enabled: false }, consolidationEnabled: false } }), { flag: 'wx' })
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
  return directory
}
