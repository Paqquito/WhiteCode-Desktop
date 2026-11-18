import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { IconButton } from './IconButton.js'
import { TopBar } from '../layout/TopBar.js'

test('un bouton-icône n’est jamais muet pour un lecteur d’écran', () => {
  // `label` est facultatif, `aria-label` ne l'est pas : c'est tout l'intérêt
  // de l'avoir extrait. Écrit à la main, il tenait par la discipline.
  const html = renderToStaticMarkup(
    <IconButton icon="close" title="Fermer" onClick={() => {}} />,
  )
  expect(html).toContain('aria-label="Fermer"')
  expect(html).toContain('type="button"')
})

test('l’annonce peut différer de l’infobulle', () => {
  const html = renderToStaticMarkup(
    <IconButton icon="close" title="Fermer" label="Fermer le panneau Terminal" />,
  )
  expect(html).toContain('title="Fermer"')
  expect(html).toContain('aria-label="Fermer le panneau Terminal"')
})

test('les variantes s’ajoutent à la classe de base, sans la remplacer', () => {
  const base = renderToStaticMarkup(<IconButton icon="save" title="x" />)
  const accent = renderToStaticMarkup(
    <IconButton icon="save" title="x" variant="accent" />,
  )
  expect(base).toContain('class="icon-button"')
  expect(accent).toContain('class="icon-button accent"')
})

test('un bouton à deux états annonce lequel est en cours', () => {
  const html = renderToStaticMarkup(
    <IconButton icon="save" title="x" variant="active" pressed />,
  )
  expect(html).toContain('aria-pressed="true"')
  // Sans l'état, l'attribut ne doit pas apparaître : un bouton qui ne bascule
  // rien et s'annonce « non enfoncé » se décrit mal.
  expect(renderToStaticMarkup(<IconButton icon="save" title="x" />)).not.toContain('aria-pressed')
})

test('les menus de panneaux nomment leur usage et annoncent les panneaux ouverts', () => {
  const html = renderToStaticMarkup(
    <TopBar title="T" project="p" sidebarHidden={false} onShowSidebar={() => {}}
      isPanelOpen={id => id === 'files'} onTogglePanel={() => {}} onOpenRestore={() => {}} onOpenConnections={() => {}} />,
  )
  expect(html).toContain('class="topbar-menu-trigger active"')
  expect(html).toContain('aria-label="Panneaux (1 ouvert)"')
  expect(html).toContain('Connecteurs')
  expect(html).not.toContain('Sources')
  expect(html).not.toContain('GitLab')
  expect(html.match(/aria-haspopup="menu"/g)?.length).toBe(1)
  expect(html.match(/aria-expanded="false"/g)?.length).toBe(1)
  expect(html.match(/aria-label=/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
})
