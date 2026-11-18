import * as React from 'react'
import {
  browserUrl,
  type SurfaceCommand,
  type SurfaceState,
} from '../../shared/browser.js'
import { Panel } from '../ui/Panel.js'
import { ask } from '../ui/confirm.js'
import { useSessionState } from '../state/useSessionState.js'
import { WebSurface } from './WebSurface.js'
type Note = {
  id: string
  url: string
  quote: string
  text: string
  createdAt: number
}
export function BrowserPanel({
  sessionId,
  workspace,
  onClose,
}: {
  sessionId: string | null
  workspace: string
  onClose: () => void
}): React.ReactNode {
  const [lastUrl, setLastUrl] = useSessionState(
    sessionId,
    '',
    `browser-url:${workspace}`,
  )
  const [address, setAddress] = React.useState(lastUrl)
  const [source, setSource] = React.useState<string | null>(lastUrl || null)
  const id = React.useMemo(() => crypto.randomUUID(), [sessionId, workspace])
  const [state, setState] = React.useState<SurfaceState | null>(null)
  const [error, setError] = React.useState('')
  const [tools, setTools] = React.useState<'notes' | 'downloads' | null>(null)
  const [text, setText] = useSessionState(
      sessionId,
      '',
      `browser-note:${workspace}`,
    ),
    [quote, setQuote] = useSessionState(
      sessionId,
      '',
      `browser-quote:${workspace}`,
    )
  const [quoteUrl, setQuoteUrl] = useSessionState(
    sessionId,
    '',
    `browser-quote-url:${workspace}`,
  )
  const key = `desktop:browser-notes:${workspace}`
  const [notes, setNotes] = React.useState<Note[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(key) ?? '[]')
      return Array.isArray(raw)
        ? raw.filter(
            (n) => typeof n.text === 'string' && typeof n.url === 'string',
          )
        : []
    } catch {
      return []
    }
  })
  async function command(action: SurfaceCommand, value?: string) {
    setError('')
    try {
      return await window.engine.surfaceCommand(id, action, value)
    } catch (e) {
      setError(String(e))
    }
  }
  function navigate(url: string) {
    try {
      const target = browserUrl(url)
      setAddress(target)
      setLastUrl(target)
      setError('')
      if (source) void command('navigate', target)
      else setSource(target)
    } catch (e) {
      setError(String(e))
    }
  }
  function saveNotes(next: Note[]) {
    try {
      localStorage.setItem(key, JSON.stringify(next))
      setNotes(next)
    } catch {
      setError(
        'Impossible d’enregistrer les notes ; votre saisie est conservée.',
      )
      return false
    }
    return true
  }
  const changed = (next: SurfaceState) => {
    setState(next)
    if (next.url && next.url !== state?.url) {
      setLastUrl(next.url)
      setAddress(next.url)
    }
  }
  return (
    <Panel
      title="Navigateur"
      icon="globe"
      onClose={async () => {
        if ((text || quote) && !await ask({ title: 'Abandonner la note non enregistrée ?', confirmLabel: 'Abandonner la note', danger: true }))
          return
        if (
          state?.downloads.some((d) => d.status === 'progressing') &&
          !await ask({ title: 'Fermer le navigateur ?', message: 'Les téléchargements en cours seront annulés.', confirmLabel: 'Fermer et annuler les téléchargements', danger: true })
        )
          return
        setText('')
        setQuote('')
        onClose()
      }}
      padded={false}
      scroll={false}
    >
      <div className="browser-panel">
        <form
          className="browser-address"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(address)
          }}
        >
          <input
            aria-label="Adresse du navigateur"
            placeholder="Adresse web ou http://localhost:3000"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <button type="submit">Ouvrir</button>
        </form>
        <div className="browser-toolbar">
          <button
            type="button"
            aria-label="Page précédente"
            disabled={!state?.back}
            onClick={() => void command('back')}
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Page suivante"
            disabled={!state?.forward}
            onClick={() => void command('forward')}
          >
            →
          </button>
          <button
            type="button"
            disabled={!source}
            onClick={() => void command(state?.loading ? 'stop' : 'reload')}
          >
            {state?.loading ? 'Arrêter' : 'Recharger'}
          </button>
          <button
            type="button"
            disabled={!state?.url}
            onClick={() => void command('external')}
          >
            Ouvrir à l’extérieur
          </button>
          <button
            type="button"
            aria-pressed={tools === 'notes'}
            onClick={() => setTools(tools === 'notes' ? null : 'notes')}
          >
            Notes ({notes.length})
          </button>
          <button
            type="button"
            aria-pressed={tools === 'downloads'}
            onClick={() => setTools(tools === 'downloads' ? null : 'downloads')}
          >
            Téléchargements ({state?.downloads.length ?? 0})
          </button>
        </div>
        {(error || state?.error) && (
          <p className="file-error" role="alert">
            {error || state?.error}
          </p>
        )}
        {state?.permission && (
          <p className="reader-info" role="status">
            {state.permission}
          </p>
        )}
        {tools === 'notes' && (
          <section className="browser-tools" aria-label="Notes de navigation">
            <button
              type="button"
              disabled={!state?.url}
              onClick={() => {
                void command('selection').then((value) => {
                  setQuote(value?.text ?? '')
                  setQuoteUrl(value?.url ?? '')
                })
              }}
            >
              Reprendre le texte sélectionné
            </button>
            {quote && <blockquote>{quote}</blockquote>}
            <textarea
              aria-label="Nouvelle note"
              placeholder="Note sur cette page…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={4000}
            />
            <button
              type="button"
              disabled={!state?.url || !text.trim() || notes.length >= 100}
              onClick={() => {
                if (
                  saveNotes([
                    {
                      id: crypto.randomUUID(),
                      url: quote ? quoteUrl : state!.url,
                      quote,
                      text: text.trim(),
                      createdAt: Date.now(),
                    },
                    ...notes,
                  ])
                ) {
                  setText('')
                  setQuote('')
                }
              }}
            >
              Enregistrer la note
            </button>
            {notes.length >= 100 && (
              <p>Limite de 100 notes par projet atteinte.</p>
            )}
            {notes.map((note) => (
              <article key={note.id}>
                <button
                  type="button"
                  className="note-source"
                  title={note.url}
                  onClick={() => navigate(note.url)}
                >
                  {note.url}
                </button>
                {note.quote && <blockquote>{note.quote}</blockquote>}
                <p>{note.text}</p>
                <button
                  type="button"
                  onClick={async () => {
                    if (await ask({ title: 'Supprimer cette note ?', confirmLabel: 'Supprimer la note', danger: true }))
                      saveNotes(notes.filter((n) => n.id !== note.id))
                  }}
                >
                  Supprimer la note
                </button>
              </article>
            ))}
          </section>
        )}
        {tools === 'downloads' && (
          <section className="browser-tools" aria-label="Téléchargements">
            {!state?.downloads.length && (
              <p>Aucun téléchargement dans ce panneau.</p>
            )}
            {state?.downloads.map((d) => (
              <article key={d.id}>
                <strong>{d.name}</strong>
                <p>
                  {Math.round(d.received / 1024)} Ko
                  {d.total > 0 && ` / ${Math.round(d.total / 1024)} Ko`} ·{' '}
                  {d.status === 'completed'
                    ? 'Terminé'
                    : d.status === 'cancelled'
                      ? 'Annulé'
                      : d.status === 'interrupted'
                        ? 'Interrompu'
                        : d.paused
                          ? 'En pause'
                          : 'En cours'}
                </p>
                {d.status === 'progressing' && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void command(
                          d.paused ? 'resume-download' : 'pause-download',
                          d.id,
                        )
                      }
                    >
                      {d.paused ? 'Reprendre' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void command('cancel-download', d.id)}
                    >
                      Annuler
                    </button>
                  </>
                )}
                {d.status === 'completed' && (
                  <button
                    type="button"
                    onClick={() => void command('reveal-download', d.id)}
                  >
                    Afficher dans le dossier
                  </button>
                )}
              </article>
            ))}
          </section>
        )}
        {state && (
          <div className="browser-status" role="status" title={state.title}>
            {state.loading ? 'Chargement…' : state.title}
          </div>
        )}
        {!source ? (
          <div className="panel-pad">
            <p>
              Saisissez une adresse pour consulter un site ou l’aperçu local de
              votre projet.
            </p>
            <p className="reader-info">
              Les notes sont conservées pour ce projet. La navigation utilise un
              profil temporaire ; les sites n’accèdent pas aux outils de l’application
              Code.
            </p>
          </div>
        ) : (
          <WebSurface
            id={id}
            source={{ kind: 'web', url: source }}
            onState={changed}
            hidden={Boolean(state?.error)}
          />
        )}
      </div>
    </Panel>
  )
}
