/**
 * Les quatre catalogues de `useModelChoice`.
 *
 * Extraits de `SessionCell` par R06, ils n'avaient jamais été éprouvés. Ce sont
 * branches qui ne se ressemblent pas — les deux passerelles, `llama.cpp`,
 * Ollama — et dont les états vides comptent autant que les états pleins : c'est
 * là que l'utilisateur va chercher « + Ajouter un modèle ».
 *
 * Éprouvé par un composant sonde plutôt qu'en appelant le crochet à nu : React
 * refuse un crochet hors rendu. `renderToStaticMarkup` n'exécute pas les
 * effets, donc l'alignement de la session sur le modèle imposé n'est pas
 * couvert ici — seulement ce que le crochet **calcule**.
 */

import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ADD_MODEL, useModelChoice } from './useModelChoice.js'
import type { useProvider } from './useProvider.js'

type Provider = ReturnType<typeof useProvider>

function provider(over: Partial<Provider> & { config: Provider['config'] }): Provider {
  return {
    models: null, localModels: [], gatewayModels: null, gatewayError: null,
    storageError: null, ollamaError: null, probing: false,
    apply: async () => {}, probeOllama: async () => {},
    ...over,
  } as Provider
}

/** Rend le résultat du crochet sous une forme lisible dans le balisage. */
function inspect(p: Provider, model: string | null = null) {
  let vu: ReturnType<typeof useModelChoice> | null = null
  function Sonde(): React.ReactNode {
    vu = useModelChoice({ provider: p, model, setModel: () => {}, onAddModel: () => {} })
    return null
  }
  renderToStaticMarkup(<Sonde />)
  return vu!
}

test('la passerelle ne propose que ce qu’elle sait router', () => {
  const r = inspect(provider({
    config: { kind: 'compatible', baseUrl: 'https://x', token: 't' } as Provider['config'],
    gatewayModels: [{ id: 'gpu-1', label: 'GPU 1', hint: '32k', isDefault: true, contextLength: 32768, supportsEffort: true }] as Provider['gatewayModels'],
  }))
  expect(r.options.map(o => o.id)).toEqual(['gpu-1'])
  // Pas d'« + Ajouter » ici : rien ne s'installe sur une passerelle.
  expect(r.options.some(o => o.id === ADD_MODEL)).toBe(false)
})

test('une passerelle muette le dit, et n’invente pas de modèle', () => {
  const r = inspect(provider({
    config: { kind: 'compatible', baseUrl: 'https://x', token: 't' } as Provider['config'],
    gatewayModels: [],
  }))
  expect(r.options[0]?.id).toBe(null)
  expect(r.options[0]?.label).toContain('Aucun modèle')
  expect(r.options.at(-1)?.id).toBe(ADD_MODEL)
})

test('llama.cpp liste les fichiers du poste, avec leur taille', () => {
  const r = inspect(provider({
    config: { kind: 'llamacpp' } as Provider['config'],
    localModels: [{ id: 'q4', label: 'Qwen Q4', bytes: 17_000_000_000 }] as Provider['localModels'],
  }))
  expect(r.options[0]?.id).toBe('q4')
  expect(r.options[0]?.hint).toBe('17.0 Go')
  expect(r.options.at(-1)?.id).toBe(ADD_MODEL)
  // C'est le seul cas où l'effort bascule la réflexion au lancement du serveur.
  expect(r.reasoningToggle).toBe(true)
  expect(r.showEffort).toBe(true)
})

test('Ollama écarte les modèles sans outils', () => {
  const r = inspect(provider({
    config: { kind: 'ollama', ollamaHost: 'http://x' } as Provider['config'],
    models: [
      { name: 'avec', tools: true, bytes: 4e9, vision: false, contextLength: 32768 },
      { name: 'sans', tools: false, bytes: 4e9, vision: false, contextLength: 32768 },
    ] as Provider['models'],
  }))
  // Un modèle sans outils ne peut rien faire ici : le proposer serait une
  // promesse que le premier tour démentirait.
  expect(r.options.map(o => o.id)).toEqual(['avec', ADD_MODEL])
  expect(r.reasoningToggle).toBe(false)
})

test('la fenêtre de contexte vient du modèle, pas du moteur', () => {
  const r = inspect(provider({
    config: { kind: 'compatible', baseUrl: 'https://x', token: 't' } as Provider['config'],
    gatewayModels: [{ id: 'gpu-1', label: 'GPU 1', hint: '', isDefault: true, contextLength: 32768, supportsEffort: false }] as Provider['gatewayModels'],
  }), 'gpu-1')
  // Le moteur annoncerait 200 000 : la jauge resterait au vert jusqu'à la rupture.
  expect(r.contextLimit).toBe(32768)
  expect(r.showEffort).toBe(false)
})
