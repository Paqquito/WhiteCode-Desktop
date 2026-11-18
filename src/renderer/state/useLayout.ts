/**
 * Agencement des surfaces, mémorisé d'une session à l'autre.
 *
 * L'agencement est un réglage personnel : le refaire à chaque lancement serait
 * une contrariété quotidienne. Il est conservé dans `localStorage` — donnée
 * purement locale à la fenêtre, sans intérêt pour le processus principal.
 *
 * La conversation n'a pas de largeur propre : elle occupe ce que les deux
 * autres colonnes lui laissent. C'est ce qui la garde au centre quoi qu'on
 * fasse des panneaux.
 */

import * as React from 'react'
import type { PanelId } from '#desktop/panel-selection'

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 460
export const PANELS_MIN = 300
export const PANELS_MAX = 900
export const PANEL_HEIGHT_MIN = 120
export const PANEL_HEIGHT_MAX = 1400

/**
 * Largeur en deçà de laquelle la conversation cesse d'être lisible.
 *
 * Les bornes fixes des colonnes latérales ne suffisent pas : sur une fenêtre
 * étroite, une barre au maximum et des panneaux au maximum écrasent le milieu
 * à quelques dizaines de pixels. Les poignées doivent donc se limiter les unes
 * les autres, en fonction de la place réellement disponible.
 */
export const CONVERSATION_MIN = 420

/** Épaisseur cumulée des deux poignées verticales. */
const HANDLES = 10

const KEY = 'desktop:layout'

type Layout = {
  sidebar: number
  panels: number
  /**
   * Hauteur de chaque panneau empilé.
   *
   * Le dernier panneau de la pile n'utilise pas la sienne : il absorbe la
   * place restante. Sans ce dernier extensible, la colonne finirait par
   * laisser un vide en bas dès que les hauteurs ne tombent pas juste.
   */
  heights: Partial<Record<PanelId, number>>
}

const DEFAULTS: Layout = { sidebar: 276, panels: 460, heights: {} }

/** Hauteur d'un panneau auquel on n'a jamais touché. */
export const PANEL_HEIGHT_DEFAULT = 300

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function load(): Layout {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<Layout>
    const heights: Partial<Record<PanelId, number>> = {}
    for (const [id, height] of Object.entries(parsed.heights ?? {})) {
      if (typeof height === 'number') {
        heights[id as PanelId] = clamp(height, PANEL_HEIGHT_MIN, PANEL_HEIGHT_MAX)
      }
    }
    return {
      // Les bornes sont réappliquées à la lecture : une largeur enregistrée
      // sur un grand écran rendrait l'application inutilisable sur un petit.
      sidebar: clamp(parsed.sidebar ?? DEFAULTS.sidebar, SIDEBAR_MIN, SIDEBAR_MAX),
      panels: clamp(parsed.panels ?? DEFAULTS.panels, PANELS_MIN, PANELS_MAX),
      heights,
    }
  } catch {
    return DEFAULTS
  }
}

export function useLayout() {
  const [layout, setLayout] = React.useState<Layout>(load)
  const [viewport, setViewport] = React.useState(() => window.innerWidth)

  React.useEffect(() => {
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  React.useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(layout))
    } catch {
      // Stockage indisponible : l'agencement vaut pour la session en cours.
    }
  }, [layout])

  const setSidebar = React.useCallback(
    (width: number) => setLayout(l => ({ ...l, sidebar: width })),
    [],
  )
  const setPanels = React.useCallback(
    (width: number) => setLayout(l => ({ ...l, panels: width })),
    [],
  )
  const setPanelHeight = React.useCallback(
    (id: PanelId, height: number) =>
      setLayout(l => ({ ...l, heights: { ...l.heights, [id]: height } })),
    [],
  )
  const panelHeight = React.useCallback(
    (id: PanelId) => layout.heights[id] ?? PANEL_HEIGHT_DEFAULT,
    [layout.heights],
  )

  // Maxima effectifs : chaque colonne latérale ne peut prendre que ce que
  // l'autre et la conversation lui laissent. Recalculés à chaque changement de
  // taille de fenêtre, sinon réduire la fenêtre écraserait le milieu.
  const budget = viewport - CONVERSATION_MIN - HANDLES
  const sidebarMax = clamp(budget - layout.panels, SIDEBAR_MIN, SIDEBAR_MAX)
  const panelsMax = clamp(budget - layout.sidebar, PANELS_MIN, PANELS_MAX)

  // La valeur enregistrée est ramenée dans ces bornes à l'affichage plutôt que
  // réécrite : rétrécir la fenêtre un instant ne doit pas effacer un
  // agencement choisi pour un grand écran.
  const sidebar = Math.min(layout.sidebar, sidebarMax)
  const panels = Math.min(layout.panels, panelsMax)

  return {
    ...layout,
    sidebar,
    panels,
    sidebarMax,
    panelsMax,
    setSidebar,
    setPanels,
    setPanelHeight,
    panelHeight,
  }
}
