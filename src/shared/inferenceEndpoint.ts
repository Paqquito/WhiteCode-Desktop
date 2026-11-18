/** Inference must target an explicitly configured server, never the SDK default. */
export function requireInferenceEndpoint(value: string | undefined): string {
  if (!value?.trim()) throw new Error('Configurez une adresse de serveur d’inférence.')
  const url = new URL(value)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Le serveur d’inférence doit utiliser HTTP ou HTTPS.')
  }
  if (['anthropic.com', 'claude.ai'].some(domain => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error('Le fournisseur Anthropic a été supprimé. Choisissez votre serveur d’inférence.')
  }
  return value.trim().replace(/\/+$/, '')
}
