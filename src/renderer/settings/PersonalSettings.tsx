import * as React from 'react'
import { DEFAULT_PREFERENCES, type Preferences } from '../../shared/preferences.js'
import { usePreferences } from '../state/usePreferences.js'
import { ask } from '../ui/confirm.js'
import { Icon } from '../ui/Icon.js'
import { Group, SelectRow, SwitchRow } from '../ui/SettingRows.js'
import { BRAND } from '../brand.js'

export type PersonalTab = 'general' | 'appearance' | 'notifications' | 'shortcuts' | 'modules'

const TITLES: Record<PersonalTab, { title: string; lead: string }> = {
  general: { title: 'Général', lead: 'Comportement par défaut des conversations, du terminal et de la fenêtre.' },
  appearance: { title: 'Apparence', lead: 'Thème, polices et tailles de texte de l’application.' },
  notifications: { title: 'Notifications', lead: `Quand ${BRAND.product} vous prévient qu’une conversation a besoin de vous.` },
  shortcuts: { title: 'Raccourcis', lead: 'Raccourcis clavier de navigation dans l’application.' },
  modules: { title: 'Modules optionnels', lead: 'Compléments à activer selon vos besoins. Ces choix restent sur cet ordinateur.' },
}

/**
 * Préférences personnelles, communes à toutes les conversations.
 *
 * **Appliquées dès qu'on les change** (décision UX-50) : un thème, une taille
 * de police ou un interrupteur de notification se règle en regardant son
 * effet, pas en remplissant un formulaire. L'enregistrement explicite reste
 * réservé à ce qui touche un compte ou un secret (Fournisseur, Connexions,
 * connecteurs).
 *
 * Le contrôle bascule aussitôt ; l'écriture sur disque suit. Si elle échoue,
 * la valeur précédente revient et l'erreur dit pourquoi — un réglage affiché
 * qui ne serait pas enregistré mentirait au prochain lancement.
 */
export function PersonalSettings({ section }: { section: PersonalTab }) {
  const prefs = usePreferences()
  const [draft, setDraft] = React.useState(prefs.value)
  const saved = React.useRef(prefs.value)
  const inFlight = React.useRef(0)
  const [notice, setNotice] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [testing, setTesting] = React.useState(false)
  // Suit les valeurs enregistrées tant que rien n'est en cours d'écriture :
  // premier chargement, ou retour de l'écriture précédente.
  React.useEffect(() => { if (inFlight.current === 0) { setDraft(prefs.value); saved.current = prefs.value } }, [prefs.value])
  React.useEffect(() => {
    if (notice?.tone !== 'ok') return
    const timer = window.setTimeout(() => setNotice(n => (n === notice ? null : n)), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Dernière valeur voulue, connue sans attendre le rendu : deux réglages
  // changés coup sur coup ne doivent pas s'écraser l'un l'autre.
  const latest = React.useRef(prefs.value)
  const base = () => (inFlight.current === 0 ? prefs.value : latest.current)
  const commit = async (next: Preferences) => {
    latest.current = next
    setDraft(next); setNotice(null)
    inFlight.current++
    try { await prefs.save(next); saved.current = next; setNotice({ tone: 'ok', text: 'Enregistré' }) }
    catch (error) {
      latest.current = saved.current
      setDraft(saved.current)
      setNotice({ tone: 'error', text: `Enregistrement impossible (${String(error).replace(/^Error: /, '')}). Le réglage précédent est rétabli.` })
    }
    finally { inFlight.current-- }
  }
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) => void commit({ ...base(), [key]: value })
  const notify = (key: keyof Preferences['notifications'], value: boolean) => set('notifications', { ...base().notifications, [key]: value })
  const reset = async () => {
    const accepted = await ask({
      title: 'Rétablir toutes les préférences ?',
      message: 'Général, apparence, notifications, raccourcis et modules reviennent à leurs valeurs par défaut, sur tous les écrans.',
      confirmLabel: 'Rétablir les valeurs par défaut',
      danger: true,
    })
    if (accepted) await commit(DEFAULT_PREFERENCES)
  }
  const test = async () => {
    setTesting(true); setNotice({ tone: 'ok', text: 'Test dans 3 secondes : passez sur une autre fenêtre.' })
    try { await window.engine.testNotification(); setNotice({ tone: 'ok', text: 'Notification remise au système.' }) }
    catch (error) { setNotice({ tone: 'error', text: String(error) }) }
    finally { setTesting(false) }
  }
  const windows = prefs.platform === 'win32'
  const loginItems = windows || prefs.platform === 'darwin'
  const head = TITLES[section]

  return <div className="settings-body settings-page personal-settings" data-section={section}>
    <header className="settings-page-head">
      <div><h3>{head.title}</h3><p>{head.lead}</p></div>
      <p role="status" className={notice?.tone === 'ok' ? 'settings-saved visible' : 'settings-saved'}>
        {notice?.tone === 'ok' && <><Icon name="check" size={13} />{notice.text}</>}
      </p>
    </header>
    {!prefs.ready && <p role="status" className="settings-note">Chargement des préférences…</p>}
    {notice?.tone === 'error' && <p className="settings-error" role="alert">{notice.text}</p>}
    {/* Pas désactivé pendant l'écriture : un fieldset désactivé retire le
        focus du contrôle qu'on vient d'utiliser. */}
    <fieldset disabled={!prefs.ready}>
      {section === 'general' && <>
        <Group title="Conversations">
          <SelectRow
            title="Mode des nouvelles conversations"
            hint="Niveau d’autorisation appliqué à l’ouverture d’une conversation. « Ignorer les permissions » ne peut pas devenir un défaut."
            value={draft.newSessionMode}
            onChange={v => set('newSessionMode', v as Preferences['newSessionMode'])}
            options={[['inherit', 'Reprendre le mode en cours'], ['default', 'Manuel'], ['acceptEdits', 'Accepter les modifications'], ['plan', 'Plan'], ['dontAsk', 'Sans interruption']]}
          />
          <SelectRow
            title="Envoyer un message avec"
            hint="Maj + Entrée insère toujours un saut de ligne."
            value={draft.sendMode}
            onChange={v => set('sendMode', v as Preferences['sendMode'])}
            options={[['enter', 'Entrée'], ['mod-enter', 'Ctrl / ⌘ + Entrée']]}
          />
          <SwitchRow
            title="Afficher l’occupation du contexte"
            hint="Jauge du composeur indiquant la part de la fenêtre de contexte déjà utilisée par la conversation."
            checked={draft.contextGauge}
            onChange={v => set('contextGauge', v)}
          />
        </Group>
        <Group title="Terminal">
          <SelectRow
            title="Shell du terminal intégré"
            hint="S’applique aux prochains terminaux ouverts. Un shell absent de ce poste est remplacé par celui du système."
            value={draft.terminalShell}
            onChange={v => set('terminalShell', v as Preferences['terminalShell'])}
            options={windows
              ? [['system', 'Shell du système'], ['powershell', 'Windows PowerShell'], ['pwsh', 'PowerShell 7'], ['cmd', 'Invite de commandes'], ['bash', 'Git Bash']]
              : [['system', 'Shell du système'], ['bash', 'Bash'], ['pwsh', 'PowerShell 7']]}
          />
        </Group>
        <Group title="Application">
          <SelectRow
            title="Langue de l’interface"
            hint="L’interface est actuellement disponible en français."
            value="fr"
            disabled
            onChange={() => {}}
            options={[['fr', 'Français']]}
          />
          {loginItems && <SwitchRow
            title="Ouvrir à la connexion"
            hint={windows ? `Lance ${BRAND.product} à l’ouverture de votre session Windows.` : `Lance ${BRAND.product} à l’ouverture de votre session.`}
            checked={draft.launchAtLogin}
            onChange={v => set('launchAtLogin', v)}
          />}
          <SelectRow
            title="Confirmer avant de fermer la fenêtre"
            hint="Fermer pendant une réponse interrompt la réponse en cours. Les conversations restent enregistrées."
            value={draft.confirmClose}
            onChange={v => set('confirmClose', v as Preferences['confirmClose'])}
            options={[['busy', 'Si une réponse est en cours'], ['always', 'Toujours'], ['never', 'Jamais']]}
          />
        </Group>
      </>}

      {section === 'appearance' && <>
        <Group title="Affichage">
          <SelectRow title="Thème" hint="« Suivre le système » bascule avec le mode clair ou sombre de Windows." value={draft.theme} onChange={v => set('theme', v as Preferences['theme'])} options={[['system', 'Suivre le système'], ['light', 'Clair'], ['dark', 'Sombre']]} />
          <SwitchRow title="Réduire les animations" hint="Supprime les transitions et les mouvements de l’interface." checked={draft.reducedMotion} onChange={v => set('reducedMotion', v)} />
        </Group>
        <Group title="Texte">
          <SelectRow title="Police de l’interface" value={draft.interfaceFont} onChange={v => set('interfaceFont', v as Preferences['interfaceFont'])} options={[['system', 'Police du système'], ['sans', 'Arial / Helvetica']]} />
          <SelectRow title="Taille du texte des conversations" value={String(draft.textSize)} onChange={v => set('textSize', Number(v) as Preferences['textSize'])} options={[['13', 'Petite · 13 px'], ['15', 'Moyenne · 15 px'], ['17', 'Grande · 17 px']]} />
          <SelectRow title="Police du code et du terminal" value={draft.codeFont} onChange={v => set('codeFont', v as Preferences['codeFont'])} options={[['system', 'Monospace du système'], ['mono', 'DejaVu Sans Mono / Courier New']]} />
          <SelectRow title="Taille du code et du terminal" value={String(draft.codeSize)} onChange={v => set('codeSize', Number(v) as Preferences['codeSize'])} options={[['12', 'Petite · 12 px'], ['14', 'Moyenne · 14 px'], ['16', 'Grande · 16 px']]} />
        </Group>
        <div className="preference-sample" aria-label="Aperçu">
          <p style={{ fontSize: draft.textSize }}>Une conversation agréable à lire.</p>
          <code style={{ fontSize: draft.codeSize }}>const projet = 'WhiteCode'</code>
        </div>
      </>}

      {section === 'notifications' && <>
        <Group title="Notifications système">
          <SwitchRow title="Activer les notifications système" hint="Les notifications ne contiennent ni le titre ni le texte des conversations." checked={draft.notifications.enabled} onChange={v => notify('enabled', v)} />
          <SwitchRow title="Uniquement lorsque l’application est en arrière-plan" checked={draft.notifications.backgroundOnly} disabled={!draft.notifications.enabled} onChange={v => notify('backgroundOnly', v)} />
          <SwitchRow title="Autoriser le son des notifications" hint="Le système garde la main sur le volume et le mode Ne pas déranger." checked={draft.notifications.sound} disabled={!draft.notifications.enabled} onChange={v => notify('sound', v)} />
        </Group>
        <Group title="Me prévenir quand">
          <SwitchRow title="Une réponse est terminée" checked={draft.notifications.done} disabled={!draft.notifications.enabled} onChange={v => notify('done', v)} />
          <SwitchRow title="Une autorisation est attendue" checked={draft.notifications.waiting} disabled={!draft.notifications.enabled} onChange={v => notify('waiting', v)} />
          <SwitchRow title="Une erreur est survenue" checked={draft.notifications.failed} disabled={!draft.notifications.enabled} onChange={v => notify('failed', v)} />
        </Group>
        <Group title="Vérification">
          <div className="setting-row">
            <div className="setting-label">
              <span className="setting-title">Envoyer une notification de test</span>
            </div>
            <p className="setting-hint">{!prefs.notificationsSupported ? 'Les notifications natives ne sont pas disponibles sur ce poste.' : 'Envoyée 3 secondes après le clic, pour laisser le temps de changer de fenêtre.'}</p>
            <button type="button" className="setting-control" disabled={testing || prefs.saving || !prefs.value.notifications.enabled || !prefs.notificationsSupported} onClick={() => void test()}>{testing ? 'Test en cours…' : 'Tester dans 3 secondes'}</button>
          </div>
        </Group>
      </>}

      {section === 'shortcuts' && <>
        <Group title="Navigation">
          <SwitchRow title="Activer les raccourcis de navigation" hint="Inactifs dans les dialogues et le terminal. Les commandes d’édition restent disponibles." checked={draft.shortcuts} onChange={v => set('shortcuts', v)} />
        </Group>
        <Group title="Liste des raccourcis">
          <dl className="shortcut-list">
            {SHORTCUTS.map(([action, keys]) => <div key={action} className="shortcut-row"><dt>{action}</dt><dd>{keys.map(key => <kbd key={key}>{key}</kbd>)}</dd></div>)}
          </dl>
        </Group>
      </>}

      {section === 'modules' && <>
        <Group title="Disponibles">
          <SwitchRow title="Activer le bilan d’activité local" hint="Ajoute l’onglet Bilan local : messages, conversations et jours actifs. Lecture à la demande, sans envoi à un modèle." checked={draft.modules.activity} onChange={activity => set('modules', { ...base().modules, activity })} />
        </Group>
        <Group title="Pas encore disponibles">
          <div className="setting-row optional-unavailable"><div className="setting-label"><span className="setting-title">Publication de sites · Différée</span></div><p className="setting-hint">Aucun hébergeur ni service de publication n’est intégré. La création de fichiers et leur aperçu local restent accessibles dans la conversation.</p></div>
          <div className="setting-row optional-unavailable"><div className="setting-label"><span className="setting-title">Travail bureautique spécialisé · Différé</span></div><p className="setting-hint">La vue Chat classe vos conversations. Elle ne fournit pas de mode Cowork isolé, d’exécution cloud ou de contrôle distant. Les fichiers, permissions et lecteurs documentaires existants restent disponibles ; les aperçus bureautiques nécessitent LibreOffice.</p></div>
        </Group>
      </>}
    </fieldset>

    <div className="settings-page-foot">
      <button type="button" className="ghost" disabled={!prefs.ready || prefs.saving} onClick={() => void reset()}>Rétablir toutes les préférences</button>
      <span className="settings-note">Préférences conservées sur cet ordinateur.</span>
    </div>
  </div>
}

const SHORTCUTS: Array<[string, string[]]> = [
  ['Ouvrir les paramètres', ['Ctrl / ⌘', ',']],
  ['Nouvelle conversation', ['Ctrl / ⌘', 'Maj', 'N']],
  ['Afficher ou masquer la barre latérale', ['Ctrl / ⌘', 'B']],
  ['Afficher ou masquer le terminal', ['Ctrl / ⌘', 'Maj', 'J']],
  ['Enregistrer un fichier', ['Ctrl / ⌘', 'S']],
  ['Ajouter un commentaire de revue', ['Ctrl / ⌘', 'Entrée']],
  ['Fermer un dialogue', ['Échap']],
]
