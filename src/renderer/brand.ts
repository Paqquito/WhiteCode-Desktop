/**
 * Marque de l'application, figée au build depuis le fichier d'identité.
 *
 * Hors build (tests), la marque blanche neutre s'applique.
 */
type Brand = { product: string; color: string; scheme: string }
declare const __BRAND__: Brand | undefined

export const BRAND: Brand =
  typeof __BRAND__ !== 'undefined' ? __BRAND__ : { product: 'WhiteCode', color: '#000000', scheme: 'whitecode-desktop' }

const NEUTRAL = '#000000'

/** Mix a color with white (`amount` of white, 0 to 1). */
function lighten([r, g, b]: number[], amount: number): string {
  const mix = (value: number) => Math.round(value + (255 - value) * amount)
  return `rgb(${mix(r!)}, ${mix(g!)}, ${mix(b!)})`
}

/**
 * Une couleur de marque autre que le noir neutre remplace l'accent : telle
 * quelle en thème clair, éclaircie en thème sombre pour rester lisible.
 */
export function applyBrand(doc: Document = document): void {
  const color = BRAND.color.toLowerCase()
  if (!/^#[0-9a-f]{6}$/.test(color) || color === NEUTRAL) return
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16))
  const [r, g, b] = rgb
  const style = doc.createElement('style')
  style.dataset.brand = ''
  style.textContent = `:root:not([data-theme="dark"]) { --accent: ${color}; --accent-hover: rgb(${Math.round(r! * 0.8)}, ${Math.round(g! * 0.8)}, ${Math.round(b! * 0.8)}); --accent-soft: rgba(${r}, ${g}, ${b}, 0.1); --accent-ring: rgba(${r}, ${g}, ${b}, 0.2); }
:root[data-theme="dark"] { --accent: ${lighten(rgb, 0.55)}; --accent-hover: ${lighten(rgb, 0.7)}; --accent-soft: rgba(${r}, ${g}, ${b}, 0.25); --accent-ring: rgba(${r}, ${g}, ${b}, 0.35); }`
  doc.head.appendChild(style)
}
