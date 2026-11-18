/**
 * Sélecteur de fichier de la mention « @ ».
 *
 * S'ouvre dès qu'un « @ » est tapé et se referme au choix, à l'échappement ou
 * quand la mention cesse d'en être une. Le chemin inséré est **relatif** à
 * l'espace de travail : c'est ce que le modèle comprend le mieux, et c'est
 * aussi ce qui reste lisible dans le fil.
 *
 * La navigation se fait au clavier sans quitter la frappe — flèches, Entrée,
 * Tabulation. Un sélecteur qui oblige à viser à la souris au milieu d'une
 * phrase coûte plus de temps qu'il n'en fait gagner.
 */

import * as React from 'react'
import { Icon } from '../ui/Icon.js'

export type MentionEntry = {
  path: string
  relative: string
  kind: 'file' | 'dir'
}

export function MentionPicker({
  entries,
  active,
  onPick,
  onHover,
}: {
  entries: MentionEntry[]
  /** Indice surligné, piloté par le composeur pour rester sous le clavier. */
  active: number
  onPick: (entry: MentionEntry) => void
  onHover: (index: number) => void
}): React.ReactNode {
  const listRef = React.useRef<HTMLDivElement>(null)

  // Garde l'entrée courante visible quand on descend au clavier : sans cela,
  // la sélection sort du cadre au bout de sept lignes.
  React.useEffect(() => {
    const node = listRef.current?.children[active] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (entries.length === 0) {
    return (
      <div className="mention-picker">
        <p className="mention-empty">Aucun fichier ne correspond.</p>
      </div>
    )
  }

  return (
    <div className="mention-picker" ref={listRef} role="listbox">
      {entries.map((entry, index) => (
        <button
          key={entry.path}
          type="button"
          role="option"
          aria-selected={index === active}
          className={index === active ? 'mention-row active' : 'mention-row'}
          // `mousedown` et non `click` : le clic ferait perdre le focus au
          // champ de saisie avant l'insertion, et le curseur sauterait.
          onMouseDown={event => {
            event.preventDefault()
            onPick(entry)
          }}
          onMouseEnter={() => onHover(index)}
        >
          <Icon
            name={entry.kind === 'dir' ? 'folder' : 'file'}
            size={13}
            className={entry.kind === 'dir' ? 'mention-dir' : 'mention-file'}
          />
          <span className="mention-name">{entry.relative}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Repère une mention en cours de frappe.
 *
 * Cherche le dernier « @ » avant le curseur, et ne le retient que s'il ouvre
 * bien une mention : en début de mot, et sans espace depuis. Une adresse de
 * courriel ou un « @ » au milieu d'un identifiant ne doit pas déclencher le
 * sélecteur.
 */
export function findMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf('@')
  if (at === -1) return null

  // Précédé d'un caractère de mot : c'est une adresse ou un décorateur.
  const previous = at > 0 ? before[at - 1] : ' '
  if (previous && !/[\s(\[{,;]/.test(previous)) return null

  const query = before.slice(at + 1)
  // Un espace clôt la mention : on ne cherche pas un chemin sur deux mots.
  if (/\s/.test(query)) return null
  return { start: at, query }
}

/**
 * Commandes du moteur, proposées dès la barre oblique.
 *
 * La liste vient du moteur, qui l'annonce à l'initialisation : elle contient
 * donc aussi ce qu'apportent les extensions chargées. Écrire les noms en dur
 * ici afficherait des commandes absentes, et tairait celles d'un plugin
 * installé la veille.
 */
export function CommandPicker({
  names,
  active,
  onPick,
  onHover,
}: {
  names: string[]
  active: number
  onPick: (name: string) => void
  onHover: (index: number) => void
}): React.ReactNode {
  const listRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const node = listRef.current?.children[active] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div className="mention-picker command-picker" ref={listRef} role="listbox">
      {names.map((name, index) => (
        <button
          key={name}
          type="button"
          role="option"
          aria-selected={index === active}
          className={index === active ? 'mention active' : 'mention'}
          onMouseEnter={() => onHover(index)}
          // `onMouseDown` et non `onClick` : le clic ferait d'abord perdre le
          // focus à la zone de saisie, ce qui referme la liste avant que le
          // choix ne soit pris en compte.
          onMouseDown={event => {
            event.preventDefault()
            onPick(name)
          }}
        >
          <Icon name="terminal" size={13} className="mention-file" />
          <span className="mention-path">/{name}</span>
        </button>
      ))}
    </div>
  )
}
