/**
 * Jeu d'icônes.
 *
 * Tracées en SVG inline plutôt que chargées depuis une police ou des
 * fichiers : elles héritent ainsi de `currentColor` et suivent l'état de leur
 * conteneur (survol, actif, désactivé) sans qu'on ait à gérer de variantes.
 *
 * Toutes sur une grille de 16, trait de 1.5 : un jeu cohérent tient plus à
 * l'uniformité du trait qu'au dessin de chaque glyphe.
 */

import * as React from 'react'

export type IconName =
  | 'logout'
  | 'sun'
  | 'bell'
  | 'lightning'
  | 'plugin'
  | 'options'
  | 'brain'
  | 'database'
  | 'extension'
  | 'server-cog'
  | 'globe'
  | 'chat'
  | 'code'
  | 'plus'
  | 'sidebar'
  | 'folder'
  | 'folder-open'
  | 'file'
  | 'terminal'
  | 'diff'
  | 'branch'
  | 'search'
  | 'chevron-right'
  | 'chevron-down'
  | 'close'
  | 'refresh'
  | 'settings'
  | 'stop'
  | 'send'
  | 'sparkle'
  | 'check'
  | 'list'
  | 'comment'
  | 'edit'
  | 'copy'
  | 'save'
  | 'history'
  | 'pin'
  | 'more'
  | 'archive'
  | 'ticket'

const PATHS: Record<IconName, React.ReactNode> = {
  logout: <path d="M6 2H2v12h4M6 8h8m-3-3 3 3-3 3" />,
  sun: <><circle cx="8" cy="8" r="3"/><path d="M8 1v1m0 12v1M1 8h1m12 0h1M3 3l1 1m8 8 1 1M3 13l1-1m8-8 1-1"/></>,
  bell: <><path d="M3 11h10l-1.5-2V6a3.5 3.5 0 0 0-7 0v3L3 11Zm3.5 2a1.5 1.5 0 0 0 3 0M8 1v1"/></>,
  lightning: <path d="m9 1-7 8h5l-1 6 8-9H9l1-5Z" />,
  plugin: <path d="M5 1v4m6-4v4M3 5h10v2a5 5 0 0 1-10 0V5Zm5 7v3" />,
  options: <><path d="M2 4h12M2 12h12M5 2v4m6 4v4"/></>,
  brain: <><path d="M8 4C8 0 3 1 3 4c-3 0-3 5 0 5-2 3 2 6 5 3V4Zm0 0c0-4 5-3 5 0 3 0 3 5 0 5 2 3-2 6-5 3M3 4l2 1M3 9l2-1m8-4-2 1m2 4-2-1"/></>,
  database: <><ellipse cx="8" cy="3.5" rx="5.5" ry="2"/><path d="M2.5 3.5v9c0 2.7 11 2.7 11 0v-9M2.5 8c0 2.7 11 2.7 11 0"/></>,
  extension: <path d="M2 6h4V4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 0 0 0 4h2v1H2v-5h2a2 2 0 0 0 0-4H2Z" />,
  'server-cog': <><rect x="1.5" y="2" width="13" height="5" rx="1"/><path d="M3.5 4.5h.01M5.5 4.5h.01M6 9H2v5h4M11 8v1m0 5v1m-4-4h1m6 0h1M8 8l1 1m4 4 1 1m0-6-1 1m-4 4-1 1"/><circle cx="11" cy="11.5" r="2.5"/></>,

  globe: <><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="2.5" ry="6"/><path d="M2 8h12"/></>,
  /** Punaise vue de trois quarts : la tête, le corps, la pointe. */
  pin: <path d="M9.5 2.5 13.5 6.5l-2 .6-3 3-.4 2.6-3.8-3.8 2.6-.4 3-3 .6-2Zm-5.2 9.2L2 14" />,
  /** Boîte d'archive : le couvercle, la caisse, la prise. */
  archive: <path d="M2 4.5h12v2H2v-2Zm1 2v6h10v-6M6.5 9h3" />,
  ticket: <path d="M2 4h12v2.5a1.5 1.5 0 0 0 0 3V12H2V9.5a1.5 1.5 0 0 0 0-3V4Zm8 1.5v1m0 1.5v1m0 1.5v1" />,
  /** Trois points : « d'autres actions », sans dire lesquelles. */
  more: <path d="M4 8h.01M8 8h.01M12 8h.01" />,
  chat: <path d="M14 7.5c0 2.8-2.7 5-6 5-.8 0-1.6-.1-2.3-.4L2.5 13.5l1-2.6C2.6 10 2 8.8 2 7.5c0-2.8 2.7-5 6-5s6 2.2 6 5Z" />,
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  sidebar: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6.5 3v10" />
    </>
  ),
  folder: <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h2.2c.4 0 .8.2 1.1.5l.9.9h4.8A1.5 1.5 0 0 1 14 6.9v4.6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-6Z" />,
  'folder-open': <path d="M2 11.5v-6A1.5 1.5 0 0 1 3.5 4h2.2c.4 0 .8.2 1.1.5l.9.9h4.8A1.5 1.5 0 0 1 14 6.9M2 11.5 3.6 7.8a1 1 0 0 1 .9-.6h9.1a.6.6 0 0 1 .6.8l-1.4 3.7a1 1 0 0 1-.9.6H3.4a1.4 1.4 0 0 1-1.4-.8Z" />,
  file: (
    <>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6L9 2Z" />
      <path d="M9 2v3.5a.5.5 0 0 0 .5.5H13" />
    </>
  ),
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M5 6.5 7 8.5l-2 2M9 10.5h2.5" />
    </>
  ),
  diff: <path d="M4.5 2.5v5m-2.5-2.5h5M11.5 10.5h-5M4.5 12.5V13M11.5 3v3.5M11.5 13v.5" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1" />
    </>
  ),

  branch: (
    <>
      <circle cx="4.5" cy="4" r="1.75" />
      <circle cx="4.5" cy="12" r="1.75" />
      <circle cx="11.5" cy="4" r="1.75" />
      <path d="M4.5 5.75v4.5M11.5 5.75v.75a3 3 0 0 1-3 3H6" />
    </>
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.2" />
      <path d="m10.4 10.4 3.1 3.1" />
    </>
  ),
  'chevron-right': <path d="m6.5 4 4 4-4 4" />,
  'chevron-down': <path d="m4 6.5 4 4 4-4" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  refresh: <path d="M13.5 8a5.5 5.5 0 1 1-1.7-4M13.5 2.5V6H10" />,
  history: <path d="M2.5 8a5.5 5.5 0 1 0 1.7-4M2.5 2.5V6H6M8 5.5V8l2 1.5" />,
  // Un engrenage, et non le disque à rayons d'avant : celui-ci se lisait
  // comme un soleil, c'est-à-dire comme un réglage d'apparence, alors qu'il
  // ouvre toute la configuration.
  settings: (
    <>
      <circle cx="8" cy="8" r="2.3" />
      <path d="M8 1.4l.9 1.6a5.6 5.6 0 0 1 1.5.6l1.8-.3.9 1.6-1 1.5a5.6 5.6 0 0 1 0 1.6l1 1.5-.9 1.6-1.8-.3a5.6 5.6 0 0 1-1.5.6L8 14.6l-.9-1.6a5.6 5.6 0 0 1-1.5-.6l-1.8.3-.9-1.6 1-1.5a5.6 5.6 0 0 1 0-1.6l-1-1.5.9-1.6 1.8.3a5.6 5.6 0 0 1 1.5-.6z" />
    </>
  ),
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />,
  send: <path d="M2.5 8h10M8.5 4l4 4-4 4" />,
  sparkle: <path d="M8 2v12M2 8h12M4 4l8 8M12 4l-8 8" />,
  check: <path d="m3 8.5 3.2 3.2L13 5" />,
  list: <path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5M2.8 4.5h.01M2.8 8h.01M2.8 11.5h.01" />,
  comment: (
    <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h8a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 12 11H6.5L3.5 13.5V11H4a1.5 1.5 0 0 1-1.5-1.5v-5Z" />
  ),
  edit: <path d="M11.2 2.8a1.6 1.6 0 0 1 2.3 2.3L5.9 12.6l-3 .7.7-3 7.6-7.5Z" />,
  save: (
    <path d="M3.5 2.5h7L13 5v8a.5.5 0 0 1-.5.5h-9A.5.5 0 0 1 3 13V3a.5.5 0 0 1 .5-.5ZM5.5 2.5v3.5h5V2.5M5.5 13.5V9.5h5v4" />
  ),
}

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}): React.ReactNode {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Décorative : le libellé accessible vient toujours du conteneur.
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
