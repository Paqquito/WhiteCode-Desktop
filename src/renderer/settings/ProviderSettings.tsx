import { OpenAIFields } from './OpenAIFields.js'
/**
 * Choix du fournisseur de modèles.
 *
 * Serveur d'inférence compatible, API compatible OpenAI et modèles locaux.
 * Ollama utilise un pont local pour traduire le protocole du moteur.
 */

import * as React from 'react'
import { Field } from '../ui/Field.js'
import { SettingsPage } from '../ui/SettingRows.js'
import type {
  InstalledModel,
  OllamaModel,
  ProviderConfig,
  ProviderKind,
} from '../../main/preload.js'
import { DEFAULT_OLLAMA_HOST, usesGateway, useProvider } from '../state/useProvider.js'
import { Icon } from '../ui/Icon.js'

const KINDS: Array<{ id: ProviderKind; label: string; hint: string }> = [
  {
    id: 'compatible',
    label: 'Serveur d’inférence compatible',
    hint: 'Un serveur qui parle le protocole Messages du moteur (LiteLLM, llama-server distant…), avec son adresse et, si besoin, un jeton.',
  },
  { id: 'openai', label: 'API compatible OpenAI', hint: 'Serveur Chat Completions, avec adresse, clé et modèle de votre choix.' },
  {
    id: 'llamacpp',
    label: 'llama.cpp — modèles de ce poste',
    hint: 'Les fichiers GGUF installés ici, servis directement. Aucun pont : le serveur parle déjà le protocole du moteur.',
  },
  {
    id: 'ollama',
    label: 'Ollama — modèles locaux',
    hint: 'Les modèles téléchargés sur ce poste, par un pont de traduction.',
  },
]


export function ProviderSettings({
  provider,
  reducedTools,
  onReducedTools,
}: {
  provider: ReturnType<typeof useProvider>
  /** Jeu d'outils restreint : le principal levier sur le temps de réponse. */
  reducedTools: boolean
  onReducedTools: (reduced: boolean) => void
}): React.ReactNode {
  const {
    config,
    models,
    localModels,
    gatewayModels,
    gatewayError,
    storageError,
    ollamaError,
    probing,
    apply,
    probeOllama,
  } = provider
  const host = config.ollamaHost ?? DEFAULT_OLLAMA_HOST
  /** Les deux fournisseurs qui calculent sur ce poste, quel que soit le moyen. */
  const local = config.kind === 'ollama' || config.kind === 'llamacpp'

  // Ollama n'est interrogé que quand on le regarde : le serveur peut être
  // arrêté, et sonder en permanence produirait des erreurs sans objet.
  React.useEffect(() => {
    if (config.kind === 'ollama') void probeOllama(host)
  }, [config.kind, host, probeOllama])

  return (
    <SettingsPage title="Fournisseur" lead="Le service qui fait tourner les modèles de vos conversations, et le compte qui y donne accès.">
      {storageError && <p className="settings-error" role="alert">{storageError}</p>}
      <fieldset className="choices">
        <legend>Service</legend>
        {KINDS.map(kind => (
          <label
            key={kind.id}
            className={config.kind === kind.id ? 'choice active' : 'choice'}
          >
            <input
              type="radio"
              name="provider"
              checked={config.kind === kind.id}
              onChange={() => {
                apply({ ...config, kind: kind.id })
                // Choisir un modèle local active le jeu réduit d'office : avec
                // les soixante-quatre outils, le tour n'aboutit pas du tout.
                // Un défaut qui échoue serait pire qu'un défaut opiniâtre, et
                // la case reste décochable juste en dessous.
                if (
                  (kind.id === 'ollama' || kind.id === 'llamacpp') &&
                  !reducedTools
                ) {
                  onReducedTools(true)
                }
              }}
            />
            <span className="choice-body">
              <span className="choice-label">{kind.label}</span>
              <span className="choice-hint">{kind.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {local && !reducedTools && (
        <p className="settings-error">
          <Icon name="close" size={12} />
          Avec le jeu d’outils complet — soixante-quatre outils, dont ceux
          hérités de votre configuration Claude Code — l’invite système dépasse
          ce qu’un modèle local peut relire dans le temps imparti, et la réponse
          échoue sur « error_during_execution ». Cochez la case ci-dessous.
        </p>
      )}

      {(local || usesGateway(config.kind) || config.kind === 'openai') && (
        <section className="settings-section">
          <label className="toggle">
            <input
              type="checkbox"
              checked={reducedTools}
              onChange={e => onReducedTools(e.target.checked)}
            />
            <span>
              Jeu d’outils réduit
              <span className="field-hint">
                Sept outils au lieu de trente-cinq. Ce n’est pas un détail : la
                définition des outils occupe l’essentiel de l’invite système —
                environ 25 000 jetons — que le modèle relit à chaque tour. Sur
                un processeur, cette seule lecture prend plusieurs minutes et le
                moteur abandonne avant la réponse. À laisser coché tant que le
                modèle tourne sans carte graphique.
              </span>
            </span>
          </label>
        </section>
      )}

      {config.kind === 'openai' && <OpenAIFields config={config} onApply={apply} />}

      {config.kind === 'ollama' && (
        <OllamaFields
          config={config}
          host={host}
          models={models}
          error={ollamaError}
          probing={probing}
          onApply={apply}
          onProbe={() => void probeOllama(host)}
        />
      )}

      {config.kind === 'llamacpp' && (
        <LlamaCppFields config={config} models={localModels} onApply={apply} />
      )}

      {config.kind === 'compatible' && <CompatibleFields config={config} onApply={apply} />}

      {usesGateway(config.kind) && gatewayError && (
        <p className="settings-error">
          <Icon name="close" size={12} />
          {gatewayError}
        </p>
      )}
      {usesGateway(config.kind) && gatewayModels && (
        <p className="settings-ok">
          <Icon name="check" size={12} />
          <span>
            Serveur joint —{' '}
            <strong>
              {gatewayModels.map(model => model.label).join(', ')}
            </strong>
            . Le modèle se choisit dans le composeur, sous la zone de saisie.
          </span>
        </p>
      )}

      <p className="settings-note">
        Le changement s’applique au prochain message : le moteur repart en
        sous-processus à chaque message, il n’y a rien à redémarrer.
      </p>
    </SettingsPage>
  )
}

/** Adresse et jeton d'un serveur compatible ; le jeton est conservé chiffré par le processus principal. */
function CompatibleFields({
  config,
  onApply,
}: {
  config: ProviderConfig
  onApply: (next: ProviderConfig) => void | Promise<void>
}): React.ReactNode {
  const [baseUrl, setBaseUrl] = React.useState(config.baseUrl ?? '')
  const [token, setToken] = React.useState(config.token ?? '')
  React.useEffect(() => { setBaseUrl(config.baseUrl ?? ''); setToken(config.token ?? '') }, [config.baseUrl, config.token])
  const changed = baseUrl.trim() !== (config.baseUrl ?? '') || token !== (config.token ?? '')
  return (
    <form className="settings-section" onSubmit={event => {
      event.preventDefault()
      void onApply({ ...config, baseUrl: baseUrl.trim() || undefined, token: token || undefined })
    }}>
      <Field label="Adresse du serveur">
        <input type="url" value={baseUrl} placeholder="http://127.0.0.1:4000" spellCheck={false}
          onChange={e => setBaseUrl(e.target.value)} />
      </Field>
      <Field label="Jeton (facultatif)">
        <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} />
      </Field>
      <div className="form-actions">
        <button type="submit" disabled={!changed}>Enregistrer</button>
      </div>
    </form>
  )
}

export function accountError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    .replace(/^Error: /, '')
}

/**
 * Choix du modèle servi par `llama-server`.
 *
 * Rien d'autre à régler : ni adresse ni jeton. Le serveur tourne sur ce poste,
 * l'application le démarre elle-même au premier message, et il parle déjà le
 * protocole du moteur — c'est tout l'intérêt par rapport à Ollama. Ce qui
 * reste à décider — emplacement, contexte, couches sur la carte — vit dans
 * l'onglet Modèles, avec les fichiers qu'il concerne.
 */
function LlamaCppFields({
  config,
  models,
  onApply,
}: {
  config: ProviderConfig
  models: InstalledModel[]
  onApply: (next: ProviderConfig) => void
}): React.ReactNode {
  return (
    <section className="settings-section">
      {models.length === 0 ? (
        <p className="settings-error">
          <Icon name="close" size={12} />
          Aucun modèle installé sur ce poste. Ouvrez l’onglet « Modèles » pour
          en prendre un au catalogue, ou coller l’adresse d’un dépôt Hugging
          Face.
        </p>
      ) : (
        <Field
          label="Modèle"
          hint="Mis en service au premier message. Le chargement des poids prend de quelques secondes à quelques minutes."
        >
          <select
            value={config.llamacppModel ?? ''}
            onChange={e => onApply({ ...config, llamacppModel: e.target.value })}
          >
            <option value="">— choisir —</option>
            {models.map(model => (
              <option key={model.id} value={model.id}>
                {model.label} · {(model.bytes / 1e9).toFixed(1)} Go
              </option>
            ))}
          </select>
        </Field>
      )}

      <p className="settings-note">
        Aucun pont : <code>llama-server</code> sert nativement le protocole du
        moteur. Il tient son propre cache de préfixe — la relecture d’une
        conversation longue passe de plusieurs minutes à quelques secondes —
        mais il est automatique et sans rapport avec le décompte de jetons mis
        en cache, désactivé ici pour que les chiffres affichés restent honnêtes.
      </p>
    </section>
  )
}

function OllamaFields({
  config,
  host,
  models,
  error,
  probing,
  onApply,
  onProbe,
}: {
  config: ProviderConfig
  host: string
  models: OllamaModel[] | null
  error: string | null
  probing: boolean
  onApply: (next: ProviderConfig) => void
  onProbe: () => void
}): React.ReactNode {
  // Seuls les modèles sachant appeler des outils sont utilisables : le moteur
  // ne fait rien sans outils, et un modèle qui les ignore répondrait du texte
  // là où on attend une lecture de fichier ou une commande.
  const usable = models?.filter(model => model.tools) ?? []
  const unusable = models?.filter(model => !model.tools) ?? []

  return (
    <section className="settings-section">
      <Field label="Serveur Ollama">
        <div className="field-row">
          <input
            type="text"
            value={host}
            onChange={e => onApply({ ...config, ollamaHost: e.target.value })}
          />
          <button type="button" className="ghost" onClick={onProbe} disabled={probing}>
            {probing ? 'Recherche…' : 'Actualiser'}
          </button>
        </div>
      </Field>

      {error && (
        <p className="settings-error">
          <Icon name="close" size={12} />
          {error}
        </p>
      )}

      {models && (
        <Field
          label="Modèle"
          hint="Seuls les modèles capables d’appeler des outils sont proposés."
        >
          <select
            value={config.ollamaModel ?? ''}
            onChange={e => onApply({ ...config, ollamaModel: e.target.value })}
          >
            <option value="">— choisir —</option>
            {usable.map(model => (
              <option key={model.name} value={model.name}>
                {model.name} · {(model.bytes / 1e9).toFixed(1)} Go
                {model.vision ? ' · images' : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      {unusable.length > 0 && (
        <p className="settings-note">
          Écartés faute de gestion des outils : {unusable.map(m => m.name).join(', ')}.
          Le moteur lit des fichiers et lance des commandes par ce mécanisme ;
          sans lui, le modèle ne pourrait que discuter.
        </p>
      )}

      <Field
        label="Fenêtre de contexte"
        hint="Ollama retombe sinon sur 4096 jetons, très en deçà de ce que le moteur envoie. Une valeur élevée demande de la mémoire vidéo : au-delà de ce que la carte offre, le calcul bascule sur le processeur et devient très lent."
      >
        <input
          type="number"
          min={4096}
          step={4096}
          value={config.ollamaContext ?? 32768}
          onChange={e =>
            onApply({ ...config, ollamaContext: Number(e.target.value) || 32768 })
          }
        />
      </Field>

      <p className="settings-note">
        Ollama ne parle pas le protocole du moteur : un pont local traduit les
        échanges dans les deux sens, y compris les appels d’outils. La mise en
        cache de contexte n’a pas d’équivalent et reste inactive ; les jetons
        rapportés sont ceux d’Ollama, non comparables à ceux d’un modèle Claude.
      </p>
    </section>
  )
}
