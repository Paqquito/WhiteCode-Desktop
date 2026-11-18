import * as React from 'react'
import { dueRoutines, nextRunAt } from '../../main/routines/routines.js'
import type { Routine, RoutineRun } from '../../main/preload.js'
import { ask } from '../ui/confirm.js'
import { Dialog } from '../ui/Dialog.js'
import { IconButton } from '../ui/IconButton.js'
import { when } from '../ui/when.js'

const CADENCES = [
  { label: 'Chaque jour à 9 h', cron: '0 9 * * *' },
  { label: 'Chaque lundi à 9 h', cron: '0 9 * * 1' },
  { label: 'Toutes les heures', cron: '0 * * * *' },
  { label: 'Premier du mois à 8 h', cron: '0 8 1 * *' },
]
const cadence = (cron: string) =>
  CADENCES.find((c) => c.cron === cron)?.label ?? `Personnalisé : ${cron}`
function nextLabel(routine: Routine): string {
  if (routine.paused) return 'En pause'
  if (dueRoutines([routine], Date.now()).length)
    return 'En attente de rattrapage'
  const next = nextRunAt(routine, Date.now())
  return next === null
    ? 'Aucune échéance valide'
    : `Prochaine : ${when(next)}`
}
export function RoutinesDialog({
  cwd,
  onClose,
  onOpenSession,
}: {
  cwd: string
  onClose: () => void
  onOpenSession?: (id: string) => void
}): React.ReactNode {
  const [routines, setRoutines] = React.useState<Routine[]>([])
  const [history, setHistory] = React.useState<RoutineRun[]>([])
  const [cron, setCron] = React.useState('0 9 * * *')
  const [prompt, setPrompt] = React.useState('')
  const [recurring, setRecurring] = React.useState(true)
  const [editing, setEditing] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [query, setQuery] = React.useState('')
  const [advanced, setAdvanced] = React.useState(false)
  const [tab, setTab] = React.useState<'routines' | 'history'>('routines')
  const lock = React.useRef(false)
  const dirty =
    prompt.trim() !== '' ||
    editing !== null ||
    cron !== '0 9 * * *' ||
    !recurring
  async function close() {
    if (!busy && (!dirty || await ask({ title: 'Abandonner les modifications de la routine ?', confirmLabel: 'Abandonner les modifications', danger: true })))
      onClose()
  }
  const refresh = React.useCallback(async () => {
    const [tasks, runs] = await Promise.all([
      window.engine.listRoutines(cwd),
      window.engine.routineHistory(cwd),
    ])
    setRoutines(tasks)
    setHistory(runs)
  }, [cwd])
  React.useEffect(() => {
    let active = true
    void refresh()
      .catch((e) => active && setError(String(e)))
      .finally(() => active && setLoading(false))
    const timer = setInterval(() => {
      void refresh().catch((e) => active && setError(String(e)))
    }, 15000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [refresh])
  async function action(run: () => Promise<unknown>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await run()
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  function reset() {
    setEditing(null)
    setPrompt('')
    setCron('0 9 * * *')
    setRecurring(true)
    setAdvanced(false)
  }
  const draftNext = nextRunAt(
    { id: 'draft', cron, prompt, recurring, createdAt: Date.now() },
    Date.now(),
  )
  const matches = routines.filter((r) =>
    r.prompt.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  return (
    <Dialog title="Routines" className="dialog routines-dialog" onClose={() => void close()} dismissible={!busy}>
      <p className="dialog-hint">
        Des tâches lancées à heure fixe sur cet ordinateur, pour{' '}
        <strong>{cwd}</strong>, tant que l’application est ouverte.
      </p>
      <details className="routine-help">
        <summary>Comment ça marche</summary>
        <p className="dialog-hint">
          Heure de cet ordinateur : {Intl.DateTimeFormat().resolvedOptions().timeZone}.
          Chaque exécution ouvre sa propre conversation, et une routine attend la
          fin de la précédente avant de repartir. Au redémarrage, une seule
          exécution rattrape les échéances manquées. Aucun service distant.
        </p>
      </details>
      {/* Deux vues, un seul choix : un sélecteur segmenté, comme le catalogue.
          L'actualisation n'est pas une vue : elle passe en icône à côté. */}
      <div className="routine-toolbar">
        <div className="segmented" role="group" aria-label="Vue des routines">
          <button type="button" className={tab === 'routines' ? 'segment active' : 'segment'} aria-pressed={tab === 'routines'} onClick={() => setTab('routines')}>Planification</button>
          <button type="button" className={tab === 'history' ? 'segment active' : 'segment'} aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Historique</button>
        </div>
        <IconButton icon="refresh" disabled={busy || loading} onClick={() => void action(refresh)} title="Actualiser les routines" />
      </div>
      {error && (
        <p role="alert" className="dialog-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Chargement des routines…</p>}
      {tab === 'history' ? (
        <section aria-label="Historique des routines">
          <p className="dialog-hint">
            Les 100 derniers déclenchements. « Conversation lancée » ne signifie pas
            que la tâche a réussi : consultez sa conversation. Un lancement non
            confirmé peut avoir été interrompu ; il n’est pas rejoué
            automatiquement.
          </p>
          {!loading && !history.length && <p>Aucune exécution enregistrée.</p>}
          <ul className="routine-list">
            {history.map((run) => (
              <li key={run.id} className="routine-row">
                <p className="routine-prompt">{run.prompt}</p>
                <p>
                  <time dateTime={new Date(run.firedAt).toISOString()} title={new Date(run.firedAt).toLocaleString('fr-FR')}>{when(run.firedAt)}</time> ·{' '}
                  {run.status === 'completed'
                    ? 'Terminée'
                    : run.status === 'cancelled'
                      ? 'Interrompue'
                      : run.status === 'launched'
                        ? 'Conversation lancée'
                        : run.status === 'failed'
                          ? 'Échec'
                          : 'Lancement non confirmé'}
                </p>
                {run.error && <p className="dialog-error">{run.error}</p>}
                {run.sessionId && onOpenSession && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!dirty || await ask({ title: 'Abandonner les modifications de la routine ?', confirmLabel: 'Abandonner les modifications', danger: true })) {
                        onOpenSession(run.sessionId!)
                        onClose()
                      }
                    }}
                  >
                    Ouvrir la conversation
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <label className="technical-search">
            Rechercher une routine
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!loading && !matches.length && (
            <p className="panel-empty">
              {query
                ? 'Aucune routine ne correspond à la recherche.'
                : 'Aucune routine dans ce projet.'}
            </p>
          )}
          <ul className="routine-list">
            {matches.map((routine) => (
              <li key={routine.id} className="routine-row">
                <div className="routine-head">
                  <strong>{cadence(routine.cron)}</strong>
                  <span>
                    {routine.recurring ? 'Récurrente' : 'Une seule fois'}
                  </span>
                </div>
                <p className="routine-prompt">{routine.prompt}</p>
                <p className="routine-next">{nextLabel(routine)}</p>
                <div className="routine-toolbar">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      if (dirty && !await ask({ title: 'Abandonner les modifications de la routine ?', confirmLabel: 'Abandonner les modifications', danger: true }))
                        return
                      setEditing(routine.id)
                      setPrompt(routine.prompt)
                      setCron(routine.cron)
                      setRecurring(Boolean(routine.recurring))
                      setAdvanced(
                        !CADENCES.some((c) => c.cron === routine.cron),
                      )
                      document.getElementById('routine-prompt')?.focus()
                    }}
                  >
                    Modifier
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        window.engine.updateRoutine(cwd, routine.id, {
                          paused: !routine.paused,
                        }),
                      )
                    }
                  >
                    {routine.paused ? 'Reprendre' : 'Mettre en pause'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setRemoving(routine.id)}
                  >
                    Retirer
                  </button>
                </div>
                {removing === routine.id && (
                  <div className="routine-toolbar">
                    <span>
                      Supprimer cette planification ? L’historique reste
                      disponible.
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await window.engine.removeRoutine(cwd, routine.id)
                          setRemoving(null)
                          if (editing === routine.id) reset()
                        })
                      }
                    >
                      Confirmer la suppression
                    </button>
                    <button type="button" onClick={() => setRemoving(null)}>
                      Conserver
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void action(async () => {
                if (editing)
                  await window.engine.updateRoutine(cwd, editing, {
                    cron,
                    prompt,
                    recurring,
                  })
                else
                  await window.engine.addRoutine(cwd, {
                    cron,
                    prompt,
                    recurring,
                  })
                reset()
              })
            }}
          >
            <fieldset className="routine-new" disabled={busy}>
              <legend>
                {editing ? 'Modifier la routine' : 'Nouvelle routine'}
              </legend>
              <label htmlFor="routine-cadence">Rythme</label>
              <select
                id="routine-cadence"
                value={advanced ? 'custom' : cron}
                onChange={(e) => {
                  setAdvanced(e.target.value === 'custom')
                  if (e.target.value !== 'custom') setCron(e.target.value)
                }}
              >
                {CADENCES.map((c) => (
                  <option key={c.cron} value={c.cron}>
                    {c.label}
                  </option>
                ))}
                <option value="custom">Personnalisé (avancé)</option>
              </select>
              {advanced && (
                <label>
                  Expression cron
                  <input
                    value={cron}
                    onChange={(e) => setCron(e.target.value)}
                    spellCheck={false}
                  />
                </label>
              )}
              <p className="routine-next">
                {draftNext === null
                  ? 'Rythme invalide'
                  : `Prochaine : ${when(draftNext)}`}
              </p>
              <label htmlFor="routine-prompt">Invite</label>
              <textarea
                id="routine-prompt"
                value={prompt}
                rows={3}
                placeholder="Ce que la conversation devra faire."
                onChange={(e) => setPrompt(e.target.value)}
              />
              <label className="routine-recurring">
                <input
                  type="checkbox"
                  className="switch"
                  role="switch"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                />
                Rejouer à chaque échéance
              </label>
              <p className="dialog-hint">
                Une reprise ou une modification de cadence repart à partir de
                maintenant, sans rattraper la période de pause.
              </p>
              <div className="routine-toolbar">
                <button
                  type="submit"
                  className="primary"
                  disabled={!prompt.trim() || draftNext === null}
                >
                  {editing ? 'Enregistrer' : 'Ajouter'}
                </button>
                {dirty && (
                  <button type="button" onClick={reset}>
                    Annuler les modifications
                  </button>
                )}
              </div>
            </fieldset>
          </form>
        </>
      )}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={close}>
          Fermer
        </button>
      </div>
    </Dialog>
  )
}
