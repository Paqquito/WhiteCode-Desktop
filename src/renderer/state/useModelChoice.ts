/**
 * Choix du modèle dans le composeur.
 *
 * Cent soixante-huit lignes qui vivaient au milieu de `SessionCell`, dont le
 * travail est de disposer une conversation à l'écran. Rien ne les y rattachait
 * : ce sont quatre catalogues distincts — passerelle, `llama.cpp`, Ollama, et
 * le cas où il n'y a rien à proposer — plus la règle qui aligne la session sur
 * ce que le fournisseur impose.
 *
 * Le modèle choisi appartient à la **session**. Le fournisseur, lui, construit
 * l'environnement d'exécution et, pour Ollama, un pont propre à chaque tour.
 *
 * `onAddModel` est le seul lien avec l'interface : « + Ajouter un modèle » est
 * une entrée de la liste qui n'est pas un modèle, elle ouvre l'écran
 * d'installation. La garder dans la liste plutôt qu'à côté est délibéré —
 * c'est là qu'on la cherche, au moment où l'on constate qu'il n'y a rien à
 * choisir.
 */

import * as React from 'react'
import { catalogModels, selectedGatewayModel } from '../../shared/modelSelection.js'
import type { MenuOption } from '../ui/Menu.js'
import { usesGateway, type useProvider } from './useProvider.js'

/** Entrée qui ouvre l'écran d'installation au lieu de choisir un modèle. */
export const ADD_MODEL = ' ajouter'

export function useModelChoice({
  provider,
  model,
  setModel,
  onAddModel,
}: {
  provider: ReturnType<typeof useProvider>
  /** Le modèle de la session. */
  model: string | null
  setModel: (model: string | null) => void
  /** Ouvre l'écran d'installation des modèles. */
  onAddModel: () => void
}): {
  options: Array<MenuOption<string | null>>
  /** Ce que le fournisseur impose, quand il impose quelque chose. */
  selected: string | null
  choose: (model: string | null) => void
  /** Le modèle de passerelle en service : il porte la vraie fenêtre de contexte. */
  gatewayModel: ReturnType<typeof selectedGatewayModel>
  /** Vrai là où le réglage d'effort agit réellement. */
  showEffort: boolean
  /**
   * Vrai quand le bouton d'effort bascule la réflexion au lancement du serveur
   * local, au lieu de choisir un degré.
   */
  reasoningToggle: boolean
  /**
   * La vraie fenêtre de contexte, ou `null` si le moteur a raison.
   *
   * Le moteur se croit chez Anthropic dès qu'une passerelle lui répond dans ce
   * protocole, et annonce deux cent mille jetons quand le serveur en sert
   * trente-deux mille : la jauge resterait au vert jusqu'à la rupture.
   */
  contextLimit: number | null
} {
  const openai = provider.config.kind === 'openai'
  const ollama = provider.config.kind === 'ollama'
  const llamacpp = provider.config.kind === 'llamacpp'
  const gateway = usesGateway(provider.config.kind)

  const options = React.useMemo(() => {
    const add = {
      id: ADD_MODEL,
      label: '+ Ajouter un modèle',
      hint: 'Installer un modèle local depuis le catalogue',
    }

    if (openai) {
      const entries = (provider.gatewayModels ?? []).map(m => ({ id: m.id, label: m.label }))
      if (provider.config.openaiModel && !entries.some(m => m.id === provider.config.openaiModel)) entries.unshift({ id: provider.config.openaiModel, label: provider.config.openaiModel })
      return entries.length ? entries : [{ id: null, label: 'Configurer le fournisseur OpenAI', hint: 'Renseignez un modèle dans les paramètres.' }]
    }
    if (gateway) {
      // La passerelle dit elle-même ce qu'elle sait router. Afficher les alias
      // Anthropic ici serait mensonger : ils ne correspondent à rien de ce qui
      // tourne derrière.
      // Les alias de routage sont écartés : la passerelle les publie au même
      // titre que ses modèles, mais « claude-sonnet-4-6 » n'est pas un modèle
      // installé — c'est un nom que le moteur emploie et que la passerelle
      // redirige. Les proposer redonnerait la liste Anthropic qu'on cherche
      // précisément à ne plus voir.
      // Le serveur publie tout ce qu'il sait router, hors alias Claude.
      const published = catalogModels(provider.gatewayModels ?? [])
      if (!published || published.length === 0) {
        return [
          {
            id: null,
            label: 'Aucun modèle disponible',
            hint: 'Liste indisponible — la passerelle répond-elle sur cette adresse ?',
          },
          add,
        ]
      }
      // Même le modèle par défaut conserve son identifiant explicite.
      return published.map(model => ({
        id: model.id,
        label: model.label,
        hint: model.hint,
      }))
    }

    // Sous llama.cpp, le modèle est un fichier de ce poste : le sélecteur
    // écrit dans la configuration du fournisseur, qui décide de ce que le
    // serveur charge. Les noms Anthropic n'y correspondent à rien.
    if (llamacpp) {
      if (provider.localModels.length === 0) {
        return [
          {
            id: null,
            label: 'Aucun modèle installé',
            hint: 'Installez-en un depuis le catalogue ou un dépôt Hugging Face.',
          },
          add,
        ]
      }
      return [
        ...provider.localModels.map(model => ({
          id: model.id,
          label: model.label,
          hint: `${(model.bytes / 1e9).toFixed(1)} Go`,
        })),
        add,
      ]
    }

    if (!ollama) return [add]

    const usable = (provider.models ?? []).filter(model => model.tools)
    if (usable.length === 0) {
      return [
        {
          id: null,
          label: 'Ollama indisponible',
          hint: 'Aucun modèle joignable. Vérifier le serveur dans les paramètres.',
        },
        add,
      ]
    }
    return [
      ...usable.map(model => ({
        id: model.name,
        label: model.name,
        hint:
          `${(model.bytes / 1e9).toFixed(1)} Go` +
          (model.vision ? ' · images' : '') +
          ` · contexte ${Math.round(model.contextLength / 1024)}k`,
      })),
      add,
    ]
  }, [
    openai,
    provider.config.openaiModel,
    gateway,
    ollama,
    llamacpp,
    provider.models,
    provider.localModels,
    provider.gatewayModels,
  ])

  const selected = openai ? (options.some(o => o.id === model) ? model : provider.config.openaiModel ?? options[0]?.id ?? null) : ollama
    ? (provider.models?.some(m => m.name === model) ? model : provider.config.ollamaModel ?? null)
    : llamacpp
      ? (provider.localModels.some(m => m.id === model) ? model : provider.config.llamacppModel ?? null)
      : gateway
        ? selectedGatewayModel(catalogModels(provider.gatewayModels ?? []), model)?.id ?? null
        : null

  // Le fournisseur peut imposer un modèle que la session ne connaît pas encore
  // — au premier tour, ou après un changement de fournisseur. On aligne la
  // session dessus plutôt que d'envoyer une requête sur un modèle absent.
  React.useEffect(() => {
    if (selected && model !== selected) setModel(selected)
  }, [selected, model, setModel])

  const choose = React.useCallback(
    (chosen: string | null) => {
      // « + Ajouter » n'est pas un modèle : il ouvre l'écran d'installation.
      if (chosen === ADD_MODEL) {
        onAddModel()
        return
      }
      setModel(chosen)
    },
    [onAddModel, setModel],
  )

  /**
   * L'état tel que l'interface doit le montrer.
   *
   * Deux corrections sur ce que rapporte le moteur, qui se croit chez
   * Anthropic dès qu'une passerelle lui répond dans ce protocole :
   *
   *  - la fenêtre de contexte, qu'il annonce à deux cent mille jetons alors
   *    que le serveur en sert trente-deux mille — la jauge resterait au vert
   *    jusqu'à la rupture ;
   *  - le coût en dollars, calculé sur les tarifs d'Anthropic. Sur un modèle
   *    qui tourne sur nos machines il ne correspond à aucune dépense, et
   *    l'afficher tromperait sur ce que coûte l'outil.
   */
  /**
   * Le modèle de la passerelle actuellement en service.
   *
   * Sert à deux choses que le moteur ne sait pas : la vraie fenêtre de
   * contexte, et l'existence d'un réglage d'effort.
   */
  const gatewayModel = React.useMemo(() => {
    if (!gateway) return null
    return selectedGatewayModel(
      catalogModels(provider.gatewayModels ?? []), model,
    )
  }, [gateway, provider.gatewayModels, model])

  /**
   * L'effort n'a de sens que là où il agit : sur un modèle que
   * la passerelle annonce capable de réflexion étendue, ou sur un modèle local
   * `llama-server` — où le bouton bascule la réflexion on/off au lancement du
   * serveur (le seul levier qui agit, voir `ReasoningMode`). Ollama passe par
   * le pont, qui n'en transmet aucun.
   */
  const showEffort = Boolean(gatewayModel?.supportsEffort) || llamacpp

  const contextLimit = openai ? provider.config.openaiContext ?? null :
    gatewayModel?.contextLength ?? (ollama ? provider.config.ollamaContext ?? null : null)

  return {
    options,
    selected,
    choose,
    gatewayModel,
    showEffort,
    reasoningToggle: llamacpp,
    contextLimit,
  }
}
