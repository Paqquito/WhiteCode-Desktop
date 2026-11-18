import { PersonalSettings, type PersonalTab } from './PersonalSettings.js'
import { ActivitySettings } from './ActivitySettings.js'
import { usePreferences } from '../state/usePreferences.js'
/**
 * Paramètres.
 *
 * En dialogue et non en panneau : ce sont des réglages qu'on ouvre rarement et
 * qu'on referme aussitôt. Leur donner une colonne permanente prendrait de la
 * place à la conversation pour un contenu qu'on regarde quelques fois par mois.
 *
 * Ce qui se décide à chaque message — mode, modèle, effort — reste dans le
 * composeur ; ce qui se décide une fois pour toutes vit ici.
 *
 * ## `<dialog>` natif, et non un `div` avec `role="dialog"`
 *
 * C'était l'inverse jusqu'ici : un calque et un gestionnaire de touche écrits à
 * la main. Ils reproduisaient l'apparence d'un dialogue sans en reproduire le
 * comportement — pas de **piège de focus**, donc la tabulation sortait de
 * l'écran des réglages pour parcourir la conversation derrière, sans que rien
 * ne le montre.
 *
 * L'élément natif donne gratuitement ce qui manquait : le piège de focus,
 * `Esc`, l'inertie de l'arrière-plan, et la **restitution du focus** à ce qui
 * l'avait avant — c'est-à-dire au composeur, ce que demandait le reste de D05.
 *
 * Le sens de l'unification n'allait pas de soi. Routines et Paramètres se
 * ressemblaient mal ; le réflexe aurait été d'aligner le nouveau sur l'ancien.
 * C'est Routines qui était déjà natif, donc c'est Paramètres qui vient à lui.
 */

import { NativeSettings, nativeSettings, nativeId } from '../nativeViews.js'
import * as React from 'react'
import type { useCorpora } from '../state/useCorpora.js'
import type { useExtensions } from '../state/useExtensions.js'
import type { useProvider } from '../state/useProvider.js'
import { Icon, type IconName } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'
import { CorpusSettings } from './CorpusSettings.js'
import { ModelSettings } from './ModelSettings.js'
import { ProviderSettings } from './ProviderSettings.js'
import { McpSettings } from './McpSettings.js'
import { ArchivedSettings } from './ArchivedSettings.js'
import { ExtensionSettings } from './ExtensionSettings.js'
import { SkillsSettings } from './SkillsSettings.js'
import type { Project, SessionSummary } from '../../main/preload.js'
import { BRAND } from '../brand.js'

export type Tab = `module:${string}` | PersonalTab | 'activity' | 'provider' | 'models' | 'corpus' | 'plugins' | 'skills' | 'mcp' | 'archived'

/**
 * Les onglets, rangés par ce qu'ils règlent. Treize entrées à plat obligeaient
 * à relire toute la colonne ; les groupes donnent un premier tri en un regard.
 */
const GROUPS: Array<{ label: string; tabs: Array<{ id: Tab; label: string; icon: IconName }> }> = [
  { label: 'Personnel', tabs: [
    { id: 'general', label: 'Général', icon: 'settings' },
    { id: 'appearance', label: 'Apparence', icon: 'sun' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
    { id: 'shortcuts', label: 'Raccourcis', icon: 'lightning' },
  ] },
  { label: 'Intelligence', tabs: [
    { id: 'provider', label: 'Fournisseur', icon: 'options' },
    { id: 'models', label: 'Modèles locaux', icon: 'brain' },
    { id: 'corpus', label: 'Bases de connaissances', icon: 'database' },
  ] },
  // Le vocabulaire de Claude et de ChatGPT : on installe des plugins, qui
  // apportent des skills (des savoir-faire) et des connecteurs (des accès).
  { label: 'Personnalisation', tabs: [
    { id: 'plugins', label: 'Plugins', icon: 'extension' },
    { id: 'skills', label: 'Skills', icon: 'lightning' },
    { id: 'mcp', label: 'Connecteurs', icon: 'plugin' },
  ] },
  { label: 'Intégrations', tabs: nativeSettings.map(entry => ({ id: nativeId(entry.id), label: entry.views.label, icon: 'plugin' })) },
  { label: 'Données', tabs: [
    { id: 'modules', label: 'Modules optionnels', icon: 'plugin' },
    { id: 'activity', label: 'Bilan local', icon: 'history' },
    { id: 'archived', label: 'Conversations archivées', icon: 'archive' },
  ] },
]
/**
 * Sous-pages : le compte d'un connecteur se règle depuis ce connecteur, pas
 * depuis un onglet à lui. La navigation les rattache à leur parent.
 */
const SUBPAGES: Array<{ id: Tab; label: string; icon: IconName; parent: Tab }> = [
]
const TABS = [...GROUPS.flatMap(group => group.tabs), ...SUBPAGES]

/**
 * Ce que chaque écran règle, pour la recherche : on cherche « thème » ou
 * « jeton », pas le nom de l'onglet qui le contient.
 */
const KEYWORDS: Record<Tab, string> = {
  general: 'mode permissions nouvelles conversations envoyer entrée message contexte jauge terminal shell powershell bash cmd langue ouvrir connexion démarrage fermer fenêtre',
  appearance: 'thème sombre clair système police taille texte code terminal animations mouvements',
  notifications: 'notifications son arrière-plan réponse terminée autorisation erreur tester',
  shortcuts: 'raccourcis clavier touches navigation',
  modules: 'modules optionnels bilan publication bureautique',
  activity: 'bilan activité statistiques messages jours',
  provider: 'fournisseur relais passerelle openai ollama llama.cpp outils réduits',
  models: 'modèles locaux télécharger installer hugging face llama.cpp llama-server gguf mise en service emplacement',
  corpus: 'bases de connaissances corpus index indexer documents dossier recherche rag',
  plugins: 'plugins extensions installer catalogue bureautique office word excel powerpoint pdf sources',
  skills: 'skills compétences savoir-faire instructions',
  mcp: 'connecteurs connexions mcp serveurs outils clé api',
  archived: 'archives conversations archivées restaurer retrouver',
}

/** Comparaison sans casse ni accents : « theme » trouve « Thème ». */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

export function SettingsDialog({
  provider,
  corpora,
  extensions,
  reducedTools,
  onReducedTools,
  mcpServers,
  onMcpServers,
  projects,
  onUnarchive,
  onOpenSession,
  initialTab = 'general',
  onClose,
}: {
  /** Onglet ouvert d'emblée — « + Ajouter » du sélecteur mène aux modèles. */
  initialTab?: Tab
  provider: ReturnType<typeof useProvider>
  corpora: ReturnType<typeof useCorpora>
  extensions: ReturnType<typeof useExtensions>
  reducedTools: boolean
  onReducedTools: (reduced: boolean) => void
  mcpServers?: string[] | null
  onMcpServers: (ids: string[] | null) => void
  projects: Project[]
  onUnarchive: (session: SessionSummary, project: Project) => void
  onOpenSession: (session: SessionSummary, project: Project) => void
  onClose: () => void
}): React.ReactNode {
  const [tab, setTab] = React.useState<Tab>(initialTab)
  const prefs = usePreferences()
  const [search, setSearch] = React.useState('')
  const matches = (entry: { id: Tab; label: string }) => !search.trim() || fold(`${entry.label} ${KEYWORDS[entry.id] ?? ''}`).includes(fold(search.trim()))
  const parent = SUBPAGES.find(page => page.id === tab)
  const visible = (id: Tab) => (id !== 'activity' || prefs.value.modules.activity) && (id === tab || id === parent?.parent || matches(TABS.find(entry => entry.id === id)!))
  const found = TABS.filter(entry => entry.id !== tab && !SUBPAGES.includes(entry as never) && visible(entry.id))
  const panel = React.useRef<HTMLDivElement>(null)
  // Chaque onglet s'ouvre en haut : garder le défilement du précédent posait
  // l'utilisateur au milieu d'un écran qu'il n'avait pas encore vu.
  React.useEffect(() => { panel.current?.scrollTo?.({ top: 0 }) }, [tab])
  const personalTab = ['general', 'appearance', 'notifications', 'shortcuts', 'modules'].includes(tab)
  React.useEffect(() => {
    if (tab === 'activity' && !prefs.value.modules.activity) setTab('modules')
  }, [tab, prefs.value.modules.activity])
  // Les préférences personnelles s'enregistrent dès qu'on les change : fermer
  // ne peut rien faire perdre, il n'y a plus rien à confirmer.
  const close = onClose
  const dialog = React.useRef<HTMLDialogElement>(null)

  React.useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => {
      dialog.current?.close()
      // Le composeur retrouve le focus : sans ce retour, la frappe suivante
      // partait dans le vide après la fermeture des réglages (reste de D05).
      precedent?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialog}
      className="settings"
      aria-label="Paramètres"
      // `cancel` est l'événement d'`Esc` sur un dialogue natif ; sans lui, la
      // touche fermerait l'élément sans que React en sache rien, et l'écran
      // reviendrait au rendu suivant.
      onCancel={event => {
        event.preventDefault()
        close()
      }}
      // Un clic sur le fond a pour cible le dialogue lui-même : c'est ainsi
      // qu'on distingue l'extérieur de l'intérieur, sans calque intermédiaire.
      onClick={event => {
        if (event.target === dialog.current) close()
      }}
    >
      <header className="settings-head">
        <h2>Paramètres</h2>
        <IconButton icon="close" size={15} onClick={close} title="Fermer" label="Fermer les paramètres" />
      </header>

      <div className="settings-layout">
        <div className="settings-side">
        <label className="settings-search">
          <Icon name="search" size={13} />
          <input
            type="search"
            value={search}
            placeholder="Rechercher un réglage"
            aria-label="Rechercher un réglage"
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {
              // Entrée ouvre le premier écran trouvé ; Échap vide le champ
              // avant de fermer le dialogue.
              if (event.key === 'Enter' && found[0]) { event.preventDefault(); setTab(found[0].id) }
              if (event.key === 'Escape' && search) { event.preventDefault(); event.stopPropagation(); setSearch('') }
            }}
          />
        </label>
        <nav className="settings-tabs" role="tablist" aria-label="Catégories des paramètres" onKeyDown={event => {
          if (!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
          event.preventDefault()
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1) + buttons.length) % buttons.length
          buttons[next]?.focus(); buttons[next]?.click()
        }}>
          {GROUPS.filter(group => group.tabs.some(entry => visible(entry.id))).map(group => (
            <div key={group.label} className="settings-tab-group" role="presentation">
              <p className="settings-tab-group-label" aria-hidden="true">{group.label}</p>
              {group.tabs.filter(entry => visible(entry.id)).map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.id || parent?.parent === entry.id}
                  tabIndex={tab === entry.id || parent?.parent === entry.id ? 0 : -1}
                  className={tab === entry.id || parent?.parent === entry.id ? 'settings-tab active' : 'settings-tab'}
                  onClick={() => setTab(entry.id)}
                >
                  <Icon name={entry.icon} size={15} />
                  <span>{entry.label}</span>
                </button>
              ))}
            </div>
          ))}
          {search.trim() && found.length === 0 && <p className="settings-search-empty" role="status">Aucun réglage ne correspond.</p>}
        </nav>
        </div>

        <div ref={panel} className="settings-panel" role="tabpanel" aria-label={TABS.find(entry => entry.id === tab)?.label}>
          {parent && <button type="button" className="settings-back" onClick={() => setTab(parent.parent)}>
            <Icon name="chevron-right" size={13} />{TABS.find(entry => entry.id === parent.parent)?.label}
          </button>}
          <div hidden={!personalTab}><PersonalSettings section={(personalTab ? tab : 'general') as PersonalTab} /></div>
          {tab.startsWith('module:') && <NativeSettings id={tab.slice(7)} />}
          {tab === 'plugins' && <ExtensionSettings extensions={extensions} onManageConnectors={() => setTab('mcp')} heading={{ title: 'Plugins', lead: `Ce que vous installez pour étendre ${BRAND.product}. Un plugin apporte des skills, des connecteurs ou des agents ; désactivez ceux qui ne vous servent pas.` }} />}
          {tab === 'skills' && <SkillsSettings extensions={extensions} onManagePlugins={() => setTab('plugins')} />}
          {tab === 'activity' && prefs.value.modules.activity && <ActivitySettings />}
          {tab === 'mcp' && <McpSettings selected={mcpServers ?? null} onSelected={onMcpServers} onManagePlugins={() => setTab('plugins')} />}
          {tab === 'provider' && (
            <ProviderSettings
              provider={provider}
              reducedTools={reducedTools}
              onReducedTools={onReducedTools}
            />
          )}
          {tab === 'models' && <ModelSettings providerKind={provider.config.kind} />}
          {tab === 'corpus' && <CorpusSettings corpora={corpora} />}
          {tab === 'archived' && (
            <ArchivedSettings
              projects={projects}
              onUnarchive={onUnarchive}
              onOpen={(session, project) => {
                onOpenSession(session, project)
                onClose()
              }}
            />
          )}
        </div>
      </div>
    </dialog>
  )
}
