/**
 * Chemins cliquables dans la conversation.
 *
 * Un chemin mentionné dans un message — inséré par « @ » ou écrit à la main —
 * devient un lien vers l'explorateur. C'est la contrepartie utile de la
 * mention : désigner un fichier au modèle, puis pouvoir y retourner d'un clic
 * en relisant l'échange, sans le chercher dans l'arborescence.
 *
 * Passé par contexte plutôt qu'en propriété : le rendu du Markdown est
 * récursif sur cinq niveaux, et faire descendre un rappel à travers chacun
 * encombrerait toutes les signatures pour un seul usage terminal.
 */

import * as React from 'react'

export type FileLinkHandler = ((relative: string) => void) | null

export const FileLinkContext = React.createContext<FileLinkHandler>(null)

/** Extensions reconnues pour un nom de fichier sans dossier. */
const EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl', 'md', 'py',
  'rs', 'go', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'rb', 'php', 'sh',
  'bash', 'ps1', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'css', 'scss',
  'html', 'xml', 'sql', 'txt', 'ipynb', 'lock', 'env', 'csv',
].join('|')

/**
 * Reconnaît un chemin de fichier dans du texte ordinaire.
 *
 * Les chemins absolus prennent la priorité, y compris le lecteur Windows,
 * les accents et les espaces. Un nom seul exige une extension connue.
 */
const PATH = new RegExp(
  [
    String.raw`(?:[A-Za-z]:[\\/]|\\\\)(?:[^\r\n<>:"|?*\\/]+[\\/])*?[^\r\n<>:"|?*\\/]+?\.[A-Za-z0-9]{1,8}(?![\p{L}\p{M}\p{N}_.\\/])`,
    String.raw`(?<![\w:/])/(?:[\p{L}\p{M}\p{N}_.@+() -]+/)*[\p{L}\p{M}\p{N}_.@+() -]+?\.[A-Za-z0-9]{1,8}(?![\p{L}\p{M}\p{N}_.\/])`,
    String.raw`(?:[\p{L}\p{M}\p{N}_.@+-]+[\\/])+[\p{L}\p{M}\p{N}_.@+-]+\.[A-Za-z0-9]{1,8}`,
    String.raw`(?<![\p{L}\p{M}\p{N}_])[\p{L}\p{M}\p{N}_@+-]+\.(?:${EXTENSIONS})\b`,
  ].join('|'),
  'gu',
)

/** Découpe un texte en segments, les chemins isolés des mots ordinaires. */
export function splitPaths(text: string): Array<{ text: string; path: boolean }> {
  const out: Array<{ text: string; path: boolean }> = []
  let last = 0
  PATH.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = PATH.exec(text)) !== null) {
    if (match.index > last) {
      out.push({ text: text.slice(last, match.index), path: false })
    }
    out.push({ text: match[0], path: true })
    last = match.index + match[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), path: false })
  return out
}

/** Texte ordinaire, dont les chemins deviennent cliquables. */
export function LinkedText({ text }: { text: string }): React.ReactNode {
  const open = React.useContext(FileLinkContext)
  if (!open) return <>{text}</>

  const parts = splitPaths(text)
  // Rien à décorer : on rend le texte tel quel plutôt qu'un fragment par
  // segment, ce qui évite des milliers de nœuds inutiles sur une longue
  // réponse.
  if (parts.length === 1 && !parts[0]!.path) return <>{text}</>

  return (
    <>
      {parts.map((part, index) =>
        part.path ? (
          <button
            key={index}
            type="button"
            className="file-link"
            title={`Ouvrir ${part.text} dans l’explorateur`}
            onClick={() => open(part.text)}
          >
            {/^(?:[A-Za-z]:[\\/]|[/\\])/.test(part.text) ? part.text.split(/[\\/]/).at(-1) : part.text}
          </button>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ),
      )}
    </>
  )
}
