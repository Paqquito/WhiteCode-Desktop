/**
 * Rendu du Markdown des réponses.
 *
 * L'arbre vient de `markdown.ts` ; ici, on ne fait que le traduire en
 * éléments React. Aucun HTML n'est injecté : le texte du modèle reste du
 * texte, quoi qu'il contienne.
 *
 * Recalculé à chaque fragment pendant la diffusion, d'où la mémoïsation : le
 * texte d'une longue réponse est réanalysé des dizaines de fois par seconde
 * sinon.
 */

import * as React from 'react'
import { Highlight } from '../code/Highlight.js'
import type { Block, Inline } from './markdownModel.js'
import { LinkedText } from './fileLink.js'
import { parseMarkdown } from './markdownModel.js'

export function Markdown({ text }: { text: string }): React.ReactNode {
  const blocks = React.useMemo(() => parseMarkdown(text), [text])
  return (
    <div className="md">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  )
}

function BlockView({ block }: { block: Block }): React.ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <p>
          <InlineView parts={block.content} />
        </p>
      )

    case 'heading': {
      // Les niveaux profonds retombent sur `h4` : au-delà, la hiérarchie
      // visuelle ne se distingue plus et n'apporte rien dans un fil.
      const Tag = (`h${Math.min(block.level, 4)}`) as 'h1' | 'h2' | 'h3' | 'h4'
      return (
        <Tag>
          <InlineView parts={block.content} />
        </Tag>
      )
    }

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul'
      return (
        <Tag>
          {block.items.map((item, index) => (
            <li key={index}>
              <InlineView parts={item} />
            </li>
          ))}
        </Tag>
      )
    }

    case 'quote':
      return (
        <blockquote>
          <InlineView parts={block.content} />
        </blockquote>
      )

    case 'code':
      return (
        <pre className="md-code hljs">
          {block.lang && <span className="md-lang">{block.lang}</span>}
          <code>
            <Highlight code={block.text} language={block.lang} />
          </code>
        </pre>
      )

    case 'table':
      return (
        // Le tableau défile dans son propre cadre : une réponse qui en
        // contient un large ne doit pas élargir toute la conversation.
        <div className="md-table-wrap">
          <table>
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index}>
                    <InlineView parts={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <InlineView parts={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    case 'rule':
      return <hr />
  }
}

function InlineView({ parts }: { parts: Inline[] }): React.ReactNode {
  return (
    <>
      {parts.map((part, index) => {
        switch (part.type) {
          case 'strong':
            return <strong key={index}>{part.text}</strong>
          case 'em':
            return <em key={index}>{part.text}</em>
          case 'code':
            // Le code en ligne porte très souvent un nom de fichier : c'est là
            // qu'un chemin cliquable sert le plus.
            return (
              <code key={index}>
                <LinkedText text={part.text} />
              </code>
            )
          case 'link':
            // Affiché comme un lien, mais inerte : la fenêtre n'a aucun accès
            // au réseau, et ouvrir un navigateur sur une adresse écrite par un
            // modèle demanderait un arbitrage qui n'existe pas encore.
            return (
              <span key={index} className="md-link" title={part.href}>
                {part.text}
              </span>
            )
          case 'text':
            return <LinkedText key={index} text={part.text} />
        }
      })}
    </>
  )
}
