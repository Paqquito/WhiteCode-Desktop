import { importMcp } from '../../shared/mcpImport.js'
import * as React from 'react'
import { SkeletonRows } from '../ui/Skeleton.js'
import type { ConnectorStatus, ConnectorView, McpEntry, McpView, McpProbe } from '../../main/preload.js'
import { IconButton } from '../ui/IconButton.js'
import { Group, SettingsPage, SwitchRow } from '../ui/SettingRows.js'

/**
 * Compte d'un connecteur de plugin, tiré des secrets qu'il déclare. Un secret
 * n'est jamais relu par le rendu : il ne connaît que sa présence et le compte vérifié.
 */
function ConnectorAccount({ connector, disabled }: { connector: ConnectorView; disabled: boolean }): React.ReactNode {
  const [status, setStatus] = React.useState<ConnectorStatus | null>(null)
  const [values, setValues] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const check = React.useCallback(async () => {
    setBusy(true); setError('')
    try { setStatus(await window.engine.connectorStatus(connector.id)) } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }, [connector.id])
  React.useEffect(() => { void check() }, [check])
  async function save(entries: Array<[string, string | null]>) {
    setBusy(true); setError('')
    try {
      for (const [name, value] of entries) await window.engine.setConnectorSecret(connector.id, name, value)
      setValues({}); setStatus(await window.engine.connectorStatus(connector.id))
    } catch (reason) { setError(String(reason)) } finally { setBusy(false) }
  }
  const filled = Object.entries(values).filter(([, value]) => value)
  const single = connector.secrets.length === 1 ? connector.secrets[0]!.label.toLocaleLowerCase('fr-FR') : 'les secrets'
  return <form className="mcp-editor" aria-label={`Compte ${connector.name}`} onSubmit={event => { event.preventDefault(); void save(filled) }}>
    <p role="status">{status === null ? `Vérification du compte ${connector.name}…`
      : !status.configured ? `Compte ${connector.name} incomplet : ses outils ne sont pas proposés aux modèles.`
      : status.account ? `Compte vérifié : ${status.account.name} (${status.account.login}).`
      : status.error ? `Enregistré, non vérifié : ${status.error}` : 'Enregistré.'}</p>
    {connector.secrets.map(secret => <React.Fragment key={secret.name}>
      <label>{secret.label}{status?.secrets[secret.name] ? ' (enregistrée)' : ''}
        <input type="password" autoComplete="off" spellCheck={false} value={values[secret.name] ?? ''} pattern={secret.pattern.replace(/^\^|\$$/g, '')}
          onChange={event => { const value = event.target.value.trim(); setValues(current => ({ ...current, [secret.name]: value })) }} /></label>
      {secret.help && <p className="hint">{secret.help}</p>}
    </React.Fragment>)}
    <div className="mcp-actions">
      <button type="submit" disabled={disabled || busy || !filled.length}>{status?.configured ? 'Remplacer' : 'Enregistrer'}</button>
      {status?.configured && <button type="button" disabled={disabled || busy} onClick={() => void check()}>Vérifier</button>}
      {status && Object.values(status.secrets).some(Boolean) && <button type="button" disabled={disabled || busy}
        onClick={() => void save(connector.secrets.map(secret => [secret.name, null]))}>{connector.secrets.length === 1 ? `Retirer la ${single}` : 'Retirer les secrets'}</button>}
    </div>
    {error && <p role="alert" className="session-error">{error}</p>}
  </form>
}

export function McpSettings({ selected, onSelected, onManagePlugins }: { selected: string[] | null; onSelected: (ids: string[] | null) => void; onManagePlugins?: () => void }): React.ReactNode {
  const [query, setQuery] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [imported, setImported] = React.useState(false)
  const editor = React.useRef<HTMLInputElement>(null)
  const custom = React.useRef<HTMLDetailsElement>(null)
  const [servers, setServers] = React.useState<McpView[]>([])
  const [connectors, setConnectors] = React.useState<ConnectorView[]>([])
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [testing, setTesting] = React.useState<string | null>(null)
  const [results, setResults] = React.useState<Record<string, McpProbe>>({})
  const [editing, setEditing] = React.useState<string | null>(null)
  const [id, setId] = React.useState('')
  const [label, setLabel] = React.useState('')
  const [configuration, setConfiguration] = React.useState('')
  const [removing, setRemoving] = React.useState<string | null>(null)
  const refresh = React.useCallback(async () => {
    setLoading(true)
    try { const [list, declared] = await Promise.all([window.engine.listMcp(), window.engine.listConnectors()]); setServers(list); setConnectors(declared) }
    finally { setLoading(false) }
  }, [])
  React.useEffect(() => { if (editing !== null) { if (custom.current) custom.current.open = true; editor.current?.focus() } }, [editing])
  React.useEffect(() => { void refresh().catch(reason => setError(String(reason))) }, [refresh])
  async function action(run: () => Promise<void>) {
    setError(''); setBusy(true)
    try { await run(); setResults({}); await refresh() } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  async function probe(id: string) {
    setTesting(id); setError('')
    try { const result = await window.engine.probeMcp(id); setResults(previous => ({ ...previous, [id]: result })) }
    catch (reason) { setError(String(reason)) }
    finally { setTesting(null) }
  }
  function select(id: string, enabled: boolean) {
    const ids = selected ?? servers.filter(server => server.enabled).map(server => server.id)
    onSelected(enabled ? [...new Set([...ids, id])] : ids.filter(value => value !== id))
  }
  const visible = servers.filter(server => `${server.label} ${server.id}`.toLowerCase().includes(query.trim().toLowerCase()))
  const locked = busy || testing !== null
  return <SettingsPage
    className="mcp-settings"
    title="Connecteurs"
    lead="Les services que l’IA peut consulter dans cette conversation : tickets, dépôts de code, recherche web… Un connecteur arrive avec un plugin ou s’ajoute à la main. Les changements prennent effet au prochain message."
    actions={<IconButton icon="refresh" title="Actualiser les serveurs" disabled={locked || loading} onClick={() => { setError(''); void refresh().catch(error => setError(String(error))) }} />}
  >
    <p className="settings-note">Les connecteurs fournis par un plugin apparaissent après son installation et son activation. Installez uniquement ceux qui vous servent.</p>
    {onManagePlugins && <div className="technical-actions"><button type="button" onClick={onManagePlugins}>Installer un plugin</button></div>}
    <label className="technical-search">Rechercher un serveur<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
    {loading && servers.length === 0 && <SkeletonRows label="Lecture des serveurs…" />}
    {!loading && visible.length === 0 && <p role="status" className="settings-note">Aucun serveur ne correspond à la recherche.</p>}
    <Group title="Serveurs">
      <SwitchRow
        title="Utiliser tous les serveurs activés dans cette conversation"
        hint="Désactivez pour choisir serveur par serveur."
        checked={selected === null}
        onChange={all => onSelected(all ? null : servers.filter(s => s.enabled).map(s => s.id))}
      />
      {visible.map(server => {
        const result = results[server.id]
        return <section className="mcp-server setting-row" key={server.id} aria-label={server.label}>
          <div className="setting-label">
            <span className="setting-title">
              {server.label}
              {!server.enabled ? <span className="setting-badge">Désactivé</span>
                : result ? <span className={result.ok ? 'setting-badge ok' : 'setting-badge warn'}>{result.ok ? 'Joignable' : 'Erreur'}</span> : null}
            </span>
          </div>
          <div className="setting-hint">{!server.enabled ? 'Désactivé dans l’application : à réactiver dans Réglages et diagnostic.' : server.source === 'corpus' ? 'Corpus indexé sur ce poste.' : server.source === 'plugin' ? `Fourni par un plugin · ${server.address}` : server.address}</div>
          <div className="setting-control setting-actions">
            <label className="mcp-choice"><input type="checkbox" className="switch" role="switch" checked={server.enabled && (selected === null || selected.includes(server.id))} disabled={!server.enabled || locked} onChange={event => select(server.id, event.target.checked)} />Cette conversation</label>
          </div>
          <details><summary>Réglages et diagnostic</summary><p className="hint">{server.transport} · {server.address}</p><div className="mcp-actions">
            {server.source !== 'corpus' ? <label className="mcp-choice"><input type="checkbox" checked={server.enabled} disabled={locked} onChange={event => { const enabled = event.target.checked; void action(() => window.engine.enableMcp(server.id, enabled)) }} />Activé dans l’application</label> : <span className="hint">Activation et indexation dans Corpus</span>}
            <button type="button" disabled={locked} onClick={() => void probe(server.id)}>{testing === server.id ? 'Connexion…' : 'Tester et découvrir'}</button>
            {server.source === 'user' && <>
              <button type="button" disabled={locked} onClick={() => void action(async () => { const entry = await window.engine.getMcp(server.id); setId(entry.id); setLabel(entry.label); setConfiguration(JSON.stringify(entry.config, null, 2)); setImported(false); setEditing(entry.id) })}>Configurer</button>
              <button type="button" disabled={locked} onClick={() => setRemoving(server.id)}>Supprimer…</button>
            </>}
          </div></details>
          {connectors.filter(item => item.id === server.id && item.secrets.length).map(item => <details key={item.id}><summary>Compte {item.name}</summary><ConnectorAccount connector={item} disabled={locked} /></details>)}
          {removing === server.id && <div className="mcp-actions"><span>Retirer ce serveur du registre ?</span><button type="button" className="danger" disabled={locked} onClick={() => void action(async () => { await window.engine.removeMcp(server.id); setRemoving(null) })}>Confirmer la suppression</button><button type="button" onClick={() => setRemoving(null)}>Conserver</button></div>}
          {result && <div role="status" className={result.ok ? 'mcp-result' : 'mcp-result session-error'}>
            {result.ok ? `${result.tools.length} outil${result.tools.length > 1 ? 's' : ''} disponible${result.tools.length > 1 ? 's' : ''}, réponse en ${result.elapsedMs} ms` : result.error}
            {result.tools.map(tool => <details key={tool.name}><summary>{tool.name}</summary><p>{tool.description}</p></details>)}
          </div>}
        </section>
      })}
    </Group>
    <Group title="Serveur personnalisé">
    <details ref={custom} className="mcp-editor"><summary>Ajouter un connecteur (serveur MCP)</summary>
    <p className="hint">Les identifiants sont chiffrés avec le coffre système. Une commande locale est exécutée avec les droits de votre compte.</p>
    {editing === null ? <button type="button" onClick={() => { setImported(false); setId(''); setLabel(''); setConfiguration(JSON.stringify({ type: 'http', url: 'https://example.org/mcp', headers: {} }, null, 2)); setEditing('') }}>Ajouter un serveur</button>
      : <form className="mcp-editor" onSubmit={event => { event.preventDefault(); void action(async () => {
        if (editing === '' && servers.some(server => server.id === id)) throw new Error('Cet identifiant existe déjà. Utilisez Configurer pour le modifier.')
        const config = JSON.parse(configuration) as McpEntry['config']
        const enabled = servers.find(s => s.id === id)?.enabled ?? !imported
        await window.engine.saveMcp({ id, label, enabled, config }); setEditing(null); setConfiguration('')
      }) }}>
        <label>Identifiant<input ref={editor} required value={id} disabled={Boolean(editing)} pattern="[a-z][a-z0-9_-]{0,39}" onChange={event => setId(event.target.value)} /></label>
        <label>Nom affiché<input required value={label} maxLength={100} onChange={event => setLabel(event.target.value)} /></label>
        <label>Configuration MCP (JSON)<textarea required rows={9} spellCheck={false} value={configuration} onChange={event => setConfiguration(event.target.value)} /></label>
        <p className="hint">HTTP/SSE : type, url et headers facultatifs. Local : type « stdio », command, args (tableau) et env facultatif. Utiliser HTTPS pour les identifiants distants.</p>
        <div className="mcp-actions"><button type="submit" disabled={busy || testing !== null}>Enregistrer le serveur</button><button type="button" onClick={() => { setEditing(null); setConfiguration('') }}>Annuler</button></div>
      </form>}
    <label className="mcp-import">Importer une configuration JSON (un serveur)
      <input type="file" accept=".json,application/json" disabled={busy || testing !== null || editing !== null} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
        try {
          if (file.size > 256 * 1024) throw new Error('Configuration trop volumineuse (maximum 256 Ko).')
          const entry = importMcp(await file.text())
          setId(entry.id); setLabel(entry.label); setConfiguration(JSON.stringify(entry.config, null, 2)); setImported(true); setEditing(''); setError('')
        } catch (error) { setError(String(error)) }
      }} />
    </label>
    {imported && editing !== null && <p className="hint">Import préparé, non enregistré. Le serveur sera désactivé à l’enregistrement ; vérifiez la configuration avant de l’activer.</p>}
    </details>
    </Group>
    {error && <p role="alert" className="session-error">{error}</p>}
  </SettingsPage>
}
