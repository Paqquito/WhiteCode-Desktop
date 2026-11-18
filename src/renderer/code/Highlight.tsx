/**
 * Coloration syntaxique.
 *
 * `lowlight` enveloppe highlight.js et rend un **arbre de nœuds** au lieu
 * d'une chaîne HTML. C'est ce qui permet de le rendre par React : le code
 * affiché vient de fichiers et de réponses de modèle, et rien de tout cela ne
 * doit pouvoir devenir du balisage. Une bibliothèque qui rend du HTML
 * imposerait `dangerouslySetInnerHTML`, c'est-à-dire exactement le contraire.
 *
 * Le jeu chargé est `common` : une quarantaine de langages, ceux qu'on croise
 * réellement. Le jeu complet en compte près de 200 et pèserait plusieurs
 * centaines de kilo-octets pour du COBOL que personne n'ouvrira.
 */

import { common, createLowlight } from 'lowlight'
import * as React from 'react'

const lowlight = createLowlight(common)

/** Extensions vers noms de langage, pour l'explorateur de fichiers. */
const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonl: 'json',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  php: 'php',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  sql: 'sql',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  md: 'markdown',
  markdown: 'markdown',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  diff: 'diff',
  patch: 'diff',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  pl: 'perl',
  ex: 'elixir',
  exs: 'elixir',
}

/**
 * Devine le langage d'un fichier.
 *
 * L'extension d'abord, le nom ensuite : `Dockerfile` et `Makefile` n'en ont
 * pas, et ce sont précisément des fichiers qu'on ouvre souvent.
 */
export function languageOf(path: string): string | null {
  const name = (path.split(/[\\/]/).pop() ?? '').toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot > 0) {
    const found = BY_EXTENSION[name.slice(dot + 1)]
    if (found) return found
  }
  const bare = BY_EXTENSION[name]
  return bare ?? null
}

/** Vrai si highlight.js connaît ce nom — sinon il lèverait. */
export function isSupported(language: string): boolean {
  return lowlight.registered(language)
}

/**
 * Nœud d'arbre rendu par lowlight.
 *
 * Redéclaré ici plutôt qu'importé de `hast` : seuls trois cas nous
 * intéressent, et la dépendance de types complète n'apporterait rien.
 */
type HastNode =
  | { type: 'text'; value: string }
  | {
      type: 'element'
      tagName: string
      properties?: { className?: string[] | string }
      children: HastNode[]
    }
  | { type: string; [key: string]: unknown }

/**
 * Code coloré.
 *
 * `language` absent ou inconnu : le texte est rendu tel quel. Deviner le
 * langage automatiquement produit trop d'erreurs sur les extraits courts, et
 * une coloration fausse trompe plus qu'elle n'aide.
 */
export function Highlight({
  code,
  language,
}: {
  code: string
  language?: string | null
}): React.ReactNode {
  const tree = React.useMemo(() => {
    if (!language || !lowlight.registered(language)) return null
    try {
      return lowlight.highlight(language, code) as unknown as HastNode
    } catch {
      // Grammaire en défaut sur une entrée inhabituelle : le texte brut reste
      // lisible, ce qui vaut mieux qu'un bloc vide.
      return null
    }
  }, [code, language])

  if (!tree) return <>{code}</>
  return <>{renderChildren((tree as { children: HastNode[] }).children)}</>
}

function renderChildren(nodes: HastNode[]): React.ReactNode {
  return nodes.map((node, index) => <HastView key={index} node={node} />)
}

function HastView({ node }: { node: HastNode }): React.ReactNode {
  if (node.type === 'text') {
    return <>{(node as { value: string }).value}</>
  }
  if (node.type !== 'element') return null

  const element = node as Extract<HastNode, { type: 'element' }>
  const raw = element.properties?.className
  const className = Array.isArray(raw) ? raw.join(' ') : raw

  // Toujours un `span` : highlight.js n'émet que cela, et forcer la balise
  // ferme la porte à toute surprise si une grammaire en émettait une autre.
  return (
    <span className={className}>{renderChildren(element.children)}</span>
  )
}
