import * as React from 'react'
import { pick } from '../../shared/dataPath.js'
import { panelText, type PanelAction, type PanelBlock, type PanelContext } from '../../shared/pluginPanel.js'

export function hasPanelData(template: string, context: PanelContext): boolean {
  const paths = [...template.matchAll(/\{([A-Za-z_][A-Za-z0-9_.]*)\}/g)]
  return !paths.length || paths.some(match => {
    const value = pick(context, match[1])
    return value !== null && value !== undefined && value !== '' && (!Array.isArray(value) || value.length > 0)
  })
}

export function PanelFields({ fields, context }: { fields: Array<{ label: string; value: string }>; context: PanelContext }) {
  return <dl className="plugin-records-fields">{fields.filter(field => hasPanelData(field.value, context)).map((field, index) =>
    <React.Fragment key={index}><dt>{panelText(field.label, context)}</dt><dd>{panelText(field.value, context)}</dd></React.Fragment>)}</dl>
}

export function PluginPanelBlocks({ blocks, context, onAction, busy }: {
  blocks: PanelBlock[]; context: PanelContext; onAction: (action: PanelAction, context: PanelContext) => void; busy: boolean
}) {
  let remaining = 1000, limited = false
  const render = (blocks: PanelBlock[], context: PanelContext): React.ReactNode => blocks.map((block, index) => {
    if (remaining-- <= 0) { limited = true; return null }
    if ('when' in block && block.when) {
      const value = pick(context, block.when)
      if (!value || (Array.isArray(value) && !value.length)) return null
    }
    if (block.kind === 'action') return <button key={index} type="button" className="link" disabled={busy} onClick={() => onAction(block.action, context)}>{panelText(block.action.label, context)}</button>
    if (block.kind === 'fields') return <PanelFields key={index} fields={block.fields} context={context} />
    const label = block.label && panelText(block.label, context)
    if (block.kind === 'text') {
      const value = panelText(block.value, context)
      return value ? <div key={index}>{label && <h4>{label}</h4>}<p className="plugin-records-text">{value}</p></div> : null
    }
    if (block.kind === 'list') {
      const data = pick(context, block.items)
      if (!Array.isArray(data) || !data.length) return null
      const items = block.reverse ? data.slice(-500).reverse() : data.slice(0, 500)
      const rows: React.ReactNode[] = []
      for (const [row, item] of items.entries()) {
        if (remaining-- <= 0) { limited = true; break }
        rows.push(<li key={row}>{render(block.blocks, { ...context, item })}</li>)
      }
      return <section key={index}>{label && <h4>{label}</h4>}<ul className="plugin-records-items">{rows}</ul>
        {data.length > rows.length && <p role="status">{rows.length} éléments affichés sur {data.length}.</p>}</section>
    }
    return <section key={index}>{label && <h4>{label}</h4>}{render(block.blocks, context)}</section>
  })
  const content = render(blocks, context)
  return <>{content}{limited && <p role="status">Affichage limité. Ouvrez le service pour consulter tous les éléments.</p>}</>
}
