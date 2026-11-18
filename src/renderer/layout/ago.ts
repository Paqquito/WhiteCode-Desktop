/**
 * Ancienneté en langage courant.
 *
 * Partagée par les deux listes de sessions : une même date ne doit pas
 * s'écrire « il y a 3 h » d'un côté et « 15:04 » de l'autre.
 */
export function ago(timestamp: number): string {
  const seconds = Math.max(0, (Date.now() - timestamp) / 1000)
  if (seconds < 60) return "à l'instant"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `il y a ${days} j`
  return new Date(timestamp).toLocaleDateString()
}
