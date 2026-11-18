import * as React from 'react'
import { ExtensionSettings } from '../settings/ExtensionSettings.js'
import type { useExtensions } from '../state/useExtensions.js'
import { Icon } from '../ui/Icon.js'
import { BRAND } from '../brand.js'

export function PluginCatalog({ extensions, onClose }: { extensions: ReturnType<typeof useExtensions>; onClose: () => void }) {
  const heading = React.useRef<HTMLHeadingElement>(null)
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    heading.current?.focus()
    return () => previous?.focus()
  }, [])
  return <section className="plugin-catalog" aria-label="Plugins et skills">
    <header className="catalog-header">
      <div><h1 ref={heading} tabIndex={-1}>Plugins et skills</h1><p>Des compétences pour aller plus loin avec {BRAND.product}.</p></div>
      <button type="button" className="ghost" onClick={onClose}><Icon name="close" size={14} /> Retour à la conversation</button>
    </header>
    <ExtensionSettings extensions={extensions} />
  </section>
}
