/**
 * Complétion dans le composeur : mentions « @ » et commandes « / ».
 *
 * Les deux vivent ensemble parce qu'elles se disputent le même clavier. Les
 * flèches, Tab, Entrée et Échap veulent dire autre chose selon qu'une liste est
 * ouverte ou non, et l'ordre de priorité entre elles est une décision, pas un
 * détail : le sélecteur capte la navigation **avant** l'envoi, sinon Entrée
 * enverrait le message au lieu de choisir le fichier surligné.
 *
 * Écrit au milieu du composeur, cet arbitrage se perdait dans trois cents
 * autres lignes. `handleKey` le rassemble et dit franchement s'il a consommé la
 * touche ; l'appelant n'a plus qu'à traiter le cas ordinaire.
 */

import * as React from 'react'
import { findMention, type MentionEntry } from './MentionPicker.js'

export type Completion = {
  /** Mention en cours, avec la position du « @ » dans le texte. */
  mention: { start: number; query: string } | null
  /** Fichiers proposés pour la mention en cours. */
  matches: MentionEntry[]
  /** Commande en cours de frappe, sans la barre ; `null` si ce n'en est pas une. */
  command: string | null
  /** Commandes proposées. */
  commandMatches: string[]
  /** Entrée surlignée, commune aux deux listes — une seule est ouverte à la fois. */
  highlight: number
  /** Le survol à la souris déplace le surlignage. */
  setHighlight: (index: number) => void
  /** Recalcule la mention d'après la position réelle du curseur. */
  sync: (text: string, caret: number) => void
  insert: (entry: MentionEntry) => void
  pick: (name: string) => void
  /** Referme tout — envoi du message, changement de session. */
  reset: () => void
  /** Traite les touches de navigation. Rend `true` si la touche est consommée. */
  handleKey: (event: React.KeyboardEvent) => boolean
}

export function useCompletion({
  draft,
  setDraft,
  areaRef,
  workspace,
  commands,
  sessionId,
}: {
  draft: string
  setDraft: (text: string) => void
  areaRef: React.RefObject<HTMLTextAreaElement | null>
  workspace: string
  commands: readonly string[]
  /** `null` tant qu'aucune conversation n'est ouverte. */
  sessionId: string | null
}): Completion {
  const [mention, setMention] = React.useState<{ start: number; query: string } | null>(null)
  const [matches, setMatches] = React.useState<MentionEntry[]>([])
  const [highlight, setHighlight] = React.useState(0)

  /**
   * Une commande n'est reconnue qu'en tête de message : une barre au milieu
   * d'une phrase est un chemin, une date ou une fraction. Le moteur applique la
   * même règle, l'interface ne doit pas promettre autre chose.
   */
  const command = React.useMemo(() => {
    const match = /^\/([\w:-]*)$/.exec(draft)
    return match ? match[1]! : null
  }, [draft])

  const commandMatches = React.useMemo(() => {
    if (command === null) return []
    const needle = command.toLowerCase()
    return commands.filter(name => name.toLowerCase().includes(needle)).slice(0, 60)
  }, [command, commands])

  const reset = React.useCallback(() => {
    setMention(null)
    setMatches([])
  }, [])

  React.useEffect(() => {
    reset()
  }, [sessionId, reset])

  const sync = React.useCallback((text: string, caret: number) => {
    const found = findMention(text, caret)
    setMention(found)
    if (!found) setMatches([])
  }, [])

  React.useEffect(() => {
    if (!mention || !workspace) return
    let cancelled = false
    void window.engine.searchFiles(workspace, mention.query).then(found => {
      if (cancelled) return
      setMatches(found)
      setHighlight(0)
    })
    return () => {
      cancelled = true
    }
  }, [mention, workspace])

  /** Remplace la mention par le chemin relatif choisi. */
  const insert = React.useCallback(
    (entry: MentionEntry) => {
      if (!mention) return
      const area = areaRef.current
      const caret = area?.selectionStart ?? draft.length
      // Un espace suit l'insertion : sans lui, la frappe suivante repartirait
      // dans une mention qu'on vient de clore.
      const inserted = `${entry.relative}${entry.kind === 'dir' ? '/' : ' '}`
      const next = draft.slice(0, mention.start) + inserted + draft.slice(caret)
      setDraft(next)
      setMention(null)
      setMatches([])
      // Le curseur se replace après l'insertion, une fois React repeint.
      requestAnimationFrame(() => {
        const position = mention.start + inserted.length
        area?.focus()
        area?.setSelectionRange(position, position)
        // Un dossier laisse la mention ouverte pour descendre dedans.
        if (entry.kind === 'dir') sync(next, position)
      })
    },
    [areaRef, draft, mention, setDraft, sync],
  )

  const pick = React.useCallback(
    (name: string) => {
      // Une espace derrière : la plupart des commandes prennent un argument, et
      // l'utilisateur enchaîne sans avoir à l'ajouter.
      setDraft(`/${name} `)
      areaRef.current?.focus()
    },
    [areaRef, setDraft],
  )

  const handleKey = (event: React.KeyboardEvent): boolean => {
    if (command !== null && commandMatches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight(h => (h + 1) % commandMatches.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight(h => (h - 1 + commandMatches.length) % commandMatches.length)
        return true
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        pick(commandMatches[highlight] ?? commandMatches[0]!)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setDraft('')
        return true
      }
    }

    // Le sélecteur de mention capte la navigation avant tout le reste : sinon
    // Entrée enverrait le message au lieu de choisir le fichier surligné.
    if (mention && matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight(h => (h + 1) % matches.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight(h => (h - 1 + matches.length) % matches.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insert(matches[highlight]!)
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        reset()
        return true
      }
    }

    return false
  }

  return {
    mention,
    matches,
    command,
    commandMatches,
    highlight,
    setHighlight,
    sync,
    insert,
    pick,
    reset,
    handleKey,
  }
}
