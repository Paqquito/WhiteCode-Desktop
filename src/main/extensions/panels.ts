import { z } from 'zod'
import { isDataPath } from '../../shared/dataPath.js'
import type { PanelAction, PanelBlock, PanelValue, PluginPanelManifest } from '../../shared/pluginPanel.js'

const text = z.string().min(1).max(4000)
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).refine(value => !['constructor', 'prototype'].includes(value))
const path = text.refine(isDataPath, 'Chemin de données invalide.')
const template = text.refine(value => [...value.matchAll(/\{([^{}]+)\}/g)].every(match => isDataPath(match[1])), 'Gabarit de texte invalide.')

function validValue(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'string') return value.length <= 20000
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.length <= 100 && value.every(item => validValue(item, depth + 1))
  const entries = Object.entries(value)
  if (Object.hasOwn(value, '$path')) return entries.length === 1 && isDataPath((value as Record<string, unknown>).$path)
  return entries.length <= 64 && entries.every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && validValue(item, depth + 1))
}
const value = z.custom<PanelValue>(validValue, 'Arguments de panneau invalides.')
const args = z.record(z.string().refine(key => !['__proto__', 'constructor', 'prototype'].includes(key)), value)
const request = z.strictObject({ tool: id, args: args.default({}) })
const action: z.ZodType<PanelAction> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('prompt'), label: text, prompt: template }),
  z.strictObject({ kind: z.literal('select'), label: template, value }),
  z.strictObject({ kind: z.literal('link'), label: text, link: id, params: args.default({}) }),
  z.strictObject({ kind: z.literal('external'), label: template, url: template }),
])
const fields = z.array(z.strictObject({ label: template, value: template })).max(40)
const block: z.ZodType<PanelBlock> = z.lazy(() => z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('text'), label: template.optional(), value: template, when: path.optional() }),
  z.strictObject({ kind: z.literal('fields'), fields }),
  z.strictObject({ kind: z.literal('list'), label: template.optional(), items: path, reverse: z.boolean().optional(), blocks: z.array(block).max(40) }),
  z.strictObject({ kind: z.literal('group'), label: template.optional(), when: path.optional(), blocks: z.array(block).max(40) }),
  z.strictObject({ kind: z.literal('action'), action }),
]))
const rows = z.strictObject({ items: path, id: path, title: template, subtitle: template.optional(), excerpt: template.optional(), badges: z.array(template).max(4).optional(), empty: text, total: path.optional() })
const field = z.strictObject({ id, label: text, type: z.enum(['text', 'textarea', 'checkbox', 'select']), required: z.boolean().optional(), options: path.optional(), exclude: path.optional() })
const schema = z.strictObject({
  version: z.literal(1), id, connector: id, title: z.string().min(1).max(80),
  views: z.array(z.strictObject({ id, label: text, request, rows })).min(1).max(8),
  search: z.strictObject({ label: text, placeholder: text, request, rows, numericId: z.boolean().optional() }).optional(),
  detail: z.strictObject({ request, title: template, subtitle: template.optional(), actions: z.array(action).max(8).optional(), fields: fields.optional(), blocks: z.array(block).max(40),
    forms: z.array(z.strictObject({ id, label: text, submit: text, request, fields: z.array(field).min(1).max(12), unavailable: text.optional() })).max(8).optional(),
  }),
})

export function parsePanel(raw: unknown, connector?: { id: string; tools?: { names: string[] } }): PluginPanelManifest {
  // Bound depth before the recursive schema visits untrusted plugin data.
  const bounded = (node: unknown, depth: number): boolean => depth <= 16 && (!node || typeof node !== 'object' || Object.values(node).every(value => bounded(value, depth + 1)))
  if (!bounded(raw, 0)) throw new Error('Panneau de plugin trop imbriqué.')
  const panel = schema.parse(raw)
  const unique = (values: string[]) => values.length === new Set(values).size
  if (!unique(panel.views.map(view => view.id)) || !unique((panel.detail.forms ?? []).map(form => form.id))
    || panel.detail.forms?.some(form => !unique(form.fields.map(field => field.id)) || form.fields.some(field => field.type === 'select' && !field.options))) throw new Error('Identifiants ou champs de panneau invalides.')
  const requests = [...panel.views.map(view => view.request), panel.detail.request, ...(panel.search ? [panel.search.request] : []), ...(panel.detail.forms ?? []).map(form => form.request)]
  if (connector && (panel.connector !== connector.id || requests.some(request => !connector.tools?.names.includes(request.tool)))) throw new Error('Le panneau appelle un connecteur ou un outil non déclaré.')
  return panel
}
