import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DiagnosticLog, Redactor } from './logging.js'

test('MCP evidence preserves Git IDs while known credentials and diagnostic hashes remain masked', () => {
  const sha = 'a1'.repeat(20), key = 'b2'.repeat(20), redactor = new Redactor([key])
  const payload = { content: [{ type: 'text', text: JSON.stringify({ commitId: sha, password: key, echoed: key }) }] }
  expect(JSON.stringify(redactor.value(payload, false))).toContain(sha)
  expect(JSON.stringify(redactor.value(payload, false))).not.toContain(key)
  expect(JSON.stringify(redactor.value(payload))).not.toContain(sha)
})

test('temporary SSH secrets are forgotten independently without removing permanent or shared masks', () => {
  const redact = new Redactor(['permanent-value'])
  const first = redact.addTemporarySecrets(['temporary-@value', 'permanent-value'])
  const second = redact.addTemporarySecrets(['temporary-@value'])
  expect(redact.text('temporary-@value temporary-%40value')).toBe('[REDACTED] [REDACTED]')
  first(); expect(redact.text('temporary-@value')).toBe('[REDACTED]')
  second(); expect(redact.text('temporary-@value')).toBe('temporary-@value')
  expect(redact.text('permanent-value')).toBe('[REDACTED]')
})

test('SSO cookies, CAS tickets and CSRF values are masked in diagnostics', () => {
  const output = JSON.stringify(new Redactor().value({ JSESSIONID: 'session-private', CASTGC: 'cas-cookie-private', APP_CSRF_TOKEN: 'csrf-private',
    text: 'ticket ST-private-ticket TGT-private-ticket https://sso.example.test/login?ticket=ST-private-url&service=space JSESSIONID=private-cookie\nENO_CSRF_TOKEN: private-header' }))
  for (const value of ['session-private', 'cas-cookie-private', 'csrf-private', 'ST-private', 'TGT-private', 'private-cookie', 'private-header']) expect(output).not.toContain(value)
})

test('service credentials and CI secret patterns are masked without registration', () => {
  const output = JSON.stringify(new Redactor().value({ 'X-GitLab-Token': 'oauth-private', 'X-Tickets-API-Key': 'tickets-private',
    text: 'CI glpat-test-value ' + 'a'.repeat(40) + ' password=hidden' }))
  for (const value of ['oauth-private', 'tickets-private', 'glpat-test-value', 'a'.repeat(40), 'hidden']) expect(output).not.toContain(value)
})

test('redacts nested credentials, headers, URLs and known values without losing diagnostic counters', () => {
  const redact = new Redactor(['private-gateway-value'])
  const input = { model: 'sample-gpt-oss', input_tokens: 42, duration_ms: 125,
    token: 'hidden', openaiApiKey: 'openai-hidden-fixture', nested: { password: 'secret', authorization: 'Bearer confidential' },
    text: 'failed: private-gateway-value; Authorization: Bearer another-value; https://user:pass@host/path?api_key=secret&limit=2',
  }
  const output = JSON.stringify(redact.value(input))
  for (const secret of ['hidden', 'confidential', 'private-gateway-value', 'another-value', 'user:pass', '=secret']) expect(output).not.toContain(secret)
  expect(output).toContain('sample-gpt-oss')
  expect(output).toContain('"input_tokens":42')
  expect(output).toContain('"duration_ms":125')
  expect(input.token).toBe('hidden')
})

test('rotates during one running session, bounds archives and oversized entries, and keeps JSON valid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-log-test-'))
  const file = join(root, 'protocol.log')
  const log = new DiagnosticLog(file, new Redactor(['sensitive-value']), 512, 2)
  for (let i = 0; i < 30; i++) log.write('<<', { index: i, result: 'ok', token: 'secret' })
  log.write('<<', { message: 'sensitive-value'.repeat(500) })
  const names = await readdir(root)
  expect(names.sort()).toEqual(['protocol.log', 'protocol.log.1', 'protocol.log.2'])
  for (const name of names) {
    expect((await stat(join(root, name))).size).toBeLessThanOrEqual(512)
    const text = await readFile(join(root, name), 'utf8')
    expect(text).not.toContain('sensitive-value')
    for (const line of text.trim().split('\n')) expect(() => JSON.parse(line.slice(line.indexOf('{')))).not.toThrow()
  }
  expect(await readFile(file, 'utf8')).toContain('truncated')
})

test('masks complete cookie headers, escaped JSON passwords, netrc and private keys', () => {
  const redact = new Redactor()
  const input = 'Cookie: first=private1; second=private2\n' +
    JSON.stringify({ password: 'escaped-"private3' }) + '\n' +
    'machine test login abc password private4\n' +
    '-----BEGIN PRIVATE KEY-----\nprivate5\n-----END PRIVATE KEY-----'
  const output = redact.text(input)
  for (let i = 1; i <= 5; i++) expect(output).not.toContain(`private${i}`)
  expect(output).toContain('machine test login abc')
})

test('a diagnostic filesystem error does not break execution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-log-failure-test-'))
  const parent = join(root, 'not-a-directory')
  await writeFile(parent, 'existing data')
  let errors = 0
  const log = new DiagnosticLog(join(parent, 'protocol.log'), new Redactor(), 512, 2, () => { errors++ })
  expect(() => log.write('<<', { result: 'ok' })).not.toThrow()
  expect(errors).toBe(1)
  expect(await readFile(parent, 'utf8')).toBe('existing data')
})

test('existing log and archives are scrubbed before reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-log-history-test-'))
  const file = join(root, 'protocol.log')
  for (const path of [file, file + '.1']) await writeFile(path, '2026-09-08T00:00:00Z << {"token":"old-secret","model":"gpt-oss"}\n')
  new DiagnosticLog(file, new Redactor(), 1024, 2)
  for (const path of [file, file + '.1']) {
    const content = await readFile(path, 'utf8')
    expect(content).not.toContain('old-secret')
    expect(content).toContain('gpt-oss')
  }
})
