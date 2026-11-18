import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalModels } from '../models/index.js'
import { Providers, DEFAULT_PROVIDER, type ProviderConfig } from './index.js'
import { Engine } from '../engine/engine.js'

const catalogue = [
  { model_name: 'claude-sonnet-4-6', litellm_params: { model: 'openai/gpt-oss-120b' } },
  { model_name: 'team-gpt-oss-120b', litellm_params: { model: 'openai/gpt-oss-120b' } },
  { model_name: 'remote-coder', litellm_params: { model: 'openai/qwen' } },
]
const fetchMock = spyOn(globalThis, 'fetch')
afterEach(() => fetchMock.mockReset())
afterAll(() => fetchMock.mockRestore())

async function providers() {
  const root = await mkdtemp(join(tmpdir(), 'provider-test-'))
  let plaintext = ''
  return { root, service: new Providers(root, new LocalModels(root), () => {}, {
    isEncryptionAvailable: () => true,
    encryptString: value => { plaintext = value; return Buffer.from('test-ciphertext') },
    decryptString: () => plaintext,
  }) }
}

test('an unavailable catalogue cannot fall back to a Claude model', async () => {
  fetchMock.mockRejectedValue(new Error('fetch failed'))
  const { service } = await providers()
  await service.set({ kind: 'compatible', baseUrl: 'http://localhost:4000' })
  await expect(service.environment()).rejects.toThrow('Le serveur ne répond pas')
})

test('empty or Anthropic endpoints and removed provider kinds are rejected', async () => {
  const { service } = await providers()
  for (const baseUrl of ['', 'https://api.anthropic.com', 'https://api.anthropic.com.:443/v1']) {
    await service.set({ kind: 'compatible', baseUrl })
    await expect(service.environment()).rejects.toThrow()
  }
  await expect(service.set({ kind: 'anthropic' } as unknown as ProviderConfig)).rejects.toThrow()
})

test('old Anthropic settings are replaced on disk without retaining the old token', async () => {
  const { root, service } = await providers()
  await writeFile(join(root, 'provider.json'), JSON.stringify({ kind: 'anthropic', token: 'obsolete' }))
  expect((await service.load()).kind).toBe(DEFAULT_PROVIDER.kind)
  const saved = JSON.parse(await readFile(join(root, 'provider.json'), 'utf8'))
  expect(saved.kind).toBe(DEFAULT_PROVIDER.kind)
  expect(saved.token === 'obsolete').toBe(false)
})

test('provider startup failures end the turn and display the cause', async () => {
  const engine = new Engine({
    cwd: tmpdir(), appRoot: tmpdir(), engineRoot: tmpdir(), configDir: tmpdir(),
    extraEnv: async () => { throw new Error('Choisissez un modèle.') },
  })
  const notices: string[] = []
  let ended = false
  engine.on('notice', notice => notices.push(notice.text))
  engine.on('turn-end', () => { ended = true })
  await engine.send('Hello')
  expect(notices).toEqual(['Choisissez un modèle.'])
  expect(ended).toBe(true)
  expect(engine.isBusy).toBe(false)
})

test('Ollama turns use independent endpoints and keep their selected model across provider changes', async () => {
  const { service } = await providers()
  const a = new AbortController(), b = new AbortController()
  try {
    await service.set({ kind: 'ollama', ollamaModel: 'default-model' })
    const [envA, envB] = await Promise.all([
      service.environment(null, 'model-a', a.signal), service.environment(null, 'model-b', b.signal),
    ])
    expect(envA.ANTHROPIC_BASE_URL).not.toBe(envB.ANTHROPIC_BASE_URL)
    expect(envA.ANTHROPIC_MODEL).toBe('model-a')
    expect(envB.ANTHROPIC_MODEL).toBe('model-b')
    await service.set({ kind: 'compatible', baseUrl: 'http://localhost:4000' })
    a.abort()
    // Use node:http so this probes the actual listening bridge, not the fetch mock.
    const { get } = await import('node:http')
    const status = await new Promise<number | undefined>((resolve, reject) => {
      get(`${envB.ANTHROPIC_BASE_URL}/health`, response => { response.resume(); resolve(response.statusCode) }).on('error', reject)
    })
    expect(status).toBe(404)
  } finally { a.abort(); b.abort(); service.stop() }
})

test('llama.cpp shares a compatible startup and refuses to restart a server used by another turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'local-multi-'))
  const models = new LocalModels(root)
  const start = spyOn(models, 'start').mockResolvedValue(true)
  const service = new Providers(root, models, () => {})
  const a = new AbortController(), b = new AbortController(), c = new AbortController()
  try {
    await service.set({ kind: 'llamacpp', llamacppModel: 'local-model' })
    await Promise.all([service.environment('low', 'local-model', a.signal), service.environment('low', 'local-model', b.signal)])
    expect(start).toHaveBeenCalledTimes(1)
    await expect(service.environment('high', 'local-model', c.signal)).rejects.toThrow('autre session')
    a.abort()
    await expect(service.environment('high', 'local-model', c.signal)).rejects.toThrow('autre session')
    b.abort()
    await service.environment('high', 'local-model', c.signal)
    expect(start).toHaveBeenCalledTimes(2)
  } finally { a.abort(); b.abort(); c.abort(); service.stop(); start.mockRestore() }
})

test('OpenAI bridge keeps gateway credentials and provider API key out of the engine environment', async () => {
  const { service } = await providers()
  const controller = new AbortController()
  const config: ProviderConfig = { kind: 'openai', baseUrl: 'https://server.example', token: 'server-fixture', openaiBaseUrl: 'https://provider.example/v1', openaiApiKey: 'provider-secret-fixture', openaiModel: 'custom-model' }
  try {
    await service.set(config)
    const env = await service.environment(null, null, controller.signal)
    expect(env.ANTHROPIC_BASE_URL).toStartWith('http://127.0.0.1:')
    expect(env.ANTHROPIC_MODEL).toBe('custom-model')
    expect(JSON.stringify(env)).not.toContain('provider-secret-fixture')
    expect(JSON.stringify(env)).not.toContain('server-fixture')
    expect(service.current.token).toBe('server-fixture')
    expect(fetchMock).not.toHaveBeenCalled()
  } finally { controller.abort(); service.stop() }
})
