/**
 * Modèles locaux, au format GGUF, tirés de Hugging Face.
 *
 * ## Pourquoi pas Ollama
 *
 * Ollama enveloppe llama.cpp et masque les réglages qui décident des
 * performances en service partagé : nombre de fils, taille de lot,
 * parallélisme, quantification du cache. Il impose aussi son propre magasin de
 * fichiers, son propre nommage, et son propre serveur — qu'il faut avoir
 * lancé pour ne serait-ce que télécharger.
 *
 * Ici on va chercher le fichier à la source. Un `.gguf` est un fichier unique,
 * autoportant, que `llama-server` lit directement. Le même fichier tournera
 * sur le poste et sur le serveur : une seule chaîne à connaître, à régler et à
 * déboguer.
 *
 * ## Ce que « Q4_K_M » veut dire
 *
 * La quantification : les poids sont ramenés à ~4 bits. C'est le point
 * d'équilibre retenu partout — en dessous la qualité se dégrade nettement, au
 * dessus la taille double pour un gain marginal. `UD-Q4_K_XL` est la variante
 * d'Unsloth, qui garde en précision supérieure les couches qui y sont
 * sensibles ; à taille comparable elle est meilleure, on la préfère quand elle
 * existe.
 */

export type CatalogEntry = {
  /** Identifiant stable, sert de nom de fichier local et de nom de modèle. */
  id: string
  label: string
  /** Dépôt Hugging Face. */
  repo: string
  /** Fichier dans ce dépôt. */
  file: string
  bytes: number
  /**
   * Projecteur multimodal, pour les modèles qui lisent les images.
   *
   * Fichier distinct : les poids du modèle de langage et ceux de l'encodeur
   * visuel sont publiés séparément, et `llama-server` veut les deux.
   */
  mmproj?: string
  mmprojBytes?: number
  /** Appel d'outils : sans lui le moteur ne peut rien faire. */
  tools: boolean
  /** Contexte d'entraînement, borne haute utile de `-c`. */
  context: number
  summary: string
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'qwen3-4b-instruct',
    label: 'Qwen3 4B Instruct',
    repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF',
    file: 'Qwen3-4B-Instruct-2507-UD-Q4_K_XL.gguf',
    bytes: 2.55e9,
    tools: true,
    context: 262144,
    summary:
      'Le plus léger qui sache encore appeler des outils. Tourne entièrement sur une carte de 6 Go, ou sur processeur sans souffrir.',
  },
  {
    id: 'qwen2.5-coder-7b',
    label: 'Qwen2.5 Coder 7B',
    repo: 'bartowski/Qwen2.5-Coder-7B-Instruct-GGUF',
    file: 'Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf',
    bytes: 4.68e9,
    tools: true,
    context: 32768,
    summary:
      'Spécialisé code. Le meilleur rapport qualité/taille pour ce poste : tient tout juste dans 6 Go de mémoire vidéo.',
  },
  {
    id: 'qwen3-8b',
    label: 'Qwen3 8B',
    repo: 'unsloth/Qwen3-8B-GGUF',
    file: 'Qwen3-8B-UD-Q4_K_XL.gguf',
    bytes: 5.14e9,
    tools: true,
    context: 131072,
    summary:
      'Généraliste, raisonnement étendu. Débordera un peu sur le processeur avec un contexte long.',
  },
  {
    id: 'devstral-24b',
    label: 'Devstral Small 24B',
    repo: 'unsloth/Devstral-Small-2507-GGUF',
    file: 'Devstral-Small-2507-UD-Q4_K_XL.gguf',
    bytes: 14.55e9,
    mmproj: 'mmproj-F16.gguf',
    mmprojBytes: 0.88e9,
    tools: true,
    context: 131072,
    summary:
      'Conçu pour les agents de code : appels d’outils et édition de fichiers. Comprend aussi les images. Pour le serveur.',
  },
  {
    id: 'qwen3.8-27b',
    label: 'Qwen3.8 27B',
    repo: 'unsloth/Qwen3.8-27B-GGUF',
    file: 'Qwen3.8-27B-UD-Q4_K_XL.gguf',
    bytes: 17.56e9,
    mmproj: 'mmproj-F16.gguf',
    mmprojBytes: 0.93e9,
    tools: true,
    context: 262144,
    summary:
      'Le plus capable du lot, et il lit les images. Mais il est dense — 64 couches traversées en entier à chaque jeton — là où Qwen3 Coder n’en active qu’un dixième. Sur processeur, comptez quelques jetons par seconde ; il lui faut une carte graphique pour donner sa mesure.',
  },
  {
    id: 'qwen3-coder-30b-a3b',
    label: 'Qwen3 Coder 30B-A3B',
    repo: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
    file: 'Qwen3-Coder-30B-A3B-Instruct-UD-Q4_K_XL.gguf',
    bytes: 17.67e9,
    tools: true,
    context: 262144,
    summary:
      'Experts partiels : 30 milliards de paramètres, 3 activés par jeton. La qualité d’un gros modèle au coût de calcul d’un petit — c’est le bon choix sur processeur, à condition d’avoir la mémoire.',
  },
]

/** Adresse de téléchargement d'un fichier de dépôt. */
export function huggingFaceUrl(repo: string, file: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${file}?download=true`
}
