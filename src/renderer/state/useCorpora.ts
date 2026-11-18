/**
 * Corpus documentaires.
 *
 * L'indexation dure des minutes et se déroule dans le processus principal ; le
 * rendu en suit la progression par événements. La ligne courante est conservée
 * par corpus, afin qu'ouvrir les paramètres pendant une indexation montre où
 * elle en est plutôt qu'un état figé.
 */

import * as React from 'react'
import type { Corpus, IndexProgress } from '../../main/preload.js'

export type CorpusActivity = {
  /** Message courant, affiché sous le corpus. */
  message: string
  /** Progression de 0 à 1, ou `null` quand elle n'est pas mesurable. */
  ratio: number | null
  failed: boolean
  running: boolean
}

/**
 * Formats fermés, avec la marche à suivre.
 *
 * Ils ne manquent pas d'une bibliothèque : leur contenu n'est pas accessible
 * hors de leur logiciel d'origine. Proposer « installez tel paquet » serait
 * faux, la seule voie est l'export.
 */
const CLOSED_FORMATS = [
  {
    ext: '.one',
    advice:
      'ce dossier contient des blocs-notes OneNote (.one), un format fermé dont le texte n’est pas lisible hors de OneNote. Exportez les sections en PDF ou en Word, puis indexez le dossier d’export.',
  },
  {
    ext: '.onetoc2',
    advice:
      'ce dossier contient des blocs-notes OneNote, un format fermé. Exportez les sections en PDF ou en Word, puis indexez le dossier d’export.',
  },
  {
    ext: '.msg',
    advice:
      'ce dossier contient des messages Outlook (.msg), non lisibles ici. Exportez-les en texte ou en PDF.',
  },
] as const

export function useCorpora() {
  const [corpora, setCorpora] = React.useState<Corpus[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [ready, setReady] = React.useState(false)
  const [activity, setActivity] = React.useState<Record<string, CorpusActivity>>({})

  const refresh = React.useCallback(async () => {
    try { setCorpora(await window.engine.listCorpora()); setReady(await window.engine.corporaReady()) }
    catch (error) { setError(String(error)) }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    return window.engine.onCorpusProgress(({ id, progress }) => {
      setActivity(current => ({ ...current, [id]: describe(progress, current[id]) }))
      // La fin d'indexation change les compteurs du corpus : on relit sa
      // définition plutôt que de deviner les nouveaux chiffres.
      if (progress.kind === 'done') void refresh()
    })
  }, [refresh])

  const create = React.useCallback(
    async (name: string, source: string, embedding: string) => {
      try { setError(null); await window.engine.createCorpus(name, source, embedding); await refresh(); return true }
      catch (error) { setError(String(error)); return false }
    },
    [refresh],
  )

  const remove = React.useCallback(
    async (id: string) => {
      try { setError(null); await window.engine.removeCorpus(id); await refresh() } catch (error) { setError(String(error)) }
    },
    [refresh],
  )

  const setEnabled = React.useCallback(
    async (id: string, enabled: boolean) => {
      try { setError(null); await window.engine.enableCorpus(id, enabled); await refresh() } catch (error) { setError(String(error)) }
    },
    [refresh],
  )

  const index = React.useCallback(async (id: string) => {
    setActivity(current => ({
      ...current,
      [id]: { message: 'Démarrage…', ratio: null, failed: false, running: true },
    }))
    try { setError(null); await window.engine.indexCorpus(id) } catch (error) { setError(String(error)); setActivity(current => ({ ...current, [id]: { message: String(error), ratio: null, failed: true, running: false } })) }
  }, [])

  return { corpora, error, ready, activity, refresh, create, remove, setEnabled, index }
}

function describe(
  progress: IndexProgress,
  previous: CorpusActivity | undefined,
): CorpusActivity {
  switch (progress.kind) {
    case 'setup':
      return { message: progress.message, ratio: null, failed: false, running: true }
    case 'start':
      return {
        message: `${progress.files} fichier(s) à examiner…`,
        ratio: 0,
        failed: false,
        running: true,
      }
    case 'file':
      return {
        message: progress.path.split(/[\\/]/).pop() ?? progress.path,
        ratio: progress.total > 0 ? progress.position / progress.total : null,
        failed: false,
        running: true,
      }
    case 'done': {
      const nothing =
        progress.total === 0 && progress.indexed === 0 && progress.skipped === 0
      // « 0 document » sans explication laisse croire à une panne. La cause est
      // presque toujours le format des fichiers : on la nomme.
      const rejected = [
        ...Object.entries(progress.unreadable).map(
          ([ext, n]) => `${n} ${ext} illisible(s) ici`,
        ),
        ...Object.entries(progress.ignored).map(([ext, n]) => `${n} ${ext}`),
      ]

      // Certains formats ne sont pas seulement absents de la liste : ils sont
      // fermés, et aucune bibliothèque ne les ouvrira. Le dire évite de
      // chercher une option qui n'existe pas.
      const closed = CLOSED_FORMATS.find(
        entry => progress.ignored[entry.ext] || progress.unreadable[entry.ext],
      )

      const message = nothing
        ? closed
          ? `Aucun texte exploitable : ${closed.advice}`
          : rejected.length > 0
            ? `Aucun texte exploitable. Écartés : ${rejected.join(', ')}.`
            : 'Aucun fichier trouvé dans ce dossier.'
        : `${progress.indexed} fichier(s) indexé(s), ${progress.skipped} inchangé(s)` +
          (progress.removed > 0 ? `, ${progress.removed} retiré(s)` : '') +
          ` — ${progress.total} fragments.` +
          (rejected.length > 0 ? ` Écartés : ${rejected.join(', ')}.` : '')

      return { message, ratio: 1, failed: nothing, running: false }
    }
    case 'error':
      return { message: progress.message, ratio: previous?.ratio ?? null, failed: true, running: false }
  }
}
