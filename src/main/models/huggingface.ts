/**
 * Résolution d'un dépôt Hugging Face collé par l'utilisateur.
 *
 * ## Le geste que ce fichier sert
 *
 * On copie l'adresse d'un modèle depuis son navigateur, on la colle, et
 * l'application doit répondre : « ce dépôt existe, voici les fichiers
 * téléchargeables, voici celui que je vous conseille ». Le catalogue figé de
 * `catalog.ts` ne couvre que ce que nous avons choisi d'avance ; ici, c'est
 * l'utilisateur qui choisit, y compris un modèle publié la veille.
 *
 * ## Ce qui est accepté
 *
 * Toutes les formes sous lesquelles une adresse de dépôt circule réellement :
 * la page du dépôt, un lien vers un fichier précis, un lien vers un sous-dossier,
 * ou le simple `propriétaire/nom` qu'on lit dans les README. Refuser l'une
 * d'elles obligerait à expliquer laquelle coller, alors que la question n'a pas
 * lieu d'être.
 *
 * ## Ce qui est écarté
 *
 * Tout ce qui n'est pas `.gguf`. Un dépôt Hugging Face contient souvent le
 * modèle en plusieurs formats — safetensors, FP8, AWQ, MLX — dont `llama-server`
 * ne lit aucun. Les proposer produirait un téléchargement de plusieurs dizaines
 * de gigaoctets suivi d'un échec au chargement, sans que rien n'indique que le
 * format était le problème.
 */

/** Fichier `.gguf` d'un dépôt, tel qu'il sera téléchargé. */
export type GgufFile = {
  /** Chemin dans le dépôt, sous-dossiers compris. */
  path: string
  bytes: number
}

/**
 * Une option installable : une quantification, et les fichiers qu'elle exige.
 *
 * Une option porte plusieurs fichiers dans deux cas — un modèle découpé en
 * tranches, et un modèle multimodal dont le projecteur visuel est publié à
 * part. Dans les deux cas, n'en télécharger qu'un donne un modèle qui ne
 * charge pas.
 */
export type QuantOption = {
  /** Identifiant local, sert de nom de modèle dans l'application. */
  id: string
  /** Étiquette lisible : « Q4_K_M », « IQ4_XS »… */
  label: string
  /** Fichier principal, celui que `--model` reçoit. */
  file: GgufFile
  /** Tranches suivantes d'un modèle découpé, à télécharger aussi. */
  shards: GgufFile[]
  /** Projecteur visuel, si le dépôt en publie un. */
  mmproj: GgufFile | null
  /** Somme de tout ce qu'il faut tirer. */
  totalBytes: number
}

export type ResolvedRepo = {
  /** `propriétaire/nom`, forme canonique. */
  repo: string
  /** Adresse de la page, pour pouvoir y retourner. */
  url: string
  options: QuantOption[]
  /** Option conseillée, ou `null` si le dépôt n'offre aucun GGUF. */
  recommended: QuantOption | null
  /** Le dépôt exige-t-il d'accepter des conditions avant téléchargement ? */
  gated: boolean
}

export type ResolveResult =
  | { ok: true; repo: ResolvedRepo }
  | { ok: false; reason: string }

/**
 * Extrait `propriétaire/nom` de ce qui a été collé.
 *
 * Le découpage s'arrête au premier segment de navigation (`tree`, `blob`,
 * `resolve`) : ce sont eux qui séparent le nom du dépôt du chemin interne, et
 * les garder produirait un identifiant qui n'existe pas.
 */
export function parseRepoId(input: string): string | null {
  const text = input.trim()
  if (!text) return null

  let path = text
  if (/^https?:\/\//i.test(text)) {
    let url: URL
    try {
      url = new URL(text)
    } catch {
      return null
    }
    if (!/(^|\.)huggingface\.co$/i.test(url.hostname)) return null
    path = url.pathname
  }

  const segments = path.split('/').filter(Boolean)
  // Collé sans protocole — « huggingface.co/owner/name » —, l'hôte se retrouve
  // en tête des segments et passerait pour le propriétaire.
  if (segments[0] && /^(huggingface\.co|hf\.co)$/i.test(segments[0])) segments.shift()
  // `/models/owner/name` : la console et certains liens portent ce préfixe.
  if (segments[0] === 'models') segments.shift()

  const stop = segments.findIndex(s => s === 'tree' || s === 'blob' || s === 'resolve')
  const parts = stop === -1 ? segments : segments.slice(0, stop)
  if (parts.length < 2) return null

  const [owner, name] = parts
  if (!owner || !name) return null
  // Les noms Hugging Face n'admettent que ces caractères ; tout le reste
  // signale qu'on a affaire à autre chose qu'un dépôt.
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null
  return `${owner}/${name}`
}

/** Nom de fichier seul, sous-dossiers retirés. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Un projecteur visuel, reconnaissable à son nom par convention. */
function isMmproj(path: string): boolean {
  return /^mmproj/i.test(baseName(path))
}

/**
 * Tête de brouillon pour le décodage spéculatif, publiée à part.
 *
 * `mtp-RVN.gguf` n'est pas un modèle : c'est un accélérateur qui se greffe sur
 * un modèle. Le proposer comme installable ferait télécharger deux gigaoctets
 * que `llama-server` refuserait de charger seuls.
 *
 * À ne pas confondre avec `RVN-IQ4_XS-mtp.gguf`, qui est bien un modèle
 * complet, tête incluse — d'où l'ancrage en début de nom.
 */
function isDraftHead(path: string): boolean {
  return /^(mtp|draft)[-_.]/i.test(baseName(path))
}

/**
 * Tranche d'un modèle découpé : `…-00002-of-00004.gguf`.
 *
 * Rend le préfixe commun et le rang. `llama-server` ne reçoit que la première
 * tranche et trouve les suivantes à côté, mais il faut les avoir toutes.
 */
function shardOf(path: string): { stem: string; index: number } | null {
  const match = /^(.*)-(\d{5})-of-(\d{5})\.gguf$/i.exec(path)
  if (!match?.[1] || !match[2]) return null
  return { stem: match[1], index: Number(match[2]) }
}

/**
 * Étiquette d'une quantification, déduite du nom de fichier.
 *
 * Les publieurs suivent tous la même convention — le nom du modèle, puis la
 * quantification en suffixe — sans qu'aucun champ ne la porte explicitement.
 * On lit donc le nom, et à défaut on rend le nom de fichier : mieux vaut une
 * étiquette longue qu'une liste d'entrées indiscernables.
 *
 * Tout ce qui suit le jeton de quantification est conservé, et c'est
 * indispensable : un même dépôt publie couramment `IQ4_XS`, `IQ4_XS-mtp`,
 * `IQ4_XS-multilingual` et `IQ4_XS-multilingual-mtp`. Réduits au seul jeton,
 * ces quatre fichiers deviendraient quatre lignes identiques de tailles
 * différentes, impossibles à départager.
 */
function quantLabel(path: string): string {
  const name = baseName(path).replace(/\.gguf$/i, '')
  const match = /((?:UD-)?(?:IQ|Q)\d+(?:_[A-Z0-9]+)*|BF16|F16|F32)/i.exec(name)
  return match?.index === undefined ? name : name.slice(match.index)
}

/**
 * Ordre de préférence des quantifications.
 *
 * Plus le nombre est haut, plus l'option est jugée bonne à taille comparable.
 * `UD-Q4_K_XL` d'Unsloth garde en précision supérieure les couches qui y sont
 * sensibles ; `Q4_K_M` est le point d'équilibre habituel ; en dessous de 4 bits
 * la qualité se dégrade nettement, au dessus la taille double pour un gain
 * marginal.
 */
function quantScore(label: string): number {
  if (/^UD-Q4/.test(label)) return 100
  if (/^Q4_K_M/.test(label)) return 90
  if (/^Q4_K_L/.test(label)) return 85
  if (/^IQ4/.test(label)) return 80
  if (/^Q5/.test(label)) return 60
  if (/^IQ3/.test(label)) return 50
  if (/^Q3/.test(label)) return 40
  if (/^Q6/.test(label)) return 30
  if (/^Q8/.test(label)) return 20
  if (/^(BF16|F16|F32)/.test(label)) return 5
  return 10
}

/** Identifiant local : dérivé du dépôt et de la quantification, donc stable. */
function optionId(repo: string, label: string): string {
  const name = repo.slice(repo.indexOf('/') + 1)
  return `${name}-${label}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
}

/** Un fichier de l'arborescence, tel que l'API le rend. */
type TreeEntry = { type?: string; path?: string; size?: number; lfs?: { size?: number } }

/**
 * Interroge Hugging Face et construit la liste des options installables.
 *
 * Deux appels : l'un pour savoir si le dépôt existe et s'il est sous
 * conditions, l'autre pour l'arborescence. Le second seul ne suffirait pas —
 * un dépôt inexistant et un dépôt vide rendent la même liste vide, et ce n'est
 * pas la même chose à dire à l'utilisateur.
 */
export async function resolveRepo(input: string): Promise<ResolveResult> {
  const repo = parseRepoId(input)
  if (!repo) {
    return {
      ok: false,
      reason:
        "Adresse non reconnue. Collez l'adresse d'un modèle Hugging Face, par exemple https://huggingface.co/unsloth/Qwen3.8-27B-GGUF, ou simplement unsloth/Qwen3.8-27B-GGUF.",
    }
  }

  let gated = false
  try {
    const info = await fetch(`https://huggingface.co/api/models/${repo}`, {
      signal: AbortSignal.timeout(10_000),
    })
    // Hugging Face répond 401 aussi bien à un dépôt inexistant qu'à un dépôt
    // privé : il ne révèle pas lequel des deux, précisément pour ne pas laisser
    // deviner l'existence des dépôts privés. Le message couvre donc les deux
    // cas — annoncer « privé » sur une faute de frappe enverrait chercher un
    // compte là où il n'y a qu'une lettre à corriger.
    if (info.status === 401 || info.status === 403 || info.status === 404) {
      return {
        ok: false,
        reason: `Aucun dépôt public à cette adresse : ${repo}. Vérifiez l'orthographe ; s'il est privé ou sous conditions, le téléchargement anonyme reste refusé même après acceptation.`,
      }
    }
    if (!info.ok) {
      return { ok: false, reason: `Hugging Face a répondu ${info.status}.` }
    }
    const body = (await info.json()) as { gated?: boolean | string }
    gated = Boolean(body.gated)
  } catch (error) {
    return { ok: false, reason: describeNetworkFailure(error) }
  }

  let entries: TreeEntry[]
  try {
    const tree = await fetch(
      `https://huggingface.co/api/models/${repo}/tree/main?recursive=true`,
      { signal: AbortSignal.timeout(15_000) },
    )
    if (!tree.ok) {
      return { ok: false, reason: `Lecture du dépôt impossible (${tree.status}).` }
    }
    entries = (await tree.json()) as TreeEntry[]
  } catch (error) {
    return { ok: false, reason: describeNetworkFailure(error) }
  }

  const files: GgufFile[] = entries
    .filter(e => e.type !== 'directory' && e.path?.toLowerCase().endsWith('.gguf'))
    .map(e => ({
      path: e.path!,
      // La taille réelle d'un fichier volumineux vit sous `lfs` ; `size` ne
      // porte alors que celle du pointeur, quelques centaines d'octets. Prendre
      // le premier des deux qui soit crédible.
      bytes: e.lfs?.size ?? e.size ?? 0,
    }))

  const mmproj = files.find(f => isMmproj(f.path)) ?? null
  const weights = files.filter(f => !isMmproj(f.path) && !isDraftHead(f.path))

  // Regroupement des tranches : une entrée par modèle, pas une par fichier.
  const groups = new Map<string, GgufFile[]>()
  for (const file of weights) {
    const shard = shardOf(file.path)
    const key = shard ? shard.stem : file.path
    const bucket = groups.get(key)
    if (bucket) bucket.push(file)
    else groups.set(key, [file])
  }

  const options: QuantOption[] = []
  for (const [key, bucket] of groups) {
    bucket.sort((a, b) => (shardOf(a.path)?.index ?? 0) - (shardOf(b.path)?.index ?? 0))
    const [head, ...rest] = bucket
    if (!head) continue
    const label = quantLabel(key)
    const totalBytes =
      bucket.reduce((sum, f) => sum + f.bytes, 0) + (mmproj?.bytes ?? 0)
    options.push({
      id: optionId(repo, label),
      label,
      file: head,
      shards: rest,
      mmproj,
      totalBytes,
    })
  }

  // Tri d'affichage : par taille croissante. C'est le critère que l'utilisateur
  // arbitre en premier — ce qui tient dans sa carte — et il rend la liste
  // lisible même quand les étiquettes ne le sont pas.
  options.sort((a, b) => a.totalBytes - b.totalBytes)

  if (options.length === 0) {
    return {
      ok: false,
      reason:
        "Ce dépôt ne contient aucun fichier .gguf. Cherchez la variante GGUF du même modèle — les formats safetensors, FP8, AWQ, NVFP4 et MLX ne sont pas lisibles par llama.cpp.",
    }
  }

  const recommended =
    [...options].sort(
      (a, b) => quantScore(b.label) - quantScore(a.label) || a.totalBytes - b.totalBytes,
    )[0] ?? null

  return {
    ok: true,
    repo: { repo, url: `https://huggingface.co/${repo}`, options, recommended, gated },
  }
}

function describeNetworkFailure(error: unknown): string {
  const message = String((error as Error)?.message ?? error)
  return /timeout|abort|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(message)
    ? "Hugging Face est injoignable. Vérifiez la connexion réseau — et, derrière un proxy d'entreprise, que le trafic sortant est autorisé."
    : message
}
