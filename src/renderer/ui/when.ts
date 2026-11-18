/**
 * Date lisible, relative au jour présent : « aujourd'hui à 9 h »,
 * « demain à 14 h 30 », « hier à 18 h », « lundi à 9 h », « 23 oct. à 9 h ».
 *
 * Un horodatage complet (« 23/10/2026 09:00:00 ») oblige à calculer de tête
 * de quel jour il s'agit ; l'échéance d'une routine se lit en un regard.
 * Le texte complet reste disponible en infobulle via `fullDate`.
 */

const DAY = 86_400_000

export function when(timestamp: number, now = Date.now()): string {
  const date = new Date(timestamp)
  const startOf = (value: number) => { const d = new Date(value); d.setHours(0, 0, 0, 0); return d.getTime() }
  const days = Math.round((startOf(timestamp) - startOf(now)) / DAY)
  const hour = `${date.getHours()} h${date.getMinutes() ? ` ${String(date.getMinutes()).padStart(2, '0')}` : ''}`
  const day = days === 0 ? 'aujourd’hui'
    : days === 1 ? 'demain'
    : days === -1 ? 'hier'
    : days > 1 && days < 7 ? date.toLocaleDateString('fr-FR', { weekday: 'long' })
    : date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) })
  return `${day} à ${hour}`
}

export function fullDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
}
