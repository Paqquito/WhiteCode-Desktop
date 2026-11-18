/**
 * Modèle de diff, indépendant du rendu.
 *
 * Deux sources alimentent l'application : les modifications proposées par le
 * modèle, qui arrivent sous forme de deux chaînes à comparer, et celles que
 * rapporte Git, qui arrivent déjà en diff unifié. Les faire converger vers un
 * seul type de ligne évite d'écrire deux fois l'affichage — et donc de le voir
 * diverger.
 */

export type DiffLine = {
  kind: 'context' | 'add' | 'remove'
  text: string
  /** Numéro dans le fichier d'origine, absent pour un ajout. */
  oldNo?: number
  /** Numéro dans le fichier modifié, absent pour une suppression. */
  newNo?: number
}

/** Une ligne, ou une plage inchangée repliée. */
export type DiffRow = DiffLine | 'gap'

/**
 * Plus longue sous-séquence commune, sur les lignes.
 *
 * Comparer ligne à ligne plutôt que caractère à caractère : c'est la
 * granularité à laquelle on relit du code, et cela évite les diffs
 * inexploitables où une indentation modifiée fait basculer tout le bloc.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')

  // Table des longueurs de LCS. Les entrées d'outils tiennent en quelques
  // centaines de lignes : le coût quadratique est sans conséquence ici.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'context', text: a[i]!, oldNo: i + 1, newNo: j + 1 })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: 'remove', text: a[i]!, oldNo: i + 1 })
      i++
    } else {
      out.push({ kind: 'add', text: b[j]!, newNo: j + 1 })
      j++
    }
  }
  while (i < a.length) out.push({ kind: 'remove', text: a[i]!, oldNo: ++i })
  while (j < b.length) out.push({ kind: 'add', text: b[j]!, newNo: ++j })

  return out
}

/**
 * Réduit les longues plages inchangées.
 *
 * Une édition dans un fichier de mille lignes ne doit pas en afficher mille :
 * seules quelques lignes autour de chaque changement portent du sens.
 */
export function collapseContext(lines: DiffLine[], margin = 3): DiffRow[] {
  const keep = new Set<number>()
  lines.forEach((line, index) => {
    if (line.kind === 'context') return
    for (let k = index - margin; k <= index + margin; k++) {
      if (k >= 0 && k < lines.length) keep.add(k)
    }
  })

  const out: DiffRow[] = []
  let skipping = false
  lines.forEach((line, index) => {
    if (keep.has(index)) {
      out.push(line)
      skipping = false
    } else if (!skipping) {
      out.push('gap')
      skipping = true
    }
  })
  return out
}

/**
 * Lit un diff unifié tel que le produit Git.
 *
 * Git a déjà fait le travail de comparaison, et mieux qu'une LCS naïve : il
 * connaît les renommages, les fins de ligne, les fichiers binaires. On se
 * contente donc de traduire sa sortie, sans recalculer.
 *
 * Les en-têtes `@@` deviennent des replis : ils marquent exactement les
 * endroits où Git a lui-même écarté du contexte.
 */
export function parseUnifiedDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldNo = 0
  let newNo = 0
  let started = false

  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      // « @@ -12,7 +12,9 @@ » : on reprend la numérotation annoncée.
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      if (match) {
        oldNo = Number(match[1])
        newNo = Number(match[2])
      }
      // Pas de repli avant la première section : il n'y a rien au-dessus.
      if (started) rows.push('gap')
      started = true
      continue
    }
    if (!started) continue
    // « \ No newline at end of file » : information de forme, pas de contenu.
    if (line.startsWith('\\')) continue

    const marker = line[0]
    const body = line.slice(1)
    if (marker === '+') {
      rows.push({ kind: 'add', text: body, newNo: newNo++ })
    } else if (marker === '-') {
      rows.push({ kind: 'remove', text: body, oldNo: oldNo++ })
    } else if (marker === ' ' || line === '') {
      rows.push({ kind: 'context', text: body, oldNo: oldNo++, newNo: newNo++ })
    }
  }

  return rows
}

/** Ajouts et retraits d'un ensemble de lignes. */
export function countChanges(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row === 'gap') continue
    if (row.kind === 'add') added++
    else if (row.kind === 'remove') removed++
  }
  return { added, removed }
}
