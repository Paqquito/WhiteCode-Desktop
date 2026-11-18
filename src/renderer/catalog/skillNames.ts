/** Collapse packaging mirrors for presentation; leave the engine inventory unchanged. */
export function skillNames(paths: string[]): string[] {
  return [...new Set(paths.map(path => path.replace(/\\/g, '/').replace(/^\.\//, '')
    .replace(/^(?:\.(?:openclaw|claude|codex|agents)\/)?skills\//, '')
    .replace(/\/SKILL\.md$/, '')))].sort((a, b) => a.localeCompare(b))
}
