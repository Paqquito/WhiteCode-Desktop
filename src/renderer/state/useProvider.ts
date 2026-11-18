/**
 * Fournisseur de modèles.
 *
 * Conservé côté processus principal, qui seul peut composer l'environnement du
 * moteur et tenir le pont Ollama. Le rendu n'en garde qu'une copie pour
 * l'affichage, relue au montage.
 */

import * as React from 'react'
import type {
  GatewayModel,
  InstalledModel,
  OllamaModel,
  ProviderConfig,
  ProviderKind,
} from '../../main/preload.js'

export const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'

/** Fournisseur dont la liste de modèles est publiée par le serveur lui-même. */
export function usesGateway(kind: ProviderKind): boolean {
  return kind === 'compatible'
}

export function useProvider() {
  // Serveur compatible non configuré en attendant la lecture du disque.
  const [config, setConfig] = React.useState<ProviderConfig>({ kind: 'compatible' })
  const probeOllamaRef = React.useRef<(host: string) => Promise<void>>(async () => {})
  const [models, setModels] = React.useState<OllamaModel[] | null>(null)
  const [ollamaError, setOllamaError] = React.useState<string | null>(null)
  const [probing, setProbing] = React.useState(false)
  const [storageError, setStorageError] = React.useState<string | null>(null)
  const revision = React.useRef(0)

  React.useEffect(() => {
    const load = () => {
      const current = ++revision.current
      void window.engine.getProvider().then(next => {
        if (current === revision.current) {
          setConfig(next)
          setStorageError(null)
        }
      }).catch(error => {
        if (current === revision.current) setStorageError(String(error))
      })
    }
    load()
    return () => { ++revision.current }
  }, [])

  // Le sélecteur de modèle du composeur a besoin de la liste dès l'ouverture
  // de l'application, pas seulement quand on ouvre les paramètres.
  React.useEffect(() => {
    if (config.kind !== 'ollama') return
    void probeOllamaRef.current(config.ollamaHost ?? DEFAULT_OLLAMA_HOST)
  }, [config.kind, config.ollamaHost])

  /**
   * Modèles publiés par la passerelle.
   *
   * Distincts de ceux d'Ollama : la passerelle peut router vers autre chose —
   * un serveur distant, un fournisseur tiers. Seule sa propre liste dit ce
   * qu'on peut réellement demander.
   */
  const [gatewayModels, setGatewayModels] = React.useState<GatewayModel[] | null>(
    null,
  )
  /** Pourquoi la passerelle n'a rien rendu, quand c'est le cas. */
  const [gatewayError, setGatewayError] = React.useState<string | null>(null)

  React.useEffect(() => {
    const openai = config.kind === 'openai'
    const baseUrl = openai ? config.openaiBaseUrl : config.baseUrl
    setGatewayModels(null)
    setGatewayError(null)
    if ((!openai && !usesGateway(config.kind)) || !baseUrl) {
      return
    }
    let cancelled = false
    void (openai ? window.engine.listOpenAIModels(baseUrl, config.openaiApiKey ?? '') : window.engine.listGatewayModels(baseUrl, config.token ?? ''))
      .then(result => {
        if (cancelled) return
        setGatewayModels(result.ok ? result.models : null)
        setGatewayError(result.ok ? null : result.reason)
      })
    return () => {
      cancelled = true
    }
  }, [config.kind, config.baseUrl, config.token, config.openaiBaseUrl, config.openaiApiKey])

  /**
   * Modèles GGUF présents sur ce poste.
   *
   * Ils servent au fournisseur `llamacpp`, où le modèle n'est pas un nom
   * distant mais un fichier local. Relus à chaque fin de téléchargement :
   * installer un modèle doit le faire apparaître dans le sélecteur sans qu'on
   * rouvre l'application.
   */
  const [localModels, setLocalModels] = React.useState<InstalledModel[]>([])

  React.useEffect(() => {
    const refresh = () => void window.engine.installedModels().then(setLocalModels)
    refresh()
    return window.engine.onModelProgress(update => {
      if (update.done && !update.failed) refresh()
    })
  }, [])

  const apply = React.useCallback<(next: ProviderConfig) => void | Promise<void>>(next => {
    const current = ++revision.current
    const authChanged = next.token !== config.token || next.baseUrl !== config.baseUrl
    if (!authChanged) setConfig(next)
    setStorageError(null)
    const save = window.engine.setProvider(next)
    void save.then(() => {
      if (!authChanged) return
      if (current === revision.current) setConfig(next)
      window.dispatchEvent(new Event('provider-changed'))
    }).catch(error => {
      if (current === revision.current) setStorageError(String(error))
    })
    return save
  }, [config.token, config.baseUrl])

  /**
   * Interroge Ollama.
   *
   * À la demande et non en continu : le serveur peut être arrêté, et une
   * tentative périodique produirait des erreurs de fond que personne n'a
   * demandées.
   */
  const probeOllama = React.useCallback(async (host: string) => {
    setProbing(true)
    setOllamaError(null)
    const result = await window.engine.listOllamaModels(host)
    setProbing(false)
    if (result.ok) {
      setModels(result.models)
    } else {
      setModels(null)
      setOllamaError(result.reason)
    }
  }, [])

  // Référence stable : l'effet ci-dessus ne doit pas se relancer à chaque
  // rendu du fait de l'identité de la fonction.
  probeOllamaRef.current = probeOllama

  return {
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
  }
}
