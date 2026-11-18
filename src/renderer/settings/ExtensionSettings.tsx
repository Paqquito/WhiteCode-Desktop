import * as React from 'react'
import type { ExtensionState } from '../../main/preload.js'
import type { useExtensions } from '../state/useExtensions.js'
import { Icon } from '../ui/Icon.js'
import { skillNames } from '../catalog/skillNames.js'
import { IconButton } from '../ui/IconButton.js'
import { Dialog } from '../ui/Dialog.js'
import { SettingsPage } from '../ui/SettingRows.js'
import type { CatalogueStatus } from '#desktop/plugin-registry'

export function ExtensionSettings({
  extensions,
  heading,
  onManageConnectors,
}: {
  extensions: ReturnType<typeof useExtensions>
  /** Dans les Paramètres, l'écran porte son titre ; dans le catalogue plein écran, le catalogue le porte. */
  heading?: { title: string; lead: string }
  onManageConnectors?: () => void
}): React.ReactNode {
  const [repository, setRepository] = React.useState('')
  const [ref, setRef] = React.useState('HEAD')
  const [filter, setFilter] = React.useState('all')
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState('all')
  const [selected, setSelected] = React.useState<string | null>(null)
  const selectedEntry = extensions.extensions.find(entry => entry.id === selected)
  const matches = (entry: ExtensionState) => `${entry.name} ${entry.summary} ${entry.repository} ${(entry.skills ?? []).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter !== 'installed' || entry.installed) && (filter !== 'skills' || entry.content === 'skill' || Boolean(entry.skills?.length)) && (category === 'all' || (entry.category ?? 'Développement') === category)
  const plugins = extensions.extensions.filter(e => e.kind === 'plugin' && matches(e))
  const [catalogue, setCatalogue] = React.useState<CatalogueStatus | null>(null)
  const [retrying, setRetrying] = React.useState(false)
  React.useEffect(() => {
    let live = true
    void window.engine.extensionCatalogueStatus?.().then(status => { if (live) setCatalogue(status) }, () => {})
    return () => { live = false }
  }, [extensions.extensions])
  const retry = async () => {
    setRetrying(true)
    try { await window.engine.retryExtensionCatalogue(); await extensions.refresh() }
    finally { setRetrying(false); setCatalogue(await window.engine.extensionCatalogueStatus().catch(() => null)) }
  }
  const tools = extensions.extensions.filter(e => e.kind === 'tool' && matches(e))

  const content = (
    <>

      <label className="technical-search">Rechercher une extension<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nom ou description…" /></label>
      <div className="catalog-filters">
        <div className="segmented" role="group" aria-label="Vue du catalogue">
          {/* Dans les Paramètres, les skills ont leur propre onglet : le filtre ferait doublon. */}
          {(heading ? [['all', 'Découvrir'], ['installed', 'Installés']] as const : [['all', 'Découvrir'], ['installed', 'Installés'], ['skills', 'Skills']] as const).map(([value, label]) => <button type="button" key={value} className={filter === value ? 'segment active' : 'segment'} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <div className="catalog-filter-end">
          <label>Catégorie <select value={category} onChange={event => setCategory(event.target.value)}><option value="all">Toutes</option>{[...new Set(['Bureautique', 'Développement', ...extensions.extensions.map(entry => entry.category ?? 'Développement')])].map(value => <option key={value}>{value}</option>)}</select></label>
          <IconButton icon="refresh" disabled={Boolean(extensions.busy) || extensions.loading} onClick={() => void extensions.refresh()} title="Relire les installations" />
        </div>
      </div>
      {catalogue?.error && <div className="settings-callout catalogue-missing" role="status">
        <p>{catalogue.added ? 'Une migration de plugin reste à terminer' : 'Le catalogue officiel de plugins (WhiteCode-Extensions) n’a pas pu être ajouté'} : {catalogue.error}</p>
        {!catalogue.added && <p>Vérifiez votre accès au dépôt GitHub et vos identifiants git, puis réessayez.</p>}
        <button type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? 'Nouvel essai…' : 'Réessayer'}</button>
      </div>}
      {catalogue?.update && <div className="settings-callout" role="status">
        <p>Une nouvelle version du catalogue officiel est disponible dans cette application : {catalogue.update.targetRef}. Votre source utilise {catalogue.update.currentRef}. L’actualisation ajoute les plugins disponibles, sans les installer.</p>
        <button type="button" disabled={Boolean(extensions.busy)} onClick={() => void extensions.refreshSource(catalogue.update!.sourceId, catalogue.update!.targetRef)}>Mettre à jour le catalogue officiel</button>
      </div>}
      {extensions.loading && <p role="status">Lecture des extensions…</p>}
      {extensions.busy && <p role="status">Opération sur le catalogue en cours…</p>}
      {extensions.error && <p role="alert" className="settings-error">{extensions.error}</p>}
      {!extensions.loading && plugins.length + tools.length === 0 && <p role="status">Aucune extension ne correspond à la recherche.</p>}

      <details className="catalog-note">
        <summary>Avant d’activer un plugin</summary>
        <p className="settings-note">
          Un plugin ajoute des compétences, des commandes et des agents au moteur.
          Il s’exécute avec vos droits : n’activez que ce dont vous comprenez
          l’usage. Les extensions activées sont chargées au prochain message.
          Les mises à jour sont validées avant de remplacer la version utilisée.
        </p>
      </details>

      {filter === 'skills' && <p className="settings-note">Les skills sont les compétences d’un plugin. Activez leur plugin pour les utiliser dans une conversation ; les skills d’une source Git sont aussi disponibles ici.</p>}
      <div className="ext-list">
        {plugins.map(entry => <article key={entry.id} className={`ext catalog-card${entry.recommended ? ' recommended' : ''}`}>
          <button type="button" className="catalog-card-open" aria-label={`Ouvrir ${entry.name}`} onClick={() => setSelected(entry.id)} />
          <span className="catalog-icon" aria-hidden="true"><Icon name={entry.category === 'Bureautique' ? 'file' : 'extension'} size={21} /></span>
          <span className="catalog-card-copy"><strong>{entry.name}</strong><span className="ext-summary">{entry.summary}</span>
            <span className="catalog-card-status">{entry.problem ? 'Attention requise' : entry.installed ? (entry.enabled ? 'Activé' : 'Installé') : entry.notice ? 'N’est plus incluse : à installer' : entry.recommended ? 'Recommandé' : 'Disponible'}{Boolean(entry.skills?.length) && ` · ${skillNames(entry.skills!).length} skills`}</span>
          </span>
          {!entry.installed && !entry.problem
            ? <button type="button" className="catalog-card-install" disabled={Boolean(extensions.busy)} onClick={() => void extensions.install(entry.id, entry.sourceId ? undefined : 'HEAD')}>Installer</button>
            : <Icon name="chevron-right" size={16} />}
        </article>)}
      </div>

      {tools.length > 0 && (
        <section className="settings-section">
          <h3>Outils externes</h3>
          <p className="settings-note">
            Ce ne sont pas des plugins : ce sont des programmes que le modèle
            appelle en ligne de commande. Ils s’installent avec leur propre
            gestionnaire de paquets, l’application ne fait que constater leur
            présence.
          </p>
          {tools.map(entry => (
            <ToolRow key={entry.id} entry={entry} />
          ))}
        </section>
      )}
      {selectedEntry && <PluginPanel key={selectedEntry.id} entry={selectedEntry} extensions={extensions} onClose={() => setSelected(null)} onManageConnectors={onManageConnectors} />}
      <details className="extension-sources">
        <summary>Sources du catalogue ({extensions.sources.length})</summary>
        <p className="settings-note">Ajoutez un dépôt contenant un catalogue de plugins, un plugin ou des fichiers SKILL.md. Ajouter une source ne lance et n’active aucune extension.</p>
        <form className="extension-source-form" onSubmit={async event => { event.preventDefault(); if (await extensions.addSource(repository.trim(), ref.trim() || 'HEAD')) setRepository('') }}>
          <label>Dépôt Git<input required disabled={Boolean(extensions.busy)} value={repository} onChange={event => setRepository(event.target.value)} placeholder="organisation/depot ou adresse HTTPS" /></label>
          <label>Branche, tag ou commit<input disabled={Boolean(extensions.busy)} value={ref} onChange={event => setRef(event.target.value)} placeholder="HEAD" /></label>
          <button type="submit" disabled={Boolean(extensions.busy) || !repository.trim()}>Ajouter la source</button>
        </form>
        {extensions.sources.map(source => <SourceRow key={source.id} source={source} extensions={extensions} />)}
      </details>
    </>
  )
  // Un élément, pas un composant défini ici : un composant recréé à chaque
  // rendu démonterait tout le catalogue (saisie, fiche ouverte) à chaque frappe.
  return heading
    ? <SettingsPage title={heading.title} lead={heading.lead}>{content}</SettingsPage>
    : <div className="settings-body">{content}</div>
}

function PluginPanel({ entry, extensions, onClose, onManageConnectors }: { entry: ExtensionState; extensions: ReturnType<typeof useExtensions>; onClose: () => void; onManageConnectors?: () => void }) {
  return <Dialog title={entry.name} className="plugin-panel" onClose={onClose} closeLabel="Fermer la fiche">
      {extensions.error && <p role="alert" className="settings-error">{extensions.error}</p>}
      <ExtensionRow entry={entry} activity={extensions.activity[entry.id]} busy={Boolean(extensions.busy)}
        onInstall={ref => void extensions.install(entry.id, ref)} onUpdate={ref => void extensions.update(entry.id, ref)}
        onDiagnose={() => void extensions.diagnose(entry.id)} onRemove={() => void extensions.remove(entry.id)}
        onToggle={value => void extensions.setEnabled(entry.id, value)} />
      {entry.connector && <section className="settings-callout">
        <p>Ce plugin fournit le connecteur {entry.connector.name}. {entry.enabled ? 'Configurez son compte dans Paramètres → Connecteurs.' : 'Activez le plugin pour configurer son compte et utiliser ses outils.'}</p>
        {entry.enabled && !entry.problem && onManageConnectors && <button type="button" onClick={() => { onClose(); onManageConnectors() }}>Configurer {entry.connector.name}</button>}
      </section>}
  </Dialog>
}

function SkillList({ skills }: { skills: string[] }) {
  const names = skillNames(skills)
  const [expanded, setExpanded] = React.useState(false)
  const id = React.useId()
  if (!names.length) return <p className="settings-note">L’inventaire des skills sera disponible après installation.</p>
  return <section className="plugin-skills"><h3>Skills <span>{names.length}</span></h3>
    <ul id={id} className="catalog-skills">{(expanded ? names : names.slice(0, 5)).map(name => <li key={name}><Icon name="lightning" size={16} /><span>{name}</span></li>)}</ul>
    {names.length > 5 && <button type="button" className="ghost" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{expanded ? 'Voir moins' : `Voir plus (${names.length - 5})`}</button>}
  </section>
}

function SourceRow({ source, extensions }: { source: import('../../main/preload.js').ExtensionSource; extensions: ReturnType<typeof useExtensions> }) {
  const [ref, setRef] = React.useState(source.ref)
  const [removing, setRemoving] = React.useState(false)
  const installed = extensions.extensions.some(entry => entry.sourceId === source.id && entry.installed)
  return <section className="ext extension-source">
    <strong>{source.name}</strong><p>{source.repository}</p>
    <label className="technical-search">Référence de {source.name}<input value={ref} onChange={event => setRef(event.target.value)} disabled={Boolean(extensions.busy)} /></label>
    <p className="settings-note">{source.entries.length} entrées · {source.commit.slice(0, 12)} · Vérifiée le {new Date(source.checkedAt).toLocaleString()}</p>
    <div className="technical-actions">
      <button type="button" disabled={Boolean(extensions.busy)} onClick={() => void extensions.refreshSource(source.id, ref.trim() || 'HEAD')}>Actualiser la source</button>
      <button type="button" disabled={Boolean(extensions.busy) || installed} title={installed ? 'Désinstallez d’abord les extensions de cette source.' : undefined} onClick={() => setRemoving(true)}>Retirer la source</button>
      {removing && <><button type="button" disabled={Boolean(extensions.busy)} onClick={() => void extensions.removeSource(source.id)}>Confirmer le retrait</button><button type="button" onClick={() => setRemoving(false)}>Conserver</button></>}
    </div>
  </section>
}

function ExtensionRow({
  entry,
  activity,
  busy,
  onInstall,
  onUpdate,
  onDiagnose,
  onRemove,
  onToggle,
}: {
  entry: ExtensionState
  activity: { message: string; failed: boolean } | undefined
  busy: boolean
  onInstall: (ref?: string) => void
  onUpdate: (ref?: string) => void
  onDiagnose: () => void
  onRemove: () => void
  onToggle: (enabled: boolean) => void
}): React.ReactNode {
  const [removing, setRemoving] = React.useState(false)
  const [ref, setRef] = React.useState(entry.installedRef ?? 'HEAD')
  return (
    <section className="ext">
      <div className="ext-head">
        <span className="catalog-icon" aria-hidden="true"><Icon name={entry.category === 'Bureautique' ? 'file' : 'extension'} size={21} /></span>
        <span className={entry.installed ? 'ext-name' : 'ext-name not-installed'}>{entry.name}</span>

        {entry.revision && (
          <span className="ext-revision" title={`Révision installée : ${entry.revision}`}>
            {entry.installedVersion ?? entry.revision.slice(0, 7)}
          </span>
        )}

        {entry.installed && (
          <label className="ext-enable">
            <input
              type="checkbox"
              className="switch"
              role="switch"
              checked={entry.enabled}
              disabled={busy || Boolean(entry.problem && !entry.enabled)}
              onChange={e => onToggle(e.target.checked)}
            />
            Activée
          </label>
        )}

        {busy ? (
          <span className="ext-busy">…</span>
        ) : entry.installed ? (
          <>
            <button type="button" className="ghost" disabled={Boolean(entry.catalogProblem || entry.problem)} onClick={() => onUpdate(entry.sourceId ? undefined : ref.trim() || 'HEAD')}>
              Mettre à jour
            </button>
            <IconButton icon="close" size={13} onClick={() => setRemoving(true)} title={`Supprimer ${entry.name}`} />
          </>
        ) : (
          <button type="button" className="primary" disabled={Boolean(entry.problem)} onClick={() => onInstall(entry.sourceId ? undefined : ref.trim() || 'HEAD')}>
            Installer
          </button>
        )}
      </div>

      <p className="ext-summary">{entry.summary}</p>
      {entry.notice && !entry.installed && <p className="settings-callout" role="status">{entry.notice}</p>}
      <SkillList skills={entry.skills ?? []} />
      {(entry.problem || entry.catalogProblem) && <p className="settings-error" role="status">{entry.problem || entry.catalogProblem}</p>}
      {entry.sourceId && entry.revision && entry.ref !== entry.revision && /^[a-f0-9]{40}$/.test(entry.ref ?? '') && <p className="settings-note">Une autre révision est disponible dans la source actualisée.</p>}
      {removing && <div className="technical-actions"><span>Supprimer cette installation locale ?</span><button type="button" disabled={busy} onClick={() => { onRemove(); setRemoving(false) }}>Confirmer la suppression</button><button type="button" onClick={() => setRemoving(false)}>Conserver</button></div>}
      <details className="extension-details"><summary>Détails de l’extension</summary>
        <p>{entry.problem && entry.installed ? 'Installation indisponible : chargement bloqué' : entry.installed ? (entry.enabled ? 'Installée et activée' : 'Installée, désactivée') : 'Non installée'}</p>
        <p>Source : {entry.repository ?? entry.homepage}</p>
        {entry.sourceId ? <p>Référence du catalogue : {entry.ref}</p> : <label className="technical-search">Branche, tag ou commit à installer<input disabled={busy} value={ref} onChange={event => setRef(event.target.value)} /></label>}
        {entry.path && <p>Emplacement : {entry.path}</p>}
        {entry.revision && <p>Commit installé : <code>{entry.revision}</code>{entry.installedRef ? `, référence ${entry.installedRef}` : ''}</p>}
        <p>Licence : {entry.license}. Activation au prochain message.</p>
        <p>Compétences présentées : {skillNames(entry.skills ?? []).length} skills · Fichiers repérés : {entry.commands ?? 0} commandes, {entry.agents ?? 0} agents.</p>
        {entry.installed && <button type="button" disabled={busy} onClick={onDiagnose}>Vérifier avec le moteur</button>}
        {entry.diagnostic && <pre className="ext-diagnostic">{entry.diagnostic}</pre>}
      </details>
      <div className="ext-meta">
        <span>{entry.license}</span>
        <span className="ext-repo" title={entry.homepage}>
          {entry.homepage.replace('https://github.com/', '')}
        </span>
      </div>

      {/* Le résultat d'une vérification figure déjà dans les détails : on ne
          le répète pas, et on le dit en français quand il est connu. */}
      {activity && activity.message.trim() !== entry.diagnostic?.trim() && (
        <div className={activity.failed ? 'ext-activity failed' : 'ext-activity'}>
          {/^validation passed\.?$/i.test(activity.message.trim()) ? 'Vérification réussie' : activity.message}
        </div>
      )}
    </section>
  )
}

function ToolRow({ entry }: { entry: ExtensionState }): React.ReactNode {
  return (
    <section className="ext">
      <div className="ext-head">
        <span className={entry.installed ? 'ext-name' : 'ext-name not-installed'}>
          {entry.name}
        </span>
        <span className={entry.installed ? 'ext-found' : 'ext-missing'}>
          {entry.installed ? 'détecté' : 'absent du PATH'}
        </span>
      </div>
      <p className="ext-summary">{entry.summary}</p>
      {!entry.installed && (
        <div className="ext-activity">
          À installer soi-même : <code>{entry.install}</code>, puis{' '}
          <code>graphify install --project</code> dans le dépôt concerné — la
          compétence est alors écrite dans son <code>.claude/skills/</code> et le
          moteur la lit d’office.
        </div>
      )}
      <div className="ext-meta">
        <span>{entry.license}</span>
        <span className="ext-repo">
          {entry.homepage.replace('https://github.com/', '')}
        </span>
      </div>
    </section>
  )
}
