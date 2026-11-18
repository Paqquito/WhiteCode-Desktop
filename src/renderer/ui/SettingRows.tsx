/**
 * Gabarit des écrans de réglages.
 *
 * Une page : un titre, une phrase qui dit ce qu'on règle ici, puis des
 * groupes de lignes. Une ligne : ce qu'on règle (et son effet) à gauche, le
 * contrôle à droite — la disposition des panneaux de réglages des systèmes,
 * que l'utilisateur connaît déjà. Sous 560 px de panneau, la ligne s'empile.
 *
 * Nés dans les préférences personnelles, ces composants servent maintenant à
 * tous les écrans de réglages : c'est leur raison d'être ici plutôt que près
 * de leur premier usage (voir `Field`).
 */

import * as React from 'react'

export function SettingsPage({ title, lead, actions, className, children }: {
  title: string
  lead?: React.ReactNode
  /** Actions de page (actualiser, ajouter), à droite du titre. */
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}): React.ReactNode {
  return <div className={`settings-body settings-page${className ? ` ${className}` : ''}`}>
    <header className="settings-page-head">
      <div><h3>{title}</h3>{lead && <p>{lead}</p>}</div>
      {actions && <div className="settings-page-actions">{actions}</div>}
    </header>
    {children}
  </div>
}

export function Group({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }): React.ReactNode {
  const id = React.useId()
  return <section className={`setting-group${className ? ` ${className}` : ''}`} aria-labelledby={title ? id : undefined}>
    {title && <h4 id={id}>{title}</h4>}
    <div className="setting-list">{children}</div>
  </section>
}

/*
 * Le `<label>` enveloppe le titre et le contrôle, et rien d'autre : son texte
 * est exactement le nom du réglage, et un clic sur le titre agit sur le
 * contrôle. L'explication est hors du label, rattachée par `aria-describedby`.
 */
export function SwitchRow({ title, hint, checked, disabled, onChange }: { title: string; hint?: React.ReactNode; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }): React.ReactNode {
  const id = React.useId()
  return <div className={disabled ? 'setting-row disabled' : 'setting-row'}>
    <label className="setting-label"><span className="setting-title">{title}</span><input className="switch setting-control" type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={hint ? id : undefined} onChange={e => onChange(e.target.checked)} /></label>
    {hint && <p className="setting-hint" id={id}>{hint}</p>}
  </div>
}

export function SelectRow({ title, hint, value, options, disabled, onChange }: { title: string; hint?: React.ReactNode; value: string; options: Array<[string, string]>; disabled?: boolean; onChange: (value: string) => void }): React.ReactNode {
  const id = React.useId()
  return <div className={disabled ? 'setting-row disabled' : 'setting-row'}>
    <label className="setting-label"><span className="setting-title">{title}</span><select className="setting-control" value={value} disabled={disabled} aria-describedby={hint ? id : undefined} onChange={e => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
    {hint && <p className="setting-hint" id={id}>{hint}</p>}
  </div>
}

/**
 * Ligne libre : titre et explication à gauche, n'importe quel contrôle à
 * droite (boutons, état). Sans `<label>` : le contrôle porte son propre nom.
 */
export function Row({ title, hint, children, className }: { title: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; className?: string }): React.ReactNode {
  return <div className={`setting-row${className ? ` ${className}` : ''}`}>
    <div className="setting-label"><span className="setting-title">{title}</span></div>
    {hint && <div className="setting-hint">{hint}</div>}
    {children && <div className="setting-control setting-actions">{children}</div>}
  </div>
}
