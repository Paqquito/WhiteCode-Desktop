/** Paths in plugin manifests only address own data properties. */
export function isDataPath(path: unknown): path is string {
  return typeof path === 'string' && /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,8}$/.test(path)
    && !path.split('.').some(key => ['__proto__', 'constructor', 'prototype'].includes(key))
}

export function pick(value: unknown, path: string | undefined): unknown {
  if (!isDataPath(path)) return undefined
  return path.split('.').reduce<unknown>((current, key) => current !== null && typeof current === 'object' && Object.hasOwn(current, key)
    ? (current as Record<string, unknown>)[key] : undefined, value)
}

export function place(target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  if (!isDataPath(path)) throw new Error('Chemin de données invalide.')
  const [head, ...rest] = path.split('.')
  const current = Object.hasOwn(target, head!) ? target[head!] : undefined
  if (rest.length) target[head!] = place(current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {}, rest.join('.'), value)
  else target[head!] = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current)
    ? { ...current, ...value } : value
  return target
}
