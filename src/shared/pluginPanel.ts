import { pick } from './dataPath.js'

export type PanelValue = string | number | boolean | null | PanelValue[] | { [key: string]: PanelValue }
export type PanelContext = { selection?: string | number; record?: unknown; item?: unknown; form?: Record<string, unknown> }
export type PanelRequest = { tool: string; args: Record<string, PanelValue> }
export type PanelAction = { kind: 'prompt'; label: string; prompt: string }
  | { kind: 'select'; label: string; value: PanelValue }
  | { kind: 'link'; label: string; link: string; params: Record<string, PanelValue> }
  | { kind: 'external'; label: string; url: string }
export type PanelBlock = { kind: 'text'; label?: string; value: string; when?: string }
  | { kind: 'fields'; fields: Array<{ label: string; value: string }> }
  | { kind: 'list'; label?: string; items: string; reverse?: boolean; blocks: PanelBlock[] }
  | { kind: 'group'; label?: string; when?: string; blocks: PanelBlock[] }
  | { kind: 'action'; action: PanelAction }
export type PanelRows = { items: string; id: string; title: string; subtitle?: string; excerpt?: string; badges?: string[]; empty: string; total?: string }
export type PanelField = { id: string; label: string; type: 'text' | 'textarea' | 'checkbox' | 'select'; required?: boolean; options?: string; exclude?: string }
export type PanelForm = { id: string; label: string; submit: string; request: PanelRequest; fields: PanelField[]; unavailable?: string }
export type PluginPanelManifest = {
  version: 1; id: string; connector: string; title: string
  views: Array<{ id: string; label: string; request: PanelRequest; rows: PanelRows }>
  search?: { label: string; placeholder: string; request: PanelRequest; rows: PanelRows; numericId?: boolean }
  detail: { request: PanelRequest; title: string; subtitle?: string; actions?: PanelAction[]; fields?: Array<{ label: string; value: string }>; blocks: PanelBlock[]; forms?: PanelForm[] }
}

/** Templates only read data; the React renderer escapes the resulting text. */
export function panelText(template: string, context: PanelContext): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_.]*)\}/g, (_match, path: string) => {
    const value = pick(context, path)
    if (value === null || value === undefined || typeof value === 'object') return ''
    return typeof value === 'boolean' ? value ? 'oui' : 'non' : String(value)
  })
}

export function bindPanelArgs(args: Record<string, PanelValue>, context: PanelContext): Record<string, unknown> {
  const bind = (value: PanelValue): unknown => {
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(bind)
    if (Object.hasOwn(value, '$path')) {
      const result = pick(context, String(value.$path))
      if (result === undefined) throw new Error(`Donnée manquante : ${String(value.$path)}.`)
      return result
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bind(item)]))
  }
  return bind(args) as Record<string, unknown>
}
