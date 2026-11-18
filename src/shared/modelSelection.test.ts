import { expect, test } from 'bun:test'
import { catalogModels, savedModel, selectedGatewayModel } from './modelSelection.js'
import { requireInferenceEndpoint } from './inferenceEndpoint.js'
import { describeModelRoute, MODEL_IDENTITY_PREFIX } from './modelIdentity.js'

test('saved gateway routes survive restart; removed Claude choices do not', () => {
  expect(savedModel('team-gpt-oss-120b')).toBe('team-gpt-oss-120b')
  for (const old of ['sonnet', 'opusplan', 'opus[1m]', 'claude-sonnet-4-6', null, 42]) {
    expect(savedModel(old)).toBeNull()
  }
})

test('the server default has the same explicit route in the selector and request', () => {
  const models = ['claude-sonnet-4-6', 'team-gpt-oss-120b', 'team-mistral', 'remote-coder'].map(id => ({
    id, label: id, isDefault: id.includes('gpt-oss'), supportsEffort: true,
  }))
  const catalog = catalogModels(models)
  expect(catalog.map(model => model.id)).toEqual(['team-gpt-oss-120b', 'team-mistral', 'remote-coder'])
  expect(selectedGatewayModel(catalog, null)?.id).toBe('team-gpt-oss-120b')
  expect(selectedGatewayModel(catalog, 'team-mistral')?.id).toBe('team-mistral')
  expect(selectedGatewayModel(catalog, 'unknown')?.id).toBe('team-gpt-oss-120b')
  expect(selectedGatewayModel([], null)).toBeNull()
})

test('the Messages protocol never implies a Claude identity or API default', () => {
  expect(MODEL_IDENTITY_PREFIX).toStartWith('You are a coding assistant')
  const description = describeModelRoute('sample-gpt-oss-120b')
  expect(description).toContain('sample-gpt-oss-120b')
  expect(description).not.toMatch(/Sonnet|Opus|Haiku/)
  for (const url of [undefined, '', 'https://api.anthropic.com', 'https://api.anthropic.com.:443', 'https://claude.ai', 'file:///tmp/server']) {
    expect(() => requireInferenceEndpoint(url)).toThrow()
  }
  expect(requireInferenceEndpoint('http://localhost:4000/')).toBe('http://localhost:4000')
})
