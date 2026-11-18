/**
 * Modèles locaux : ce qui est installé, ce qu'on peut ajouter, ce qui tourne.
 *
 * Les poids viennent de Hugging Face et sont exécutés par `llama-server`.
 * Aucun autre logiciel n'a besoin d'être installé ni lancé : l'application
 * télécharge le fichier, télécharge le moteur qui le lit, et le met en
 * service. Ollama reste possible comme fournisseur, mais n'est plus sur le
 * chemin.
 *
 * Le catalogue est court et commenté plutôt qu'exhaustif. Hugging Face publie
 * des centaines de milliers de fichiers ; les lister tous obligerait à choisir
 * sans critère. Ceux retenus le sont pour une raison précise, écrite en clair
 * — un modèle qui ne sait pas appeler d'outils est inutilisable par le moteur,
 * quelle que soit sa réputation par ailleurs.
 */

import * as React from 'react'
import type {
  InstalledModel,
  ModelProgress,
  ModelsConfig,
  QuantOption,
  ResolvedRepo,
  RuntimeBackend,
  ServerStatus,
} from '../../main/preload.js'
import { CATALOG } from '../../shared/modelCatalog.js'
import { Icon } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'
import { SettingsPage } from '../ui/SettingRows.js'

const GIGA = 1e9

export function ModelSettings({ providerKind }: { providerKind?: import('../../main/preload.js').ProviderKind } = {}): React.ReactNode {
  const [config, setConfig] = React.useState<ModelsConfig | null>(null)
  const [installed, setInstalled] = React.useState<InstalledModel[]>([])
  const [status, setStatus] = React.useState<ServerStatus | null>(null)
  const [progress, setProgress] = React.useState<Record<string, ModelProgress>>({})

  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const refresh = React.useCallback(async () => {
    try {
    setInstalled(await window.engine.installedModels())
    setStatus(await window.engine.modelServerStatus())
    // La configuration porte le registre des modèles installés hors
    // catalogue : une installation la change, et sans relecture le modèle
    // apparaîtrait sans son dépôt d'origine.
    setConfig(await window.engine.modelsConfig())
    } catch (error) { setError(String(error)) }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  React.useEffect(() => {
    return window.engine.onModelProgress(update => {
      setProgress(current => ({ ...current, [update.id]: update }))
      // Une étape terminée change ce qui est sur le disque et ce qui tourne :
      // on relit plutôt que de supposer le résultat.
      if (update.done) void refresh()
    })
  }, [refresh])

  const action = async (run: () => Promise<unknown>) => {
    setError(null)
    try { await run(); await refresh() } catch (error) { setError(String(error)) }
  }
  const have = new Map(installed.map(model => [model.id, model]))
  const serving = status?.running ? status.model : null

  return (
    <SettingsPage
      title="Modèles locaux"
      lead="Les modèles que llama.cpp fait tourner sur ce poste : téléchargement, emplacement des fichiers et mise en service."
      actions={<button type="button" className="ghost" onClick={() => { setError(null); void refresh() }}>Actualiser les modèles</button>}
    >
      {/* Cet écran ne concerne qu'un fournisseur : le dire évite de croire
          qu'on choisit ici le modèle d'un serveur distant ou de l'API OpenAI. */}
      {providerKind && providerKind !== 'llamacpp' && <p className="settings-callout" role="status">
        {providerKind === 'ollama'
          ? 'Votre fournisseur est Ollama : il gère ses propres modèles (ollama pull). Ceux de cette page ne servent qu’avec le fournisseur llama.cpp.'
          : 'Votre fournisseur propose ses propres modèles, à choisir dans le composeur. Ceux de cette page ne servent qu’avec le fournisseur llama.cpp.'}
      </p>}
      <label className="technical-search">Rechercher un modèle<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
      {error && <p role="alert" className="settings-error">{error}</p>}

      {query.trim() && !CATALOG.some(entry => `${entry.label} ${entry.summary}`.toLowerCase().includes(query.trim().toLowerCase())) && !installed.some(model => model.label.toLowerCase().includes(query.trim().toLowerCase())) && <p role="status">Aucun modèle ne correspond à la recherche.</p>}

      <p className="settings-note">
        Les poids sont téléchargés depuis Hugging Face et exécutés par{' '}
        <code>llama-server</code>. Le moteur d’inférence s’installe tout seul à
        la première mise en service. Le téléchargement se compte en gigaoctets,
        se poursuit en arrière-plan, et reprend là où il s’est arrêté.
      </p>

      {config && (
        <Location
          config={config}
          onConfig={setConfig}
          onChoose={async () => {
            const next = await window.engine.chooseModelsRoot().catch(error => { setError(String(error)); return null })
            if (next) {
              setConfig(next)
              void refresh()
            }
          }}
        />
      )}

      {/* Le moteur d'inférence s'installe sous son propre identifiant, pas
          sous celui du modèle : sans cette ligne, son téléchargement — et
          surtout son échec — n'apparaîtrait nulle part, et la mise en service
          semblerait ne rien faire. */}
      {progress.runtime && (
        <div
          className={
            progress.runtime.failed ? 'ext-activity failed' : 'ext-activity'
          }
        >
          {progress.runtime.ratio !== null && !progress.runtime.failed && (
            <span className="corpus-bar">
              <span
                className="corpus-fill"
                style={{ width: `${Math.round(progress.runtime.ratio * 100)}%` }}
              />
            </span>
          )}
          {progress.runtime.status}
        </div>
      )}

      {status && (
        <ServerLine
          status={status}
          label={serving ? (have.get(serving)?.label ?? serving) : null}
          onStop={async () => {
            await action(() => window.engine.stopModel())
            void refresh()
          }}
        />
      )}

      <HuggingFace progress={progress} onInstalled={refresh} />

      <section className="settings-section">
        <h3>Catalogue</h3>
        <div className="ext-list">
          {CATALOG.filter(entry => `${entry.label} ${entry.summary}`.toLowerCase().includes(query.trim().toLowerCase())).map(entry => (
            <ModelRow
              key={entry.id}
              label={entry.label}
              summary={entry.summary}
              source={`${entry.repo} · ${entry.file}`}
              bytes={entry.bytes + (entry.mmprojBytes ?? 0)}
              vision={Boolean(entry.mmproj)}
              installed={have.has(entry.id)}
              serving={serving === entry.id}
              progress={progress[entry.id]}
              onDownload={() => void action(() => window.engine.downloadModel(entry.id))}
              onCancel={() => void action(() => window.engine.cancelModel(entry.id))}
              onStart={() => void action(() => window.engine.startModel(entry.id))}
              onRemove={async () => {
                await action(() => window.engine.removeModel(entry.id))
                void refresh()
              }}
            />
          ))}
        </div>
      </section>

      {/* Les fichiers présents mais absents du catalogue existent : installés
          depuis un dépôt collé, déposés à la main, ou hérités d'un autre
          usage. Les taire donnerait une liste fausse, et ils sont parfaitement
          utilisables. */}
      {installed.some(model => !CATALOG.some(entry => entry.id === model.id)) && (
        <section className="settings-section">
          <h3>Également présents</h3>
          <div className="ext-list">
            {installed
              .filter(model => !CATALOG.some(entry => entry.id === model.id) && model.label.toLowerCase().includes(query.trim().toLowerCase()))
              .map(model => {
                // Le registre sait d'où vient un modèle installé depuis un
                // dépôt ; un fichier simplement déposé, non.
                const known = config?.custom.find(entry => entry.id === model.id)
                return (
                  <ModelRow
                    key={model.id}
                    label={model.label}
                    summary={
                      known
                        ? `Installé depuis Hugging Face${known.shards.length ? ` · ${known.shards.length + 1} tranches` : ''}.`
                        : 'Déposé dans le dossier des modèles.'
                    }
                    source={known ? `${known.repo} · ${known.file}` : model.file}
                    bytes={model.bytes}
                    vision={Boolean(known?.mmproj)}
                    installed
                    serving={serving === model.id}
                    progress={progress[model.id]}
                    onStart={() => void action(() => window.engine.startModel(model.id))}
                    onRemove={async () => {
                      await action(() => window.engine.removeModel(model.id))
                      void refresh()
                    }}
                  />
                )
              })}
          </div>
        </section>
      )}
    </SettingsPage>
  )
}

/**
 * Emplacement des poids et dos d'exécution.
 *
 * Les deux ensemble parce que changer l'un sans voir l'autre mène à des
 * surprises : le moteur d'inférence est installé à côté des poids, et changer
 * de dos en télécharge un second.
 */
function Location({
  config,
  onConfig,
  onChoose,
}: {
  config: ModelsConfig
  onConfig: (next: ModelsConfig) => void
  onChoose: () => void
}): React.ReactNode {
  const [error, setError] = React.useState<string | null>(null)
  return (
    <section className="settings-section">
      <h3>Emplacement</h3>
      {error && <p role="alert" className="settings-error">{error}</p>}
      <div className="settings-row">
        <code className="settings-path">{config.root}</code>
        <button type="button" onClick={onChoose}>
          Changer…
        </button>
      </div>
      <p className="settings-hint">
        Un modèle pèse de 3 à 20 Go. Gardez-les hors du disque système.
      </p>

      <div className="settings-row">
        <label htmlFor="backend">Exécution</label>
        <select
          id="backend"
          value={config.backend}
          onChange={async event => {
            onConfig(
              await window.engine.setModelsConfig({
                backend: event.target.value as RuntimeBackend,
              }).catch(error => { setError(String(error)); return config }),
            )
          }}
        >
          <option value="cpu">Processeur</option>
          <option value="vulkan">Carte graphique (Vulkan)</option>
        </select>
      </div>
      <p className="settings-hint">
        Vulkan accélère nettement, à condition que le modèle tienne dans la
        mémoire de la carte. Ce qui dépasse retombe sur le processeur.
      </p>

      {/* Le nombre de couches confiées à la carte se réglait ici à la main.
          llama.cpp le calcule désormais lui-même à partir du contexte demandé
          et de la mémoire libre, et il le fait mieux : sur ce poste, sa
          répartition automatique égale les 28 couches réglées à la main, à
          262 k jetons de contexte au lieu de 16 k. Imposer le nombre lui
          faisait abandonner le calcul entier. */}

      <div className="settings-row">
        <label htmlFor="context">Contexte</label>
        <select
          id="context"
          value={String(config.context)}
          onChange={async event => {
            onConfig(
              await window.engine.setModelsConfig({
                context: Number(event.target.value),
              }).catch(error => { setError(String(error)); return config }),
            )
          }}
        >
          <option value="32768">32 k jetons</option>
          <option value="65536">65 k jetons</option>
          <option value="131072">131 k jetons</option>
          <option value="262144">262 k jetons — le maximum des Qwen3</option>
        </select>
      </div>
      <p className="settings-hint">
        Le seul réglage de performance qui reste : llama.cpp en déduit lui-même
        ce qu’il peut confier à la carte. L’invite du moteur pèse à elle seule
        plus de 15 000 jetons, d’où le plancher de 32 k — en dessous, la
        conversation est refusée dès les premiers échanges. Monter coûte
        étonnamment peu : mesuré sur un 27B et une carte de 12 Go, passer de
        32 k à 262 k fait perdre moins de 10 % de débit, parce que la carte est
        pleine dans les deux cas et que seules quelques couches de plus
        retombent sur le processeur. Une valeur que la mémoire ne peut pas
        tenir fait échouer la mise en service, sans rien casser. Le changement
        prend effet à la prochaine mise en service.
      </p>
    </section>
  )
}

/**
 * Installation d'un modèle hors catalogue.
 *
 * Le geste tient en trois temps : coller, choisir, installer. Le catalogue
 * couvre ce que nous avons retenu d'avance ; ici c'est l'utilisateur qui
 * décide, y compris d'un modèle publié la veille.
 *
 * Les messages d'échec du résolveur sont affichés tels quels : ils sont écrits
 * pour être lus par la personne qui a collé l'adresse, et les reformuler
 * perdrait ce qu'ils disent de précis — dépôt privé, format non-GGUF, réseau.
 */
function HuggingFace({
  progress,
  onInstalled,
}: {
  progress: Record<string, ModelProgress>
  onInstalled: () => void
}): React.ReactNode {
  const [input, setInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [repo, setRepo] = React.useState<ResolvedRepo | null>(null)
  const [chosen, setChosen] = React.useState<string | null>(null)

  const resolve = React.useCallback(async () => {
    if (!input.trim()) return
    setBusy(true)
    setError(null)
    setRepo(null)
    const result = await window.engine.resolveHuggingFace(input).catch(error => ({ ok: false as const, reason: String(error) }))
    setBusy(false)
    if (!result.ok) {
      setError(result.reason)
      return
    }
    setRepo(result.repo)
    // L'option conseillée est présélectionnée : c'est celle qu'on installerait
    // à sa place, et lui faire choisir dans une liste de quinze
    // quantifications sans point de départ est un travail qu'on lui épargne.
    setChosen(result.repo.recommended?.id ?? result.repo.options[0]?.id ?? null)
  }, [input])

  const option: QuantOption | null =
    repo?.options.find(entry => entry.id === chosen) ?? null
  const running = option ? progress[option.id] : undefined
  const downloading = running !== undefined && !running.done

  return (
    <section className="settings-section">
      <h3>Hugging Face</h3>
      <p className="settings-hint">
        Collez l’adresse d’un dépôt — la page du modèle, un lien vers un
        fichier, ou simplement <code>propriétaire/nom</code>. Seuls les fichiers
        GGUF sont proposés : <code>llama-server</code> ne lit rien d’autre.
      </p>

      <div className="settings-row">
        <input
          type="text"
          style={{ flex: 1 }}
          value={input}
          placeholder="https://huggingface.co/unsloth/Qwen3-8B-GGUF"
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') void resolve()
          }}
        />
        <button type="button" onClick={() => void resolve()} disabled={busy}>
          {busy ? 'Recherche…' : 'Résoudre'}
        </button>
      </div>

      {error && (
        <p className="settings-error">
          <Icon name="close" size={12} />
          {error}
        </p>
      )}

      {repo && (
        <>
          <p className="settings-ok">
            <Icon name="check" size={12} />
            <span>
              <strong>{repo.repo}</strong> — {repo.options.length} quantification
              {repo.options.length > 1 ? 's' : ''} disponible
              {repo.options.length > 1 ? 's' : ''}.
            </span>
          </p>

          {/* Un dépôt sous conditions répond 403 au téléchargement anonyme :
              le dire avant l'installation évite une attente qui finit sur une
              erreur HTTP nue. */}
          {repo.gated && (
            <p className="settings-error">
              <Icon name="close" size={12} />
              Ce dépôt exige d’accepter des conditions sur Hugging Face. Le
              téléchargement anonyme reste refusé même après acceptation.
            </p>
          )}

          <fieldset className="choices">
            <legend>Quantification</legend>
            {repo.options.map(entry => (
              <label
                key={entry.id}
                className={chosen === entry.id ? 'choice active' : 'choice'}
              >
                <input
                  type="radio"
                  name="quant"
                  checked={chosen === entry.id}
                  onChange={() => setChosen(entry.id)}
                />
                <span className="choice-body">
                  <span className="choice-label">
                    {entry.label} · {(entry.totalBytes / GIGA).toFixed(1)} Go
                    {repo.recommended?.id === entry.id && (
                      <span className="ext-found"> conseillé</span>
                    )}
                  </span>
                  <span className="choice-hint">
                    {entry.shards.length > 0
                      ? `${entry.shards.length + 1} tranches`
                      : entry.file.path}
                    {entry.mmproj ? ' · projecteur visuel inclus' : ''}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="settings-row">
            {downloading ? (
              <button
                type="button"
                onClick={() => option && void window.engine.cancelModel(option.id).catch(error => setError(String(error)))}
              >
                Annuler
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={!option}
                onClick={async () => {
                  if (!option) return
                  try { await window.engine.installHuggingFace(repo.repo, option); onInstalled() } catch (error) { setError(String(error)) }
                }}
              >
                Installer
              </button>
            )}
          </div>

          {running && (
            <div className={running.failed ? 'ext-activity failed' : 'ext-activity'}>
              {running.ratio !== null && !running.failed && (
                <span className="corpus-bar">
                  <span
                    className="corpus-fill"
                    style={{ width: `${Math.round(running.ratio * 100)}%` }}
                  />
                </span>
              )}
              {running.status}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ServerLine({
  status,
  label,
  onStop,
}: {
  status: ServerStatus
  label: string | null
  onStop: () => void
}): React.ReactNode {
  if (!status.running) {
    return (
      <p className="settings-hint">
        Aucun modèle en service. « Mettre en service » démarre{' '}
        <code>llama-server</code> sur le port {status.port}.
      </p>
    )
  }
  return (
    <section className="settings-section">
      <div className="settings-row">
        <span className="ext-found">En service</span>
        <strong>{label}</strong>
        <code className="settings-path">http://127.0.0.1:{status.port}/v1</code>
        <button type="button" onClick={onStop}>
          Arrêter
        </button>
      </div>
    </section>
  )
}

function ModelRow({
  label,
  summary,
  source,
  bytes,
  vision,
  installed,
  serving,
  progress,
  onDownload,
  onCancel,
  onStart,
  onRemove,
}: {
  label: string
  summary: string
  source: string
  bytes: number
  vision: boolean
  installed: boolean
  serving: boolean
  progress: ModelProgress | undefined
  onDownload?: () => void
  onCancel?: () => void
  onStart: () => void
  onRemove: () => void
}): React.ReactNode {
  const busy = progress !== undefined && !progress.done

  return (
    <section className="ext">
      <div className="ext-head">
        <span className={installed ? 'ext-name' : 'ext-name not-installed'}>
          {label}
        </span>
        <span className="corpus-meta">{(bytes / GIGA).toFixed(1)} Go</span>
        {vision && <span className="ext-found">images</span>}

        {serving ? (
          <span className="ext-found">en service</span>
        ) : busy ? (
          <>
            <span className="ext-busy">
              {progress.ratio !== null
                ? `${Math.round(progress.ratio * 100)} %`
                : '…'}
            </span>
            {onCancel && (
              <button type="button" onClick={onCancel}>
                Annuler
              </button>
            )}
          </>
        ) : installed ? (
          <>
            <button type="button" className="primary" onClick={onStart}>
              Mettre en service
            </button>
            <IconButton icon="close" size={13} onClick={onRemove} title={`Supprimer ${label}`} />
          </>
        ) : (
          onDownload && (
            <button type="button" className="primary" onClick={onDownload}>
              Télécharger
            </button>
          )
        )}
      </div>

      <p className="ext-summary">{summary}</p>
      <div className="ext-meta">
        <span className="ext-repo">{source}</span>
      </div>

      {progress && (
        <div className={progress.failed ? 'ext-activity failed' : 'ext-activity'}>
          {progress.ratio !== null && !progress.failed && (
            <span className="corpus-bar">
              <span
                className="corpus-fill"
                style={{ width: `${Math.round(progress.ratio * 100)}%` }}
              />
            </span>
          )}
          {progress.status}
        </div>
      )}
    </section>
  )
}
