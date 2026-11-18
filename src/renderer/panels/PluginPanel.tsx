import * as React from 'react'
import { pick } from '../../shared/dataPath.js'
import { bindPanelArgs, panelText, type PanelAction, type PanelContext, type PanelForm, type PanelRows, type PluginPanelManifest } from '../../shared/pluginPanel.js'
import { Panel, PanelEmpty } from '../ui/Panel.js'
import { IconButton } from '../ui/IconButton.js'
import { SkeletonRows } from '../ui/Skeleton.js'
import { PanelFields, PluginPanelBlocks } from './PluginPanelBlocks.js'

async function call(connector: string, tool: string, args: unknown, cwd?: string): Promise<unknown> {
  const result = await window.engine.callConnector(connector, tool, args, cwd)
  if (!result.ok) throw new Error(result.error)
  return result.data
}

function useLoad(load: () => Promise<unknown>, deps: React.DependencyList) {
  const [state, setState] = React.useState<{ data?: unknown; error?: string; loading: boolean }>({ loading: true })
  const [revision, setRevision] = React.useState(0)
  React.useEffect(() => {
    let live = true
    setState(previous => ({ ...previous, loading: true, error: undefined }))
    void Promise.resolve().then(load).then(data => { if (live) setState({ data, loading: false }) },
      error => { if (live) setState({ error: String(error.message ?? error), loading: false }) })
    return () => { live = false }
  }, [...deps, revision])
  return { ...state, reload: () => setRevision(value => value + 1) }
}

export function PluginPanel({ manifest, cwd, onClose, onWork }: {
  manifest: PluginPanelManifest; cwd?: string; onClose: () => void; onWork: (prompt: string) => void
}) {
  const [view, setView] = React.useState(0)
  const [query, setQuery] = React.useState('')
  const [search, setSearch] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | number | null>(null)
  const [revision, setRevision] = React.useState(0)
  const tabs = React.useRef<HTMLDivElement>(null)
  const previousSelection = React.useRef<string | number | null>(null)
  const select = (id: string | number) => { previousSelection.current = id; setSelected(id) }
  const active = manifest.views[view] ?? manifest.views[0]!
  const searchView = search !== null ? manifest.search : undefined
  const request = searchView?.request ?? active.request
  const rows = searchView?.rows ?? active.rows
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const text = query.trim()
    if (!text) return
    const number = manifest.search?.numericId && /^#?(\d{1,9})$/.exec(text)
    if (number) setSelected(Number(number[1]))
    else { setSelected(null); setSearch(text) }
  }
  return <Panel title={manifest.title} icon="extension" onClose={onClose} padded={false}
    actions={<IconButton icon="refresh" size={14} title="Actualiser" label={`Actualiser ${manifest.title}`} onClick={() => setRevision(value => value + 1)} />}>
    <div className="plugin-records">
      {manifest.search && <form className="plugin-records-search" role="search" onSubmit={submit}>
        <input type="search" aria-label={manifest.search.label} placeholder={manifest.search.placeholder} value={query} onChange={event => setQuery(event.target.value)} />
      </form>}
      {selected === null ? <>
        <div ref={tabs} className="plugin-records-tabs" role="tablist" aria-label={manifest.title} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? manifest.views.length - 1 : (view + (event.key === 'ArrowRight' ? 1 : -1) + manifest.views.length) % manifest.views.length
          setSearch(null); setView(next); tabs.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus()
        }}>
          {manifest.views.map((item, index) => <button key={item.id} type="button" role="tab" aria-selected={search === null && view === index} tabIndex={search === null && view === index ? 0 : -1}
            onClick={() => { setSearch(null); setView(index) }}>{item.label}</button>)}
          {search !== null && <button type="button" role="tab" aria-selected>« {search} »</button>}
        </div>
        <RecordList key={`${active.id}:${search}:${revision}:${cwd}`} connector={manifest.connector} request={request} rows={rows} query={search ?? ''} cwd={cwd} onSelect={select} restoreFocus={previousSelection} />
      </> : <RecordDetail key={`${selected}:${revision}:${cwd}`} manifest={manifest} selected={selected} cwd={cwd} onBack={() => setSelected(null)} onSelect={select} onWork={onWork} />}
    </div>
  </Panel>
}

function RecordList({ connector, request, rows, query, cwd, onSelect, restoreFocus }: {
  connector: string; request: PluginPanelManifest['detail']['request']; rows: PanelRows; query: string; cwd?: string; onSelect: (id: string | number) => void; restoreFocus: React.RefObject<string | number | null>
}) {
  const state = useLoad(() => call(connector, request.tool, bindPanelArgs(request.args, { form: { query } }), cwd), [connector, request, query, cwd])
  const list = React.useRef<HTMLUListElement>(null)
  React.useLayoutEffect(() => {
    if (state.data && restoreFocus.current !== null) {
      const row = [...(list.current?.querySelectorAll<HTMLButtonElement>('[data-record-id]') ?? [])].find(row => row.dataset.recordId === String(restoreFocus.current))
      row?.focus({ preventScroll: true }); restoreFocus.current = null
    }
  }, [state.data])
  if (state.loading && !state.data) return <div className="panel-pad"><SkeletonRows count={4} label="Chargement…" /></div>
  if (state.error) return <div className="panel-pad"><p role="alert" className="session-error">{state.error}</p><button type="button" onClick={state.reload}>Réessayer</button></div>
  const value = pick(state.data, rows.items)
  if (!Array.isArray(value)) return <p role="alert" className="session-error">La réponse du service ne contient pas la liste attendue.</p>
  const items = value.slice(0, 500)
  if (!items.length) return <div className="panel-pad"><PanelEmpty>{rows.empty}</PanelEmpty></div>
  const total = pick(state.data, rows.total)
  return <>
    <p className="plugin-records-count">{typeof total === 'number' ? total : value.length} résultat(s){typeof total === 'number' && total > items.length ? `, ${items.length} affichés` : ''}</p>
    <ul ref={list} className="plugin-records-list">{items.map((item, index) => {
      const id = pick(item, rows.id), context = { item }
      if (typeof id !== 'string' && typeof id !== 'number') return null
      return <li key={`${id}:${index}`}><button type="button" className="plugin-records-row" data-record-id={id} onClick={() => onSelect(id)}>
        <span className="plugin-records-row-title">{panelText(rows.title, context)}</span>
        <span className="plugin-records-row-meta">{rows.badges?.map((badge, index) => panelText(badge, context) ? <span className="plugin-records-badge" key={index}>{panelText(badge, context)}</span> : null)}
          {rows.subtitle && panelText(rows.subtitle, context)}</span>
        {rows.excerpt && <span className="plugin-records-row-excerpt">{panelText(rows.excerpt, context)}</span>}
      </button></li>
    })}</ul>
  </>
}

function RecordDetail({ manifest, selected, cwd, onBack, onSelect, onWork }: {
  manifest: PluginPanelManifest; selected: string | number; cwd?: string; onBack: () => void; onSelect: (id: string | number) => void; onWork: (prompt: string) => void
}) {
  const { detail, connector } = manifest
  const state = useLoad(() => call(connector, detail.request.tool, bindPanelArgs(detail.request.args, { selection: selected }), cwd), [connector, detail.request, selected, cwd])
  const [busy, setBusy] = React.useState(false)
  const [outcome, setOutcome] = React.useState<{ error: boolean; text: string } | null>(null)
  const context: PanelContext = { record: state.data, selection: selected }
  const heading = React.useRef<HTMLHeadingElement>(null)
  const focused = React.useRef(false)
  React.useLayoutEffect(() => {
    if (state.data && !focused.current) { heading.current?.focus({ preventScroll: true }); focused.current = true }
  }, [state.data])
  const action = async (action: PanelAction, scope: PanelContext) => {
    try {
      if (action.kind === 'prompt') onWork(panelText(action.prompt, scope))
      else if (action.kind === 'external') await window.engine.openPanelUrl(panelText(action.url, scope))
      else if (action.kind === 'select') {
        const value = bindPanelArgs({ value: action.value }, scope).value
        if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Identifiant invalide.')
        onSelect(value)
      } else {
        const params = bindPanelArgs(action.params, scope)
        if (Object.values(params).some(value => typeof value !== 'string' && typeof value !== 'number')) throw new Error('Paramètres de lien invalides.')
        await window.engine.openConnectorLink(connector, action.link, params as Record<string, string | number>)
      }
    } catch (error) { setOutcome({ error: true, text: String(error instanceof Error ? error.message : error) }) }
  }
  const head = <div className="plugin-records-detail-head"><button type="button" disabled={busy} onClick={onBack}>← Liste</button></div>
  if (state.loading && !state.data) return <div className="panel-pad">{head}<PanelEmpty>Chargement…</PanelEmpty></div>
  if (state.error || !state.data || typeof state.data !== 'object' || Array.isArray(state.data)) return <div className="panel-pad">{head}<p role="alert" className="session-error">{state.error ?? 'Réponse du service invalide.'}</p><button type="button" onClick={state.reload}>Réessayer</button></div>
  return <div className="panel-pad plugin-records-detail">
    {head}<h3 ref={heading} tabIndex={-1} className="plugin-records-title">{panelText(detail.title, context)}</h3>
    {detail.subtitle && <p className="plugin-records-row-meta">{panelText(detail.subtitle, context)}</p>}
    <div className="plugin-records-detail-actions">{detail.actions?.map((item, index) => <button key={index} type="button" disabled={busy} className={item.kind === 'prompt' ? 'primary' : undefined} onClick={() => void action(item, context)}>{panelText(item.label, context)}</button>)}</div>
    {detail.fields && <PanelFields fields={detail.fields} context={context} />}
    {detail.forms && <section className="plugin-records-actions" aria-label="Actions">{detail.forms.map(form => <RecordForm key={form.id} form={form} context={context} connector={connector} cwd={cwd} busy={busy} onBusy={setBusy} onOutcome={setOutcome} onReload={state.reload} />)}</section>}
    {outcome && <p role={outcome.error ? 'alert' : 'status'} className={outcome.error ? 'session-error' : 'plugin-records-outcome'}>{outcome.text}</p>}
    <PluginPanelBlocks blocks={detail.blocks} context={context} onAction={(item, scope) => void action(item, scope)} busy={busy} />
  </div>
}

function RecordForm({ form, context, connector, cwd, busy, onBusy, onOutcome, onReload }: {
  form: PanelForm; context: PanelContext; connector: string; cwd?: string; busy: boolean; onBusy: (busy: boolean) => void
  onOutcome: (outcome: { error: boolean; text: string }) => void; onReload: () => void
}) {
  const initial = () => Object.fromEntries(form.fields.map(field => [field.id, field.type === 'checkbox' ? false : '']))
  const [values, setValues] = React.useState<Record<string, string | boolean>>(initial)
  const options = (field: PanelForm['fields'][number]) => {
    const data = pick(context, field.options), exclude = pick(context, field.exclude)
    return Array.isArray(data) ? [...new Set(data.filter((value): value is string => typeof value === 'string' && value !== exclude))] : []
  }
  const unavailable = form.fields.find(field => field.type === 'select' && !options(field).length)
  if (unavailable) return pick(context, unavailable.options) == null && form.unavailable ? <p className="hint">{form.unavailable}</p> : null
  const valid = form.fields.every(field => (!field.required || Boolean(String(values[field.id] ?? '').trim())) && (field.type !== 'select' || !values[field.id] || options(field).includes(String(values[field.id]))))
  return <form aria-label={form.label} onSubmit={event => {
    event.preventDefault()
    if (busy || !valid) return
    onBusy(true)
    void (async () => {
      try {
        const result = await window.engine.callConnector(connector, form.request.tool, bindPanelArgs(form.request.args, { ...context, form: values }), cwd)
        onOutcome({ error: !result.ok, text: result.ok ? result.text || 'Action effectuée.' : result.error })
        if (result.ok) { setValues(initial()); onReload() }
      } catch (error) { onOutcome({ error: true, text: String(error instanceof Error ? error.message : error) }) }
      finally { onBusy(false) }
    })()
  }}>
    {form.fields.map(field => <label key={field.id} className={field.type === 'checkbox' ? 'plugin-records-check' : undefined}>
      {field.type !== 'checkbox' && field.label}
      {field.type === 'checkbox' ? <><input type="checkbox" disabled={busy} checked={Boolean(values[field.id])} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.checked }))} />{field.label}</>
        : field.type === 'select' ? <select disabled={busy} required={field.required} value={String(values[field.id] ?? '')} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))}>
          <option value="">—</option>{options(field).map(value => <option key={value} value={value}>{value}</option>)}</select>
        : field.type === 'textarea' ? <textarea rows={3} maxLength={20000} required={field.required} disabled={busy} value={String(values[field.id] ?? '')} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} />
        : <input type="text" maxLength={20000} required={field.required} disabled={busy} value={String(values[field.id] ?? '')} onChange={event => setValues(current => ({ ...current, [field.id]: event.target.value }))} />}
    </label>)}
    <button type="submit" disabled={busy || !valid}>{form.submit}</button>
  </form>
}
