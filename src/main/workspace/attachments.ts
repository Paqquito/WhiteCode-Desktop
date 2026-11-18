/**
 * Pièces jointes déposées dans la conversation.
 *
 * Deux traitements selon la nature du fichier, parce que le modèle les
 * consomme différemment :
 *
 *  - **Images** : encodées en base64 et jointes comme blocs `image`. Le modèle
 *    les regarde directement.
 *  - **Documents texte** : le contenu est inséré dans le message, précédé du
 *    nom du fichier. Un chemin seul ne suffirait pas — un fichier déposé
 *    depuis le bureau est souvent hors de l'espace de travail, donc hors de
 *    portée des outils de lecture.
 *
 */

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

/** Au delà, l'envoi coûte plus qu'il n'apporte. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TEXT_BYTES = 512 * 1024

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export type Attachment =
  | {
      kind: 'image'
      name: string
      path: string
      mediaType: string
      /** Contenu encodé en base64, prêt pour un bloc `image`. */
      data: string
      bytes: number
    }
  | {
      kind: 'text'
      name: string
      path: string
      text: string
      bytes: number
      /** Le fichier a été coupé pour tenir dans la limite. */
      truncated: boolean
    }
  | {
      kind: 'rejected'
      name: string
      path: string
      reason: 'too-large' | 'unsupported' | 'unreadable'
    }

/**
 * Prépare un fichier pour l'envoi.
 *
 * Ne lève jamais : un fichier illisible devient une pièce `rejected`, que
 * l'interface affiche avec sa raison. Déposer cinq fichiers dont un cassé ne
 * doit pas faire échouer les quatre autres.
 */
export async function prepareAttachment(path: string): Promise<Attachment> {
  const name = basename(path)
  const ext = extname(path).toLowerCase()

  let bytes: number
  try {
    const info = await stat(path)
    if (!info.isFile()) return { kind: 'rejected', name, path, reason: 'unreadable' }
    bytes = info.size
  } catch {
    return { kind: 'rejected', name, path, reason: 'unreadable' }
  }

  const mediaType = IMAGE_TYPES[ext]
  if (mediaType) {
    if (bytes > MAX_IMAGE_BYTES) {
      return { kind: 'rejected', name, path, reason: 'too-large' }
    }
    try {
      const buffer = await readFile(path)
      return {
        kind: 'image',
        name,
        path,
        mediaType,
        data: buffer.toString('base64'),
        bytes,
      }
    } catch {
      return { kind: 'rejected', name, path, reason: 'unreadable' }
    }
  }

  try {
    const buffer = await readFile(path)
    // Un octet nul trahit un binaire dont l'extension ne disait rien.
    if (buffer.subarray(0, 4096).includes(0)) {
      return { kind: 'rejected', name, path, reason: 'unsupported' }
    }
    const truncated = buffer.length > MAX_TEXT_BYTES
    return {
      kind: 'text',
      name,
      path,
      text: buffer.subarray(0, MAX_TEXT_BYTES).toString('utf8'),
      bytes,
      truncated,
    }
  } catch {
    return { kind: 'rejected', name, path, reason: 'unreadable' }
  }
}
