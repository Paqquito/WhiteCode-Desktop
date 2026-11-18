/**
 * Paramètres sur le `<dialog>` natif — seconde moitié de D08.
 *
 * Ce qui est éprouvé ici, c'est la **structure** : l'élément natif, et non un
 * `div` avec `role="dialog"`. Le piège de focus, `Esc` et l'inertie de
 * l'arrière-plan en découlent — ils appartiennent au navigateur, il n'y a rien
 * de nôtre à tester dedans. Ce qu'il faut vérifier, c'est qu'on les a bien
 * demandés.
 *
 * `showModal()` n'est pas appelé en rendu statique : les effets n'y tournent
 * pas. L'attribut `open` est donc absent du balisage, ce qui est correct.
 */

import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsDialog } from './SettingsDialog.js'
import { RoutinesDialog } from '../dialogs/RoutinesDialog.js'

const provider = {
  config: { kind: 'compatible' }, models: null, localModels: [], gatewayModels: null,
  gatewayError: null, storageError: null, ollamaError: null, probing: false,
  apply: async () => {}, probeOllama: async () => {},
} as unknown as Parameters<typeof SettingsDialog>[0]['provider']

const corpora = { corpora: [], ready: true, refresh: () => {} } as unknown as Parameters<typeof SettingsDialog>[0]['corpora']
const extensions = { extensions: [], refresh: () => {} } as unknown as Parameters<typeof SettingsDialog>[0]['extensions']

const settings = () =>
  renderToStaticMarkup(
    <SettingsDialog
      provider={provider} corpora={corpora} extensions={extensions}
      reducedTools={false} onReducedTools={() => {}}
      mcpServers={null} onMcpServers={() => {}} onClose={() => {}}
      projects={[]} onUnarchive={() => {}} onOpenSession={() => {}}
    />,
  )

test('Paramètres est un dialogue natif, plus un calque imité', () => {
  const html = settings()
  expect(html).toStartWith('<dialog')
  expect(html).toContain('class="settings"')
  // Le calque et son `role="dialog"` posé à la main ont disparu : c'est
  // précisément ce qui privait l'écran de piège de focus.
  expect(html).not.toContain('class="overlay"')
  expect(html).not.toContain('role="dialog"')
  expect(html).not.toContain('aria-modal')
})

test('l’écran reste nommé pour un lecteur d’écran', () => {
  // `aria-modal` devient inutile — l'élément natif porte la modalité — mais le
  // nom, lui, reste nécessaire : rien d'autre ne dit de quel dialogue il s'agit.
  expect(settings()).toContain('aria-label="Paramètres"')
})

test('Paramètres et Routines reposent désormais sur le même élément', () => {
  // C'est l'objet de D08. Le sens comptait : c'est Routines qui était déjà
  // natif, donc Paramètres qui vient à lui — l'inverse aurait supprimé un
  // comportement accessible au nom de l'uniformité.
  const routines = renderToStaticMarkup(<RoutinesDialog cwd="/p" onClose={() => {}} />)
  expect(routines).toStartWith('<dialog')
  expect(settings()).toStartWith('<dialog')
})
