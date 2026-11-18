import type { RuntimeRoots } from '../backend/launch.js'
/** Application-owned catalogue and immutable engine-compatible plugin installations. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CATALOG, DEFAULT_SOURCE, OFFICE_PLUGIN, type CatalogEntry } from './extensionCatalog.js'
import { discover, inspectPlugin, pluginPath, sourceId, type ExtensionSource } from './extensionSources.js'
import { contained, engineValidator, gitRead, gitReference, removeManaged, repositoryAddress, snapshot } from './pluginRepository.js'
import type { ConnectorManifest } from '#desktop/connector-manifest'
import type { PluginPanelManifest } from '../../shared/pluginPanel.js'
export { CATALOG, DEFAULT_SOURCE, OFFICE_PLUGIN } from './extensionCatalog.js'
export type { CatalogEntry, ExtensionKind } from './extensionCatalog.js'
export type { ExtensionSource } from './extensionSources.js'

export type ExtensionState = CatalogEntry & {
  installed: boolean; enabled: boolean; path?: string; revision?: string; installedVersion?: string
  installedRef?: string; skills?: string[]; commands?: number; agents?: number; diagnostic?: string; catalogProblem?: string
  /** Information à montrer sur la carte (migration de la Bureautique échouée). */
  notice?: string
  connector?: ConnectorManifest
  panel?: PluginPanelManifest
}
/** État du catalogue officiel, pour dire pourquoi il manque. */
export type CatalogueStatus = { added: boolean; error?: string; update?: { sourceId: string; currentRef: string; targetRef: string } }
export type ExtensionProgress = { id: string; message: string; failed: boolean }
export type PluginMigration = { name: string; enabled: boolean }
type Installation = { entry: CatalogEntry; path: string; commit: string; ref: string; version?: string; name: string; skills: string[]; commands: number; agents: number; diagnostic: string }
type Registry = {
  version: 2; enabled: string[]; sources: ExtensionSource[]; installations: Record<string, Installation | null>
  /** Ancien plugin inclus : `false` si l'utilisateur l'avait désactivé. Lu une fois, pour la migration. */
  officeEnabled?: boolean
  /** Catalogue officiel ajouté une fois ; l'utilisateur peut ensuite le retirer. */
  provisionedCatalogs?: string[]
  catalogErrors?: Record<string, string>
  defaultSource?: 'added'
  defaultSourceError?: string
  /** Migration de la Bureautique incluse vers le plugin du catalogue. */
  officeMigration?: 'done' | { error: string }
  pluginMigrations?: Record<string, { enabled: boolean; done?: boolean; installing?: boolean; error?: string }>
  migrationError?: string
}
const empty = (): Registry => ({ version: 2, enabled: [], sources: [], installations: {} })
const validId = (id: string) => { if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(id)) throw new Error('Identifiant d’extension invalide.') }

export class Extensions {
  private state?: Registry
  private loading?: Promise<Registry>
  private queue: Promise<unknown> = Promise.resolve()
  private readonly validate: (path: string) => Promise<string>
  constructor(private readonly root: string, roots: RuntimeRoots, private readonly legacyPlugins: () => Promise<PluginMigration[]> = async () => []) {
    this.validate = engineValidator(roots, join(root, 'extension-validator'))
  }
  private get file() { return join(this.root, 'extensions.json') }
  private get store() { return join(this.root, 'extensions') }
  private async load(): Promise<Registry> {
    if (this.state) return this.state
    if (!this.loading) this.loading = this.readRegistry().then(state => this.state = state).finally(() => { this.loading = undefined })
    return this.loading
  }
  private async readRegistry(): Promise<Registry> {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8'))
      if (Array.isArray(raw) && raw.every(id => typeof id === 'string')) return { ...empty(), enabled: raw }
      if (raw?.version !== 2 || !Array.isArray(raw.enabled) || !raw.enabled.every((id: unknown) => typeof id === 'string') || !Array.isArray(raw.sources) || !raw.installations || typeof raw.installations !== 'object' || Array.isArray(raw.installations)) throw new Error('Registre d’extensions invalide ; restaurez extensions.json avant de le modifier.')
      return raw
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error }
  }
  private async persist(state: Registry) {
    await mkdir(this.root, { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(state, null, 2), { flag: 'wx', mode: 0o600 })
      await rename(temporary, this.file); this.state = state
    } finally { await unlink(temporary).catch(() => {}) }
  }
  private change<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(action); this.queue = next.catch(() => {}); return next
  }
  private catalog(state: Registry): CatalogEntry[] {
    const entries = new Map([...CATALOG, ...state.sources.flatMap(source => source.entries)].map(entry => [entry.id, entry]))
    for (const installation of Object.values(state.installations)) if (installation && !entries.has(installation.entry.id)) entries.set(installation.entry.id, installation.entry)
    return [...entries.values()].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)))
  }
  private entry(state: Registry, id: string): CatalogEntry {
    validId(id)
    const entry = this.catalog(state).find(entry => entry.id === id)
    if (!entry) throw new Error('Extension inconnue.')
    return entry
  }
  private async installation(state: Registry, entry: CatalogEntry): Promise<Installation | null> {
    if (entry.id in state.installations) return state.installations[entry.id] ?? null
    // Keep old clones and activation choices in place; migrate metadata on the next mutation.
    if (!CATALOG.some(seed => seed.id === entry.id && seed.kind === 'plugin')) return null
    const path = join(this.store, entry.id)
    if (!existsSync(join(path, '.claude-plugin', 'plugin.json'))) return null
    await contained(this.store, path)
    const info = await inspectPlugin(path)
    return { entry, path: entry.id, name: info.manifest.name, commit: await gitRead(path, ['rev-parse', 'HEAD']), ref: 'HEAD', version: info.manifest.version, skills: info.skills, commands: info.commands, agents: info.agents, diagnostic: 'Installation historique : diagnostic disponible.' }
  }
  async list(): Promise<ExtensionState[]> {
    const state = await this.load()
    const migration = state.officeMigration
    return Promise.all(this.catalog(state).map(async entry => {
      if (entry.kind === 'tool') {
        const installed = await promisify(execFile)(process.platform === 'win32' ? 'where' : 'which', [entry.command!], { windowsHide: true, timeout: 5000 }).then(() => true, () => false)
        return { ...entry, installed, enabled: state.enabled.includes(entry.id) }
      }
      try {
        const installation = await this.installation(state, entry)
        if (!installation) {
          // La Bureautique était incluse : si sa réinstallation automatique a
          // échoué, la carte dit pourquoi elle n'est plus là.
          const notice = typeof migration === 'object' && entry.name === OFFICE_PLUGIN
            ? `La Bureautique n’est plus incluse dans l’application. Son installation automatique a échoué : ${migration.error} Installez-la ici.`
            : undefined
          const pending = state.pluginMigrations?.[entry.name]
          return { ...entry, installed: false, enabled: false, notice: pending?.error ?? notice }
        }
        const path = await contained(this.store, join(this.store, installation.path))
        const info = await inspectPlugin(path)
        return { ...entry, problem: undefined, catalogProblem: entry.problem, installed: true, enabled: state.enabled.includes(entry.id), path, revision: installation.commit, installedVersion: info.manifest.version, installedRef: installation.ref, skills: info.skills, commands: info.commands, agents: info.agents, diagnostic: installation.diagnostic, connector: info.connector, panel: info.panel }
      } catch (error) { return { ...entry, installed: true, enabled: state.enabled.includes(entry.id), problem: String(error) } }
    }))
  }
  async sources(): Promise<ExtensionSource[]> { await this.queue; return structuredClone((await this.load()).sources) }
  addSource(repository: string, ref = 'HEAD'): Promise<void> {
    return this.change(async () => {
      const address = repositoryAddress(repository), id = sourceId(address), state = await this.load()
      if (state.sources.some(source => source.id === id)) throw new Error('Cette source existe déjà. Actualisez-la pour changer de référence.')
      await this.readSource(state, address, gitReference(ref), id)
    })
  }
  refreshSource(id: string, ref?: string): Promise<void> {
    return this.change(async () => {
      const state = await this.load(), source = state.sources.find(source => source.id === id)
      if (!source) throw new Error('Source inconnue.')
      await this.readSource(state, source.repository, gitReference(ref ?? source.ref), id)
    })
  }
  private async readSource(state: Registry, repository: string, ref: string, id: string) {
    const downloaded = await snapshot(this.store, repository, ref)
    try {
      const source = await discover(downloaded.path, { id, repository, ref, commit: downloaded.commit }, this.validate)
      await this.persist({ ...state, sources: [...state.sources.filter(s => s.id !== id), source] })
    } finally { await removeManaged(this.store, downloaded.path) }
  }
  removeSource(id: string): Promise<void> {
    return this.change(async () => {
      const state = await this.load()
      if (Object.values(state.installations).some(item => item?.entry.sourceId === id)) throw new Error('Désinstallez les extensions de cette source avant de la retirer.')
      await this.persist({ ...state, sources: state.sources.filter(source => source.id !== id) })
    })
  }
  install(id: string, progress: (p: ExtensionProgress) => void, ref?: string): Promise<boolean> { return this.deploy(id, progress, false, ref) }
  update(id: string, progress: (p: ExtensionProgress) => void, ref?: string): Promise<boolean> { return this.deploy(id, progress, true, ref) }
  private deploy(id: string, progress: (p: ExtensionProgress) => void, update: boolean, requestedRef?: string): Promise<boolean> {
    return this.change(async () => {
      const state = await this.load(), entry = this.entry(state, id)
      if (entry.kind !== 'plugin' || !entry.repository || entry.problem) throw new Error(entry.problem ?? 'Ce programme ne s’installe pas comme un plugin.')
      const previous = await this.installation(state, entry)
      if (previous && !update) return true
      // Catalogue entries follow the explicitly refreshed catalogue commit; direct suggestions accept a tag/commit.
      if (entry.sourceId && requestedRef) throw new Error('Choisissez la référence dans la source du catalogue, puis actualisez-la.')
      const ref = gitReference(requestedRef || entry.ref || previous?.ref || 'HEAD')
      let staging: string | undefined, deployed: string | undefined
      progress({ id, message: 'Récupération et validation de la version…', failed: false })
      try {
        const downloaded = await snapshot(this.store, entry.repository, ref); staging = downloaded.path
        const path = pluginPath(staging, entry.pluginPath ?? '.')
        if (entry.manifest && !existsSync(join(path, 'extension.json')) && !existsSync(join(path, '.claude-plugin', 'plugin.json'))) {
          await mkdir(join(path, '.claude-plugin'), { recursive: true })
          await writeFile(join(path, '.claude-plugin', 'plugin.json'), JSON.stringify(entry.manifest, null, 2))
        }
        const info = await inspectPlugin(path)
        const diagnostic = await this.validate(join(path, '.claude-plugin', 'plugin.json'))
        if (entry.sourceId && entry.content !== 'skill' && info.manifest.name !== entry.name) throw new Error('Le nom du plugin diffère de celui du catalogue.')
        if (state.enabled.includes(id)) await this.checkName(state, id, info)
        deployed = join(this.store, 'packages', id, `${downloaded.commit}-${randomUUID()}`)
        await mkdir(join(this.store, 'packages', id), { recursive: true })
        await contained(this.store, join(this.store, 'packages', id))
        const subdir = relative(staging, path)
        await rename(staging, deployed); staging = undefined
        const installation: Installation = { entry, path: relative(this.store, join(deployed, subdir)), commit: downloaded.commit, ref, version: info.manifest.version, name: info.manifest.name, skills: info.skills, commands: info.commands, agents: info.agents, diagnostic }
        await this.persist({ ...state, installations: { ...state.installations, [id]: installation } })
        deployed = undefined
        progress({ id, message: `Version ${info.manifest.version ?? downloaded.commit.slice(0, 12)} installée. ${state.enabled.includes(id) ? 'Active au prochain message.' : 'Activez-la pour la charger au prochain message.'}`, failed: false })
        return true
      } catch (error) {
        progress({ id, message: `${String(error).slice(-12000)}${previous ? '\nLa version précédente est conservée.' : ''}`, failed: true })
        return false
      } finally {
        if (staging) await removeManaged(this.store, staging)
        if (deployed) await removeManaged(this.store, deployed)
      }
    })
  }
  private async checkName(state: Registry, id: string, info: Awaited<ReturnType<typeof inspectPlugin>>) {
    for (const other of this.catalog(state)) if (other.id !== id && state.enabled.includes(other.id) && other.kind === 'plugin') {
      const installed = await this.installation(state, other)
      if (installed?.name === info.manifest.name) throw new Error(`Un plugin nommé ${info.manifest.name} est déjà activé. Désactivez-le avant d’activer cette version.`)
      if (installed && (info.connector || info.panel)) {
        const otherInfo = await inspectPlugin(await contained(this.store, join(this.store, installed.path)))
        if ((info.connector && otherInfo.connector?.id === info.connector.id) || (info.panel && otherInfo.panel?.id === info.panel.id)) throw new Error('Un connecteur ou un panneau de ce nom est déjà activé.')
      }
    }
  }
  diagnose(id: string): Promise<string> {
    return this.change(async () => {
      const state = await this.load(), entry = this.entry(state, id), installed = await this.installation(state, entry)
      if (!installed) throw new Error('Installez le plugin avant de le diagnostiquer.')
      const path = await contained(this.store, join(this.store, installed.path))
      await inspectPlugin(path)
      const diagnostic = await this.validate(join(path, '.claude-plugin', 'plugin.json'))
      await this.persist({ ...state, installations: { ...state.installations, [id]: { ...installed, diagnostic } } })
      return diagnostic
    })
  }
  setEnabled(id: string, enabled: boolean): Promise<void> {
    return this.enable(id, enabled)
  }
  private enable(id: string, enabled: boolean, migrating?: string): Promise<void> {
    return this.change(async () => {
      if (typeof enabled !== 'boolean') throw new Error('Activation invalide.')
      const state = await this.load(), entry = this.entry(state, id)
      if (migrating && state.pluginMigrations?.[migrating]?.done) return
      if (enabled && entry.kind === 'plugin') {
        const installed = await this.installation(state, entry)
        if (!installed) throw new Error('Installez l’extension avant de l’activer.')
        const path = await contained(this.store, join(this.store, installed.path)), info = await inspectPlugin(path)
        await this.validate(join(path, '.claude-plugin', 'plugin.json'))
        await this.checkName(state, id, info)
      }
      const migration = state.pluginMigrations?.[entry.name]
      await this.persist({ ...state, enabled: enabled ? [...new Set([...state.enabled, id])] : state.enabled.filter(value => value !== id),
        ...(migration ? { pluginMigrations: { ...state.pluginMigrations, [entry.name]: { enabled, done: true } } } : {}) })
    })
  }
  remove(id: string): Promise<void> {
    return this.change(async () => {
      const state = await this.load(), entry = this.entry(state, id)
      if (entry.kind !== 'plugin') throw new Error('Désinstallez cet outil avec son gestionnaire de paquets.')
      // Disable first; retain metadata on a cleanup error so the user can retry removal.
      const migration = state.pluginMigrations?.[entry.name]
      const disabled = { ...state, enabled: state.enabled.filter(value => value !== id),
        ...(migration ? { pluginMigrations: { ...state.pluginMigrations, [entry.name]: { enabled: false, done: true } } } : {}) }
      await this.persist(disabled)
      await removeManaged(this.store, join(this.store, 'packages', id))
      if (CATALOG.some(seed => seed.id === id)) await removeManaged(this.store, join(this.store, id))
      await this.persist({ ...disabled, installations: { ...state.installations, [id]: null } })
    })
  }
  /**
   * Premier lancement après la mise à jour : ajoute le catalogue officiel,
   * puis réinstalle la Bureautique pour qui l'utilisait.
   *
   * Lancé en arrière-plan : le catalogue se clone depuis GitHub, ce qui peut
   * prendre du temps ou échouer (réseau, accès au dépôt). Un échec est
   * conservé pour être affiché, et l'ajout est retenté au lancement suivant.
   * `existingProfile` distingue une mise à jour (la Bureautique était
   * incluse et active par défaut) d'une première installation, où rien
   * n'est installé d'office.
   */
  async prepareMigrations(): Promise<boolean> {
    try {
      const requests = await this.legacyPlugins()
      await this.change(async () => {
        const state = await this.load(), migrations = { ...state.pluginMigrations }
        for (const request of requests) {
          if (!/^[a-z][a-z0-9-]{0,100}$/.test(request.name) || typeof request.enabled !== 'boolean') throw new Error('Migration de plugin invalide.')
          migrations[request.name] ??= { enabled: request.enabled }
        }
        if (requests.length || state.migrationError) await this.persist({ ...state, pluginMigrations: migrations, migrationError: undefined })
      })
      return true
    } catch (error) {
      await this.change(async () => this.persist({ ...await this.load(), migrationError: `Migration des comptes impossible : ${String(error)}` }))
      return false
    }
  }

  async bootstrap(progress: (p: ExtensionProgress) => void, existingProfile: boolean, official = DEFAULT_SOURCE, catalogs: readonly typeof DEFAULT_SOURCE[] = []): Promise<void> {
    for (const catalog of catalogs) {
      const id = sourceId(repositoryAddress(catalog.repository))
      const state = await this.load()
      if (state.provisionedCatalogs?.includes(id)) continue
      try {
        if (!state.sources.some(source => source.id === id)) await this.addSource(catalog.repository, catalog.ref)
        await this.change(async () => {
          const latest = await this.load()
          const errors = { ...latest.catalogErrors }
          delete errors[id]
          await this.persist({ ...latest, catalogErrors: errors, provisionedCatalogs: [...new Set([...(latest.provisionedCatalogs ?? []), id])] })
        })
      } catch (error) {
        const message = String(error)
        await this.change(async () => {
          const latest = await this.load()
          await this.persist({ ...latest, catalogErrors: { ...latest.catalogErrors, [id]: message } })
        })
        progress({ id: 'catalogue', message, failed: true })
      }
    }
    if (!await this.prepareMigrations()) { progress({ id: 'catalogue', message: (await this.catalogueStatus()).error!, failed: true }); return }
    await this.bootstrapCatalogue(progress, existingProfile, official)
    const officialId = sourceId(repositoryAddress(official.repository))
    if ((await this.load()).defaultSource !== 'added') return
    for (const [name, migration] of Object.entries((await this.load()).pluginMigrations ?? {})) {
      if (migration.done) continue
      let error: string | undefined
      const entry = this.catalog(await this.load()).find(entry => entry.sourceId === officialId && entry.name === name)
      try {
        if (!entry) throw new Error(`${name} est absent du catalogue. Actualisez la source officielle vers ${official.ref}, puis réessayez. Les réglages du compte sont conservés.`)
        const previous = await this.installation(await this.load(), entry)
        // Une installation existante est un choix de l'utilisateur, y compris sa désactivation.
        if (!previous) {
          await this.change(async () => {
            const state = await this.load()
            await this.persist({ ...state, pluginMigrations: { ...state.pluginMigrations, [name]: { ...migration, installing: true } } })
          })
          let failure = 'Installation impossible.'
          if (!await this.install(entry.id, update => { if (update.failed) failure = update.message; progress(update) })) throw new Error(failure)
        }
        if (!previous || migration.installing) await this.enable(entry.id, migration.enabled, name)
      } catch (failure) { error = String(failure).replace(/^Error: /, '') }
      await this.change(async () => {
        const state = await this.load()
        if (state.pluginMigrations?.[name]?.done) return
        await this.persist({ ...state, pluginMigrations: { ...state.pluginMigrations, [name]: { ...state.pluginMigrations?.[name], enabled: migration.enabled, ...(error ? { error } : { done: true }) } } })
      })
      progress({ id: 'catalogue', message: error ?? `${entry?.displayName ?? name} réinstallé depuis le catalogue officiel.`, failed: Boolean(error) })
    }
  }

  private async bootstrapCatalogue(progress: (p: ExtensionProgress) => void, existingProfile: boolean, official = DEFAULT_SOURCE): Promise<void> {
    const mark = (patch: Partial<Registry>) => this.change(async () => this.persist({ ...await this.load(), ...patch }))
    let state = await this.load()
    const officialId = sourceId(repositoryAddress(official.repository))
    if (state.defaultSource !== 'added') {
      progress({ id: 'catalogue', message: 'Ajout du catalogue officiel de plugins…', failed: false })
      try {
        if (!state.sources.some(source => source.id === officialId)) await this.addSource(official.repository, official.ref)
        await mark({ defaultSource: 'added', defaultSourceError: undefined })
      } catch (error) {
        const message = String(error).replace(/^Error: /, '')
        await mark({ defaultSourceError: message })
        progress({ id: 'catalogue', message, failed: true })
        return
      }
    }
    state = await this.load()
    if (state.officeMigration === 'done') { progress({ id: 'catalogue', message: 'Catalogue à jour.', failed: false }); return }
    if (!existingProfile || state.officeEnabled === false) { await mark({ officeMigration: 'done' }); progress({ id: 'catalogue', message: 'Catalogue à jour.', failed: false }); return }
    const office = this.catalog(state).find(entry => entry.sourceId === officialId && entry.name === OFFICE_PLUGIN)
    if (!office) { await mark({ officeMigration: { error: 'le plugin est absent du catalogue officiel.' } }); return }
    let failure = 'raison inconnue.'
    const installed = await this.install(office.id, update => { if (update.failed) failure = update.message; progress(update) })
    if (!installed) { await mark({ officeMigration: { error: failure } }); return }
    try { await this.setEnabled(office.id, true) } catch (error) { await mark({ officeMigration: { error: String(error).replace(/^Error: /, '') } }); return }
    await mark({ officeMigration: 'done' })
    // Le message d'installation invitait à l'activer : c'est fait, la carte le dit.
    progress({ id: office.id, message: 'Réinstallée et activée depuis le catalogue officiel : la Bureautique n’est plus incluse dans l’application.', failed: false })
    progress({ id: 'catalogue', message: 'La Bureautique a été réinstallée depuis le catalogue officiel.', failed: false })
  }

  async catalogueStatus(): Promise<CatalogueStatus> {
    const state = await this.load()
    const errors = [...Object.values(state.catalogErrors ?? {}), state.migrationError, ...Object.values(state.pluginMigrations ?? {}).filter(item => !item.done).map(item => item.error)].filter(Boolean)
    const source = state.sources.find(item => item.id === sourceId(repositoryAddress(DEFAULT_SOURCE.repository)))
    // Une ancienne source reste épinglée : proposer la nouvelle version sans changer ce choix au démarrage.
    const update = source?.ref === 'v1.0.0' && DEFAULT_SOURCE.ref !== source.ref
      ? { sourceId: source.id, currentRef: source.ref, targetRef: DEFAULT_SOURCE.ref } : undefined
    return { added: state.defaultSource === 'added', error: errors.join('\n') || (state.defaultSource === 'added' ? undefined : state.defaultSourceError), ...(update ? { update } : {}) }
  }

  /**
   * Runtime du plugin Bureautique activé, pour la variable `OFFICE_RUNTIME`
   * que ses skills utilisent. Rien si le plugin n'est pas installé ou activé :
   * les skills expliquent alors qu'il faut l'activer.
   */
  async officeRuntime(): Promise<string | undefined> {
    const office = (await this.list()).find(entry => entry.kind === 'plugin' && entry.name === OFFICE_PLUGIN && entry.enabled && !entry.problem && entry.path)
    const runtime = office?.path ? join(office.path, 'office.cjs') : undefined
    return runtime && existsSync(runtime) ? runtime : undefined
  }

  async pluginDirs(): Promise<string[]> {
    return (await this.list()).filter(entry => entry.kind === 'plugin' && entry.enabled && !entry.problem && entry.path).map(entry => entry.path!)
  }

  async connectors(): Promise<ConnectorManifest[]> {
    return (await this.list()).flatMap(entry => entry.installed && entry.enabled && !entry.problem && entry.connector ? [entry.connector] : [])
  }
}
