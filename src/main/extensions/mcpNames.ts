/** Même contrat pour le registre et les sessions. */
export const validMcpServerId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(id) && !['constructor', 'prototype'].includes(id)
