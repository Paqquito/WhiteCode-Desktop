/**
 * Contrat des connecteurs de plugin.
 *
 * Un plugin décrit son connecteur dans `connector.json` : où le joindre,
 * quels secrets il demande, quels outils écrivent (et doivent être
 * confirmés), comment vérifier le compte. Le desktop en tire le formulaire
 * de compte, le stockage chiffré des secrets, les confirmations et les
 * appels du panneau : aucun code propre au service n'y reste.
 *
 * Le manifeste est une donnée venue d'un dépôt : tout est validé strictement,
 * et rien ne s'exécute. Les adresses sont en HTTPS et partagent une même
 * origine ; un secret ne part que dans l'en-tête déclaré, vers cette origine.
 */

import { isDataPath } from '../../shared/dataPath.js'
export { pick, place } from '../../shared/dataPath.js'

export type ConnectorSecret = {
  /** Identifiant du secret dans le connecteur (`apiKey`). */
  name: string
  /** Libellé du champ (« Clé API »). */
  label: string
  /** En-tête HTTP qui le porte. */
  header: string
  /** Format attendu, vérifié avant tout enregistrement. */
  pattern: string
  help?: string
  /** Sans lui, le connecteur n'est pas proposé au modèle. */
  required?: boolean
}

export type ConnectorManifest = {
  id: string
  /** Nom court (« Tickets »), pour les messages. */
  name: string
  label: string
  url: string
  auth: { secrets?: ConnectorSecret[] }
  /** Outils qui écrivent : toujours confirmés, quel que soit le mode de permission. */
  writeTools?: string[]
  /** Appels directs des panneaux, hors protocole MCP. */
  tools?: { endpoint: string; names: string[] }
  /** Outil de préparation appelé avant une écriture, et ce qu'on en reprend. */
  prepare?: Record<string, { tool: string; merge?: Record<string, string>; warnings?: string }>
  /** Vérification du compte : chemins (pointés) des champs de la réponse. */
  account?: { endpoint: string; name?: string; login?: string; site?: string }
  /** Liens externes, sur le seul site annoncé par la vérification du compte. */
  links?: Record<string, string>
}

const NAME = /^[a-z][a-z0-9_-]{0,39}$/
const TOOL = /^[a-z_][a-z0-9_]{0,63}$/
const HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const reserved = (name: string) => ['__proto__', 'constructor', 'prototype'].includes(name)
function object(value: unknown, keys: string[], what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Manifeste de connecteur : ${what} invalide.`)
  return value as Record<string, unknown>
}

function text(value: unknown, max: number, what: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\0\r]/.test(value)) throw new Error(`Manifeste de connecteur : ${what} invalide.`)
  return value
}

function template(value: unknown, what: string): string {
  const raw = text(value, 300, what)
  if (!raw.startsWith('https://')) throw new Error(`Manifeste de connecteur : ${what} doit être une adresse HTTPS.`)
  const probe = raw.replace('{tool}', 'tool')
  let url: URL
  try { url = new URL(probe) } catch { throw new Error(`Manifeste de connecteur : ${what} invalide.`) }
  const pathname = decodeURIComponent(probe.slice(probe.indexOf('/', 'https://'.length)))
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\s\\{}$]/.test(probe)
    || pathname.includes('//') || pathname.split('/').some(part => part === '.' || part === '..')) throw new Error(`Manifeste de connecteur : ${what} invalide.`)
  return raw
}

function tools(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || value.length > 64 || !value.every(name => typeof name === 'string' && TOOL.test(name) && !reserved(name))) throw new Error(`Manifeste de connecteur : ${what} invalide.`)
  return [...new Set(value as string[])]
}

/** Valide un `connector.json` ; toute clé inconnue est refusée. */
export function parseConnector(raw: unknown): ConnectorManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Manifeste de connecteur invalide.')
  const value = raw as Record<string, unknown>
  const known = ['id', 'name', 'label', 'url', 'auth', 'writeTools', 'tools', 'prepare', 'account', 'links']
  const unknown = Object.keys(value).find(key => !known.includes(key))
  if (unknown) throw new Error(`Manifeste de connecteur : champ « ${unknown} » non pris en charge.`)
  if (typeof value.id !== 'string' || !NAME.test(value.id) || reserved(value.id) || value.id.startsWith('rag_')) throw new Error('Manifeste de connecteur : identifiant invalide.')
  const manifest: ConnectorManifest = {
    id: value.id, name: text(value.name, 40, 'nom'), label: text(value.label, 100, 'libellé'), url: template(value.url, 'l’adresse'),
    auth: { secrets: [] },
  }
  const auth = object(value.auth === undefined ? {} : value.auth, ['secrets'], 'authentification')
  const secrets = auth.secrets ?? []
  if (!Array.isArray(secrets) || secrets.length > 8) throw new Error('Manifeste de connecteur : secrets invalides.')
  const names = new Set<string>(), headers = new Set<string>()
  for (const item of secrets as Array<Record<string, unknown>>) {
    object(item, ['name', 'label', 'header', 'pattern', 'help', 'required'], 'secret')
    if (item.required !== undefined && typeof item.required !== 'boolean') throw new Error('Manifeste de connecteur : secret obligatoire invalide.')
    if (typeof item?.name !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(item.name) || reserved(item.name) || names.has(item.name)) throw new Error('Manifeste de connecteur : nom de secret invalide.')
    if (typeof item.header !== 'string' || !HEADER.test(item.header) || /^(host|content-length|connection|authorization)$/i.test(item.header)) throw new Error('Manifeste de connecteur : en-tête de secret invalide.')
    if (headers.has(item.header.toLowerCase())) throw new Error('Manifeste de connecteur : en-tête de secret dupliqué.')
    names.add(item.name); headers.add(item.header.toLowerCase())
    const pattern = text(item.pattern, 200, 'format de secret')
    try { new RegExp(pattern) } catch { throw new Error('Manifeste de connecteur : format de secret invalide.') }
    if (!pattern.startsWith('^') || !pattern.endsWith('$')) throw new Error('Manifeste de connecteur : le format d’un secret doit être ancré (^…$).')
    manifest.auth.secrets!.push({ name: item.name, label: text(item.label, 80, 'libellé de secret'), header: item.header, pattern,
      ...(item.help !== undefined ? { help: text(item.help, 600, 'aide de secret') } : {}), required: item.required === true })
  }
  if (value.writeTools !== undefined) manifest.writeTools = tools(value.writeTools, 'outils d’écriture')
  if (value.tools !== undefined) {
    const item = object(value.tools, ['endpoint', 'names'], 'appels directs')
    const endpoint = template(item.endpoint, 'l’adresse des appels directs')
    if (!endpoint.includes('{tool}')) throw new Error('Manifeste de connecteur : l’adresse des appels directs doit contenir {tool}.')
    manifest.tools = { endpoint, names: tools(item.names, 'outils des appels directs') }
  }
  if (value.prepare !== undefined) {
    const prepare = value.prepare as Record<string, Record<string, unknown>>
    if (!prepare || typeof prepare !== 'object' || Array.isArray(prepare)) throw new Error('Manifeste de connecteur : préparation invalide.')
    manifest.prepare = {}
    for (const [tool, step] of Object.entries(prepare)) {
      object(step, ['tool', 'merge', 'warnings'], 'préparation')
      if (!TOOL.test(tool) || reserved(tool) || typeof step?.tool !== 'string' || !TOOL.test(step.tool) || reserved(step.tool)) throw new Error('Manifeste de connecteur : préparation invalide.')
      if (!manifest.writeTools?.includes(tool) || manifest.writeTools.includes(step.tool) || !manifest.tools?.names.includes(step.tool)) throw new Error('Manifeste de connecteur : une préparation doit être un outil de lecture déclaré, avant une écriture déclarée.')
      const merge = (step.merge ?? {}) as Record<string, unknown>
      if (!merge || typeof merge !== 'object' || Array.isArray(merge) || Object.entries(merge).some(([from, to]) => !isDataPath(from) || !isDataPath(to))) throw new Error('Manifeste de connecteur : fusion de préparation invalide.')
      if (step.warnings !== undefined && !isDataPath(step.warnings)) throw new Error('Manifeste de connecteur : avertissements de préparation invalides.')
      manifest.prepare[tool] = { tool: step.tool, merge: merge as Record<string, string>, ...(step.warnings ? { warnings: step.warnings as string } : {}) }
    }
  }
  if (value.account !== undefined) {
    const account = object(value.account, ['endpoint', 'name', 'login', 'site'], 'vérification du compte')
    for (const key of ['name', 'login', 'site']) if (account[key] !== undefined && !isDataPath(account[key])) throw new Error('Manifeste de connecteur : champ de compte invalide.')
    manifest.account = { endpoint: template(account.endpoint, 'l’adresse du compte'), ...(account.name ? { name: account.name as string } : {}), ...(account.login ? { login: account.login as string } : {}), ...(account.site ? { site: account.site as string } : {}) }
  }
  if (value.links !== undefined) {
    const links = value.links as Record<string, unknown>
    if (!links || typeof links !== 'object' || Array.isArray(links)) throw new Error('Manifeste de connecteur : liens invalides.')
    manifest.links = {}
    for (const [name, pattern] of Object.entries(links)) {
      if (!/^[a-z][a-zA-Z0-9]{0,31}$/.test(name) || reserved(name) || typeof pattern !== 'string' || !pattern.startsWith('{site}/') || pattern.length > 200) throw new Error('Manifeste de connecteur : un lien doit partir de {site}/.')
      manifest.links[name] = pattern
    }
  }
  const endpoints = [manifest.url, manifest.tools?.endpoint, manifest.account?.endpoint].filter((url): url is string => Boolean(url))
  const origin = new URL(manifest.url.replace('{tool}', 'tool')).origin
  if (endpoints.some(url => new URL(url.replace('{tool}', 'tool')).origin !== origin)) {
    throw new Error('Manifeste de connecteur : les identifiants ne peuvent pas changer d’origine.')
  }
  return manifest
}
