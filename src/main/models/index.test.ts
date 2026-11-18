/**
 * L'inventaire lit le dossier ; le registre ne fait que le nommer.
 *
 * C'est l'endroit où une erreur passerait inaperçue : un modèle découpé
 * apparaîtrait en quatre exemplaires, ou un projecteur visuel figurerait comme
 * modèle à part entière — et « Mettre en service » sur l'un des deux échouerait
 * sans qu'on comprenne pourquoi.
 */

import { expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalModels, serverArgs } from './index.js'
import { parseRepoId } from './huggingface.js'

test('un modèle découpé compte pour un ; le projecteur, pour aucun', async () => {
  const state = await mkdtemp(join(tmpdir(), 'sample-state-'))
  const root = await mkdtemp(join(tmpdir(), 'sample-models-'))

  const models = new LocalModels(state)
  await models.set({
    root,
    custom: [
      {
        id: 'gros',
        label: 'Gros modèle',
        repo: 'acme/Gros-GGUF',
        file: 'Gros-Q4_K_M-00001-of-00003.gguf',
        shards: [
          'Gros-Q4_K_M-00002-of-00003.gguf',
          'Gros-Q4_K_M-00003-of-00003.gguf',
        ],
        mmproj: 'mmproj-gros.gguf',
        bytes: 42e9,
      },
    ],
  })

  for (const name of [
    'Gros-Q4_K_M-00001-of-00003.gguf',
    'Gros-Q4_K_M-00002-of-00003.gguf',
    'Gros-Q4_K_M-00003-of-00003.gguf',
    'mmproj-gros.gguf',
    'Autre.gguf',
    'notes.txt',
  ]) {
    await writeFile(join(root, name), '')
  }

  const installed = await models.installed()

  // Le fichier déposé à la main reste visible : le registre nomme, il ne filtre
  // pas.
  expect(installed.map(model => model.id)).toEqual(['Autre', 'gros'])
  // La taille annoncée est celle de l'ensemble, pas celle de la première
  // tranche — qui pèse ici zéro octet.
  expect(installed.find(model => model.id === 'gros')?.bytes).toBe(42e9)
})

/**
 * Le contexte se joue à la ligne de commande, et une erreur ne se voit qu'au
 * premier tour refusé — après plusieurs minutes de chargement. D'où ce test.
 */
test('le contexte passe par `--fit-ctx`, jamais par `-c` ni `-ngl`', () => {
  const base = {
    root: '/modeles',
    backend: 'vulkan' as const,
    port: 8080,
    custom: [],
  }

  const args = serverArgs({
    config: { ...base, context: 262144 },
    model: { file: 'gros.gguf', context: 262144 },
    mmproj: 'mmproj-gros.gguf',
    reasoning: 'auto',
  })
  expect(args[args.indexOf('--fit-ctx') + 1]).toBe('262144')
  // Les deux options doivent rester absentes : `--fit` ne calcule que ce qu'on
  // ne lui impose pas, et `-ngl` posé lui fait abandonner tout le calcul —
  // le contexte retombe alors au défaut, sans que rien ne le dise.
  expect(args).not.toContain('--ctx-size')
  expect(args).not.toContain('--n-gpu-layers')
  // Le cache q8_0 est ce qui rend ces contextes atteignables : moitié moins
  // lourd que le f16 par défaut.
  expect(args[args.indexOf('--cache-type-k') + 1]).toBe('q8_0')
  expect(args[args.indexOf('--cache-type-v') + 1]).toBe('q8_0')

  // Au delà de son entraînement, le modèle étire les positions et se dégrade
  // en silence : on borne.
  const borne = serverArgs({
    config: { ...base, context: 262144 },
    model: { file: 'petit.gguf', context: 65536 },
    mmproj: null,
    reasoning: 'off',
  })
  expect(borne[borne.indexOf('--fit-ctx') + 1]).toBe('65536')

  // Sous le plancher, l'invite du moteur ne tient pas : c'est le plancher qui
  // gagne, y compris contre un modèle annoncé plus court.
  const plancher = serverArgs({
    config: { ...base, context: 8192 },
    model: { file: 'court.gguf', context: 8192 },
    mmproj: null,
    reasoning: 'auto',
  })
  expect(plancher[plancher.indexOf('--fit-ctx') + 1]).toBe('32768')
})

test('une adresse Hugging Face est reconnue sous toutes ses formes de circulation', () => {
  // Ces formes circulent réellement : la page, un lien vers un fichier, un
  // sous-dossier, ou le `propriétaire/nom` des README. En refuser une
  // obligerait à expliquer laquelle coller.
  for (const forme of [
    'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF',
    'huggingface.co/unsloth/Qwen3-0.6B-GGUF',
    'unsloth/Qwen3-0.6B-GGUF',
    '  unsloth/Qwen3-0.6B-GGUF  ',
    'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/tree/main',
    'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/blob/main/Qwen3-0.6B-Q4_K_M.gguf',
    'https://huggingface.co/unsloth/Qwen3-0.6B-GGUF/resolve/main/deux/niveaux.gguf',
  ]) {
    expect(parseRepoId(forme)).toBe('unsloth/Qwen3-0.6B-GGUF')
  }

  // Un autre hôte enverrait télécharger ailleurs que sur Hugging Face ; le
  // reste ne désigne aucun dépôt.
  for (const refus of [
    'https://example.com/unsloth/Qwen3-0.6B-GGUF',
    'https://huggingface.co/unsloth',
    'pas une adresse',
    '',
    '   ',
  ]) {
    expect(parseRepoId(refus)).toBeNull()
  }
})
