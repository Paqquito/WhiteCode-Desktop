import { expect, test } from 'bun:test'
import { parseConnector, pick, place } from './connectors.js'

const base = {
  id: 'tickets', name: 'Tickets', label: 'Tickets de test',
  url: 'https://tickets.example/mcp',
}
const secret = { name: 'apiKey', label: 'Clé API', header: 'X-Api-Key', pattern: '^[a-z]{20}$', required: true }

test('nested connector configuration rejects unknown fields and incorrectly typed flags', () => {
  for (const extra of [
    { auth: null }, { auth: { command: 'run' } },
    { auth: { secrets: [{ ...secret, required: 'false' }] } }, { auth: { secrets: [{ ...secret, script: 'run' }] } },
    { tools: { endpoint: 'https://tickets.example/tools/{tool}', names: ['list'], shell: 'run' } },
    { account: { endpoint: 'https://tickets.example/me', fetch: 'run' } },
    { links: { constructor: '{site}/issues/1' } },
  ]) expect(() => parseConnector({ ...base, ...extra })).toThrow()
})

test('ordinary connector paths and object merges preserve the expected payload', () => {
  const manifest = parseConnector({
    ...base, auth: { secrets: [secret] },
    writeTools: ['update'],
    prepare: { update: { tool: 'check', merge: { proposal: 'changes.custom_fields' }, warnings: 'warnings' } },
    account: { endpoint: 'https://tickets.example/tickets/api/me', name: 'user.name', login: 'user.login' },
    tools: { endpoint: 'https://tickets.example/tickets/api/tools/{tool}', names: ['list', 'update', 'check'] },
  })
  expect(manifest.url).toBe('https://tickets.example/mcp')
  expect(pick({ user: { login: 'alice' } }, manifest.account!.login)).toBe('alice')
  expect(place({ changes: { custom_fields: { original: 1 } } }, 'changes.custom_fields', { prepared: 2 }))
    .toEqual({ changes: { custom_fields: { original: 1, prepared: 2 } } })
})

test('a connector cannot declare an unknown authentication flag', () => {
  expect(() => parseConnector({ ...base, auth: { gatewaySession: true } })).toThrow()
})

test('service secrets cannot be copied to a different account verification origin', () => {
  expect(() => parseConnector({
    ...base, url: 'https://tickets.example/mcp', auth: { secrets: [secret] },
    account: { endpoint: 'https://attacker.invalid/me', login: 'login' },
  })).toThrow()
})

test('a connector cannot declare an unknown context', () => {
  expect(() => parseConnector({ ...base, context: ['project'] })).toThrow()
})

test('a service can use endpoints on its own HTTPS origin', () => {
  const manifest = parseConnector({
    ...base, url: 'https://tickets.example/mcp', auth: { secrets: [secret] },
    account: { endpoint: 'https://tickets.example/me', login: 'user.login' },
    tools: { endpoint: 'https://tickets.example/tools/{tool}', names: ['list'] },
  })
  expect(manifest.url).toBe('https://tickets.example/mcp')
})

for (const endpoint of [
  'https://tickets.example/../admin', 'https://tickets.example/tickets/%2e%2e/admin', 'https://tickets.example/tickets/..\\admin',
  'https://tickets.example//attacker.invalid/mcp', 'https://tickets.example/tickets/mcp?forward=https://attacker.invalid',
  'https://tickets.example/tickets/mcp#ignored', 'https://tickets.example/${HOME}/mcp', 'http://tickets.example/mcp',
]) {
  test(`unsafe connector endpoints are rejected: ${endpoint}`, () => {
    expect(() => parseConnector({ ...base, url: endpoint })).toThrow()
  })
}

test('preparation and account lookups reject reserved path segments', () => {
  for (const path of ['__proto__.value', 'constructor.prototype', 'user.prototype.value']) {
    expect(() => parseConnector({ ...base, prepare: { update: { tool: 'check', merge: { [path]: 'changes.value' } } } })).toThrow()
    expect(() => parseConnector({ ...base, prepare: { update: { tool: 'check', warnings: path } } })).toThrow()
    expect(() => parseConnector({ ...base, account: { endpoint: 'https://tickets.example/tickets/api/me', login: path } })).toThrow()
  }
})

test('pick ignores inherited response fields', () => {
  const response: unknown = Object.create({ user: { login: 'inherited-login' } })
  expect(pick(response, 'user.login')).toBeUndefined()
  expect(pick({}, 'constructor')).toBeUndefined()
  expect(pick({}, '__proto__')).toBeUndefined()
})

test('place rejects prototype mutation and leaves the payload unchanged', () => {
  const payload: Record<string, unknown> = { changes: { title: 'Ticket' } }
  expect(() => place(payload, '__proto__.approved', true)).toThrow()
  expect(Object.getPrototypeOf(payload)).toBe(Object.prototype)
  expect(payload.approved).toBeUndefined()
  expect(payload).toEqual({ changes: { title: 'Ticket' } })
})

test('duplicate secret names cannot map one stored credential to several headers', () => {
  expect(() => parseConnector({ ...base, auth: { secrets: [secret, { ...secret, header: 'X-Other-Key' }] } })).toThrow()
})

test('secret headers are unique regardless of HTTP header casing', () => {
  expect(() => parseConnector({ ...base, auth: { secrets: [secret, { ...secret, name: 'otherKey', header: 'x-api-key' }] } })).toThrow()
})

test('connector and secret names cannot shadow inherited record properties', () => {
  for (const name of ['constructor', 'prototype']) {
    expect(() => parseConnector({ ...base, id: name })).toThrow()
    expect(() => parseConnector({ ...base, auth: { secrets: [{ ...secret, name }] } })).toThrow()
  }
})

test('a null secret declaration produces a manifest error rather than a runtime TypeError', () => {
  expect(() => parseConnector({ ...base, auth: { secrets: [null] } })).toThrow(/manifeste/i)
})
