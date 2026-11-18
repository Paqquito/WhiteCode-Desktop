/**
 * Pièces jointes en attente d'envoi.
 *
 * Elles vivent le temps d'un message : ajoutées par dépôt, par collage ou par
 * le sélecteur, vidées à l'envoi.
 *
 * ## Deux origines, deux chemins
 *
 * Un fichier **déposé ou choisi** existe sur le disque : il est préparé par le
 * processus principal, qui seul y a accès, et qui applique les limites de
 * taille au bon endroit.
 *
 * Un fichier **collé** n'existe nulle part — une capture d'écran vit dans le
 * presse-papier et n'a pas de chemin. Il est donc lu ici, dans le rendu, à
 * partir du `Blob`. Les mêmes limites s'appliquent, réécrites côté rendu
 * faute de pouvoir réutiliser celles du processus principal.
 */

import * as React from 'react'
import { useSessionState } from './useSessionState.js'
import type { Attachment } from '../../main/preload.js'

/** Mêmes plafonds que `attachments.ts`, côté processus principal. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_TEXT_BYTES = 512 * 1024

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

let pasteCounter = 0

/**
 * Lit un fichier du presse-papier.
 *
 * Rend toujours une pièce jointe, y compris en cas de refus : une image
 * silencieusement ignorée laisse croire que le collage n'a pas marché, alors
 * qu'une pastille rouge dit ce qui s'est passé.
 */
async function readBlob(file: File): Promise<Attachment> {
  // Un collage n'a pas de nom la plupart du temps : « image.png » générique
  // vaut mieux qu'une chaîne vide dans la pastille.
  const name = file.name || `presse-papier-${++pasteCounter}.png`
  const path = `presse-papier:${name}:${Date.now()}:${pasteCounter}`

  try {
    if (IMAGE_TYPES.has(file.type)) {
      if (file.size > MAX_IMAGE_BYTES) {
        return { kind: 'rejected', name, path, reason: 'too-large' }
      }
      const buffer = await file.arrayBuffer()
      return {
        kind: 'image',
        name,
        path,
        mediaType: file.type,
        data: toBase64(buffer),
        bytes: file.size,
      }
    }

    if (file.type.startsWith('image/')) {
      return { kind: 'rejected', name, path, reason: 'unsupported' }
    }

    if (file.size > MAX_TEXT_BYTES) {
      return { kind: 'rejected', name, path, reason: 'too-large' }
    }
    const text = await file.text()
    // Un octet nul trahit un binaire que le type MIME n'annonçait pas.
    if (text.includes(String.fromCharCode(0))) {
      return { kind: 'rejected', name, path, reason: 'unsupported' }
    }
    return { kind: 'text', name, path, text, bytes: file.size, truncated: false }
  } catch {
    return { kind: 'rejected', name, path, reason: 'unreadable' }
  }
}

/**
 * Encodage base64 d'un tampon binaire.
 *
 * Par tranches : `String.fromCharCode(...octets)` sur cinq mégaoctets dépasse
 * la taille maximale de la pile d'arguments et lève.
 */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

const EMPTY_ATTACHMENTS: Attachment[] = []

export function useAttachments(sessionId: string | null) {
  const [items, setItems] = useSessionState(sessionId, EMPTY_ATTACHMENTS, 'attachments')
  const [pending, setPending] = useSessionState(sessionId, 0, 'attachments-pending')
  const [error, setError] = useSessionState(sessionId, '', 'attachments-error')

  const append = React.useCallback((incoming: Attachment[]) => {
    setItems(current => {
      // Un même fichier déposé deux fois ne doit être joint qu'une fois. Les
      // collages échappent à la règle par construction : leur clé porte un
      // horodatage, deux captures identiques restent deux pièces jointes.
      const known = new Set(current.map(a => a.path))
      return [...current, ...incoming.filter(a => !known.has(a.path))]
    })
  }, [setItems])

  const addPaths = React.useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      setPending(n => n + 1); setError('')
      try {
        append(await window.engine.prepareAttachments(paths))
      } catch (reason) {
        setError(`Impossible de joindre ces fichiers : ${String(reason)}`)
      } finally {
        setPending(n => Math.max(0, n - 1))
      }
    },
    [append, setPending, setError],
  )

  /**
   * Ajoute des fichiers, quelle que soit leur origine.
   *
   * Le tri se fait sur la présence d'un chemin disque : `getPathForFile` rend
   * une chaîne vide pour ce qui vient du presse-papier.
   */
  const addFiles = React.useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files)
      const paths: string[] = []
      const blobs: File[] = []

      for (const file of list) {
        const path = window.engine.pathForFile(file)
        if (path) paths.push(path)
        else blobs.push(file)
      }

      setPending(n => n + 1); setError('')
      try {
        if (paths.length > 0) {
          append(await window.engine.prepareAttachments(paths))
        }
        if (blobs.length > 0) {
          append(await Promise.all(blobs.map(readBlob)))
        }
      } catch (reason) {
        setError(`Impossible de joindre ces fichiers : ${String(reason)}`)
      } finally {
        setPending(n => Math.max(0, n - 1))
      }
    },
    [append, setPending, setError],
  )

  const pick = React.useCallback(async () => {
    try { await addPaths(await window.engine.chooseAttachments()) }
    catch (reason) { setError(`Impossible de choisir un fichier : ${String(reason)}`) }
  }, [addPaths, setError])

  const remove = React.useCallback((path: string) => {
    setItems(current => current.filter(a => a.path !== path))
  }, [setItems])

  const clear = React.useCallback(() => setItems([]), [setItems])

  /**
   * Assemble le message à envoyer.
   *
   * Sans pièce jointe, une simple chaîne : c'est la forme la plus légère et
   * celle que le moteur consomme le mieux. Avec, une suite de blocs — les
   * images en premier, pour que le modèle les ait sous les yeux avant de lire
   * la consigne qui s'y rapporte.
   */
  const buildContent = React.useCallback(
    (text: string): string | unknown[] => {
      const usable = items.filter(a => a.kind === 'image' || a.kind === 'text')
      if (usable.length === 0) return text

      const blocks: unknown[] = []

      for (const item of usable) {
        if (item.kind === 'image') {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: item.mediaType,
              data: item.data,
            },
          })
        }
      }

      for (const item of usable) {
        if (item.kind === 'text') {
          blocks.push({
            type: 'text',
            text:
              `Fichier joint : ${item.name}` +
              (item.truncated ? ' (tronqué)' : '') +
              `\n\n${item.text}`,
          })
        }
      }

      blocks.push({ type: 'text', text })
      return blocks
    },
    [items],
  )

  return { items, busy: pending > 0, error, addFiles, addPaths, pick, remove, clear, buildContent }
}
