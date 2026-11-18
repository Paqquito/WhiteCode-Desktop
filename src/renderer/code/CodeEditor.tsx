/**
 * Éditeur de code colorié.
 *
 * ## Le problème
 *
 * Un `<textarea>` ne sait pas colorer son contenu, et un bloc colorié ne sait
 * pas se laisser éditer. Basculer de l'un à l'autre — ce que faisait la version
 * précédente — perd la coloration dès qu'on veut corriger une ligne, c'est-à-dire
 * exactement au moment où elle sert le plus.
 *
 * ## La solution
 *
 * Les deux sont superposés. Le texte colorié est dessiné dessous ; la zone de
 * saisie est posée par-dessus, **transparente**, avec seulement son curseur et
 * sa sélection visibles. On tape dans la seconde, on lit la première.
 *
 * Cela n'est fiable qu'à une condition : les deux couches doivent partager
 * **exactement** les mêmes métriques — police, taille, interligne, marges,
 * césure. Le moindre écart désaligne le curseur du texte, et l'illusion se
 * défait dès la troisième ligne. C'est pourquoi ces valeurs sont déclarées une
 * seule fois, en CSS, sur un sélecteur commun aux deux couches.
 */

import * as React from 'react'
import { Highlight } from './Highlight.js'

export function CodeEditor({
  value,
  language,
  readOnly = false,
  onChange,
  onSave,
}: {
  value: string
  language: string | null
  readOnly?: boolean
  onChange: (next: string) => void
  onSave: () => void
}): React.ReactNode {
  const areaRef = React.useRef<HTMLTextAreaElement>(null)
  const backdropRef = React.useRef<HTMLPreElement>(null)

  /**
   * Le fond suit le défilement de la saisie.
   *
   * Sans cela, dès qu'on descend dans un fichier long, le texte colorié reste
   * en haut pendant que le curseur descend : les deux couches se séparent.
   */
  const syncScroll = React.useCallback(() => {
    const area = areaRef.current
    const backdrop = backdropRef.current
    if (!area || !backdrop) return
    backdrop.scrollTop = area.scrollTop
    backdrop.scrollLeft = area.scrollLeft
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 's' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onSave()
      return
    }

    // Tabulation : insère une indentation au lieu de quitter le champ. Dans un
    // éditeur, sortir de la zone de saisie sur Tab est le comportement le moins
    // attendu qui soit.
    if (event.key === 'Tab') {
      event.preventDefault()
      const area = event.currentTarget
      const { selectionStart, selectionEnd } = area
      const next =
        value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd)
      onChange(next)
      requestAnimationFrame(() => {
        area.selectionStart = area.selectionEnd = selectionStart + 2
      })
    }
  }

  return (
    <div className="code-editor">
      {/* `aria-hidden` : le contenu réel est celui de la zone de saisie ; le
          fond n'en est qu'un calque décoratif, qu'un lecteur d'écran lirait
          en double. */}
      <pre className="code-layer hljs" ref={backdropRef} aria-hidden="true">
        <code>
          <Highlight code={value} language={language} />
          {/* Saut final : sans lui, une dernière ligne vide n'est pas rendue
              par le fond alors que la saisie la compte, et le décalage se
              propage vers le haut au défilement. */}
          {'\n'}
        </code>
      </pre>

      <textarea
        ref={areaRef}
        className="code-layer code-input"
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        wrap="off"
        onChange={event => onChange(event.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
