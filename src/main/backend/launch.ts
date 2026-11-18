import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SessionSettings } from '#desktop/session-protocol'
import { approvalMode, whiteCodeTools } from './protocol.js'

/** Application folder (with `dist/distribution.json`) and engine folder (with the product executable in `dist/`). */
export type RuntimeRoots = { appRoot: string; engineRoot: string }

export type Distribution = { product: string; cli: string; slug: string; envPrefix: string; urlScheme: string; instructionsFile: string; bundleId: string; extensionCatalogs?: { repository: string; ref: string }[] }
/** `appRoot` is the desktop application folder; its build writes `dist/distribution.json` from the validated identity. */
export function distribution(appRoot: string): Distribution {
  const descriptor = join(appRoot, 'dist', 'distribution.json')
  // This synchronous descriptor is generated from the validated build identity.
  const data = JSON.parse(readFileSync(descriptor, 'utf8'))
  if (!data || !/^[a-z][a-z0-9-]{1,31}$/.test(data.cli) || !/^[A-Z][A-Z0-9_]*_$/.test(data.envPrefix) || typeof data.product !== 'string' || typeof data.bundleId !== 'string') throw new Error('Identité de distribution invalide : reconstruisez l’application desktop.')
  return data
}

/** `engineRoot` is the engine folder whose build produced the product executable in `dist/`. */
export function backendCommand(engineRoot: string, id: Distribution): { file: string; args: string[] } {
  const file = join(engineRoot, 'dist', id.cli + (process.platform === 'win32' ? '.exe' : ''))
  if (!existsSync(file)) throw new Error(`Moteur WhiteCode introuvable : ${file}. Construisez la distribution avant de lancer l’application.`)
  return { file, args: [] }
}

let writing: Promise<unknown> = Promise.resolve()
export function configureBackend(configDir: string, model: string, contextWindow: number): Promise<void> {
  const next = writing.then(async () => {
    await mkdir(configDir, { recursive: true })
    const file = join(configDir, 'config.json')
    let saved: any = {}
    try { saved = JSON.parse(await readFile(file, 'utf8')) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Configuration WhiteCode illisible ; fichier conservé.') }
    const catalogue: any[] = saved.models?.extraCatalog ?? []
    const previous = catalogue.find(entry => entry.id === model)
    const entry = previous ?? { id: model, provider: 'anthropic', family: 'configured', label: model, contextWindow, maxOutputTokens: Math.min(8192, Math.floor(contextWindow / 4)), capabilities: { toolCalling: true, thinking: 'none' } }
    const config = { ...saved, api: { ...saved.api, provider: 'anthropic' }, models: { ...saved.models, extraCatalog: [...catalogue.filter(entry => entry.id !== model), entry] },
      engine: { ...saved.engine, control: { ...saved.engine?.control, allowEscalation: true } }, schedule: { ...saved.schedule, enabled: false },
      // A desktop turn closes its native process; session-end consolidation cannot finish there.
      memory: { ...saved.memory, consolidationEnabled: false },
      notifications: { ...saved.notifications, channel: 'disabled' }, ui: { ...saved.ui, language: saved.ui?.language ?? 'fr', notifications: { ...saved.ui?.notifications, agentEnabled: false } } }
    const temporary = `${file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' }); await rename(temporary, file)
  })
  writing = next.catch(() => {})
  return next
}

export function backendEnvironment(id: Distribution, configDir: string, baseUrl: string, key: string): Record<string, string> {
  return { [`${id.envPrefix}CONFIG_HOME`]: configDir, [`${id.envPrefix}NO_AUTO_UPDATES`]: 'true', [`${id.envPrefix}NO_TELEMETRY`]: 'true', [`${id.envPrefix}NO_ERROR_REPORTS`]: 'true', ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_API_KEY: key, ANTHROPIC_AUTH_TOKEN: '' }
}

export function backendArguments(settings: SessionSettings, { resume, fork, sourceProject, chat }: {
  resume?: string | null; fork?: boolean; sourceProject?: string; chat?: boolean
} = {}): string[] {
  const runtime = { ...(settings.effort ? { models: { effort: settings.effort === 'max' ? 'high' : settings.effort } } : {}) }
  const args = ['--non-interactive', '--control-channel', '--request-format', 'jsonl', '--result-format', 'jsonl', '--approval-mode', approvalMode(settings.permissionMode), '--allow-unrestricted-mode', '--no-hooks', '--config-scopes', chat ? 'user' : 'user,project,local', '--config-source', JSON.stringify(runtime), '--connectors', '{"servers":{}}', '--connectors-only']
  if (settings.tools) args.push('--toolset', whiteCodeTools(settings.tools).join(','))
  for (const dir of settings.extraDirs ?? []) args.push('--allow-dir', dir)
  if (settings.projectInstructions?.trim()) args.push('--add-system-instructions', settings.projectInstructions.trim())
  if (resume) { args.push(`--reopen=${resume}`); if (fork) args.push('--reopen-as-copy') }
  if (resume && fork && sourceProject) args.push(`--reopen-project=${sourceProject}`, '--reopen-here')
  return args
}

export const DESKTOP_DELIVERY_INSTRUCTIONS = 'Dans cette application, livrer les fichiers avec deliver_file en précisant mode="attach", y compris les images. Le mode render du canal de livraison n’est pas pris en charge ; les fichiers livrés restent consultables dans l’aperçu de l’application.'
