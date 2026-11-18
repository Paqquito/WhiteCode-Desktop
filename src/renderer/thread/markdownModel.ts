/**
 * Analyse Markdown, réduite à ce que le modèle écrit réellement.
 *
 * ## Pourquoi pas une bibliothèque
 *
 * Les analyseurs courants produisent une chaîne HTML, qu'il faudrait injecter
 * par `dangerouslySetInnerHTML`. Or le texte affiché ici vient d'un modèle,
 * qui relaie lui-même le contenu de fichiers et de pages web : c'est
 * exactement le genre d'entrée dont on ne veut pas qu'elle devienne du
 * balisage. Produire un arbre de nœuds, rendu ensuite par React, supprime la
 * question — il n'existe aucun chemin par lequel du texte deviendrait une
 * balise.
 *
 * ## Périmètre
 *
 * Titres, listes, citations, tableaux, blocs de code, et en ligne : gras,
 * italique, code, liens. Le reste — notes de bas de page, HTML brut, listes
 * de définitions — s'affiche tel quel, ce qui reste lisible.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; text: string }
  | { type: 'em'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; href: string }

export type Block =
  | { type: 'paragraph'; content: Inline[] }
  | { type: 'heading'; level: number; content: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; content: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' }

/**
 * Découpe en ligne.
 *
 * Une seule expression pour tous les marqueurs, plutôt qu'une passe par
 * marqueur : cela garantit que le premier reconnu gagne, et évite qu'un
 * astérisque à l'intérieur d'un `code` soit pris pour de l'emphase.
 */
const INLINE =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(\[[^\]]*\]\([^)\s]+\))/

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text

  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (!match || match.index === undefined) break

    if (match.index > 0) {
      out.push({ type: 'text', text: rest.slice(0, match.index) })
    }
    const token = match[0]

    if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('**') || token.startsWith('__')) {
      out.push({ type: 'strong', text: token.slice(2, -2) })
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      out.push({
        type: 'link',
        text: token.slice(1, split),
        href: token.slice(split + 2, -1),
      })
    } else {
      out.push({ type: 'em', text: token.slice(1, -1) })
    }

    rest = rest.slice(match.index + token.length)
  }

  if (rest.length > 0) out.push({ type: 'text', text: rest })
  return out
}

/** Découpe une ligne de tableau en cellules, sans les barres de bord. */
function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split('|')
    .map(cell => cell.trim())
}

/** Ligne de séparation d'un tableau : `|---|:--:|`. */
function isTableRule(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []
  let i = 0

  /** Paragraphe en cours d'accumulation. */
  let buffer: string[] = []
  const flush = () => {
    if (buffer.length === 0) return
    blocks.push({ type: 'paragraph', content: parseInline(buffer.join('\n')) })
    buffer = []
  }

  while (i < lines.length) {
    const line = lines[i]!

    // --- Bloc de code -----------------------------------------------------
    // Reconnu en premier : à l'intérieur, aucun autre marqueur ne compte.
    const fence = /^\s*```(.*)$/.exec(line)
    if (fence) {
      flush()
      const lang = fence[1]!.trim()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) {
        body.push(lines[i]!)
        i++
      }
      // Le dernier bloc d'une réponse en cours de diffusion n'a pas encore sa
      // clôture : on l'affiche quand même, sinon le code apparaîtrait d'un
      // coup à la fin du tour.
      i++
      blocks.push({ type: 'code', lang, text: body.join('\n') })
      continue
    }

    // --- Ligne vide -------------------------------------------------------
    if (line.trim() === '') {
      flush()
      i++
      continue
    }

    // --- Titre ------------------------------------------------------------
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        content: parseInline(heading[2]!),
      })
      i++
      continue
    }

    // --- Filet ------------------------------------------------------------
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flush()
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    // --- Tableau ----------------------------------------------------------
    if (line.includes('|') && i + 1 < lines.length && isTableRule(lines[i + 1]!)) {
      flush()
      const head = tableCells(line).map(parseInline)
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) {
        rows.push(tableCells(lines[i]!).map(parseInline))
        i++
      }
      blocks.push({ type: 'table', head, rows })
      continue
    }

    // --- Liste ------------------------------------------------------------
    const bullet = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      const ordered = /\d/.test(bullet[1]!)
      const items: Inline[][] = []
      while (i < lines.length) {
        const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]!)
        if (!item || /\d/.test(item[1]!) !== ordered) break
        // Une entrée peut se poursuivre sur les lignes suivantes tant
        // qu'elles sont indentées et ne commencent pas une nouvelle entrée.
        let text = item[2]!
        i++
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]!) &&
          !/^\s*([-*+]|\d+[.)])\s/.test(lines[i]!)
        ) {
          text += ' ' + lines[i]!.trim()
          i++
        }
        items.push(parseInline(text))
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // --- Citation ---------------------------------------------------------
    if (/^\s*>\s?/.test(line)) {
      flush()
      const body: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i]!)) {
        body.push(lines[i]!.replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', content: parseInline(body.join('\n')) })
      continue
    }

    buffer.push(line)
    i++
  }

  flush()
  return blocks
}
