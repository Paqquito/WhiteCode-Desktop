import * as React from 'react'
import { SettingsPage } from '../ui/SettingRows.js'
import type { ActivityPeriod, PersonalActivity } from '../../shared/personalActivity.js'

export function ActivitySettings() {
  const [period, setPeriod] = React.useState<ActivityPeriod>(30)
  const [revision, refresh] = React.useReducer(value => value + 1, 0)
  const [loaded, setResult] = React.useState<PersonalActivity | null>(null)
  const result = loaded?.days.length === period ? loaded : null
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState('')
  const maximum = Math.max(1, ...result?.days.map(day => day.messages) ?? [])
  React.useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void window.engine.personalActivity(period).then(value => {
      if (active) setResult(value)
    }).catch(error => { if (active) setError(String(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [period, revision])
  return <SettingsPage className="activity-settings" title="Bilan local" lead="Activité des transcriptions conservées sur cet ordinateur, y compris les conversations archivées et les projets retirés de la liste. Ces chiffres ne mesurent ni la qualité du travail ni le temps passé.">
    <div className="activity-controls">
      <label className="preference-field">Période<select value={period} onChange={event => setPeriod(Number(event.target.value) as ActivityPeriod)}><option value={7}>7 derniers jours</option><option value={30}>30 derniers jours</option><option value={90}>90 derniers jours</option></select></label>
      <button type="button" className="ghost" disabled={loading} onClick={refresh}>Actualiser le bilan</button>
    </div>
    <p className="settings-note">Aujourd’hui inclus, selon le fuseau de cet ordinateur : {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
    {loading && <p role="status">Lecture de l’historique local…</p>}
    {error && <p className="settings-error" role="alert">{error} Réessayez avec « Actualiser le bilan ».</p>}
    {result && <>
      <dl className="activity-totals"><div><dt>Conversations actives</dt><dd>{result.sessions}</dd></div><div><dt>Messages utilisateur</dt><dd>{result.messages}</dd></div><div><dt>Jours actifs</dt><dd>{result.activeDays}</dd></div></dl>
      {result.messages === 0 ? <p role="status">Aucun message utilisateur daté sur cette période. Choisissez une période plus longue ou revenez après une conversation.</p> : <details className="activity-days"><summary>Messages par jour</summary><table><caption>Messages utilisateur dans les transcriptions</caption><thead><tr><th scope="col">Date</th><th scope="col">Messages</th></tr></thead><tbody>{result.days.map(day => <tr key={day.date}><th scope="row">{day.date.split('-').reverse().join('/')}</th><td><meter min={0} max={maximum} value={day.messages} aria-label={`${day.date} : ${day.messages} messages`} /> {day.messages}</td></tr>)}</tbody></table></details>}
      {(result.unreadableFiles > 0 || result.ignoredEntries > 0) && <p role="status">Bilan partiel : {result.unreadableFiles} fichier(s) ou dossier(s) illisible(s), {result.ignoredEntries} entrée(s) invalide(s) ou non datée(s) ignorée(s).</p>}
      <p className="settings-note">Mis à jour à {new Date(result.generatedAt).toLocaleTimeString('fr-FR')}. Les messages techniques et sous-tâches sont exclus. Un historique copié dans une conversation dérivée est compté dans chaque transcription.</p>
    </>}
  </SettingsPage>
}
