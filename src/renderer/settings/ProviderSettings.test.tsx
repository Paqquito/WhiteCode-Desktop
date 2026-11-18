import { expect, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProviderSettings } from './ProviderSettings.js'
import type { useProvider } from '../state/useProvider.js'

test('provider settings offer the four supported providers', () => {
  const provider: ReturnType<typeof useProvider> = {
    config: { kind: 'compatible', baseUrl: 'http://localhost:4000' },
    models: null, localModels: [], gatewayModels: null,
    gatewayError: null, storageError: null, ollamaError: null, probing: false,
    apply: () => {}, probeOllama: async () => {},
  }
  const html = renderToStaticMarkup(
    <ProviderSettings provider={provider} reducedTools onReducedTools={() => {}} />,
  )
  expect(html).toContain('API compatible OpenAI')
  expect((html.match(/type="radio"/g) ?? []).length).toBe(4)
  for (const name of ['Serveur d’inférence compatible', 'llama.cpp', 'Ollama']) {
    expect(html).toContain(name)
  }
  expect(html).not.toMatch(/Anthropic|Sonnet|Opus|Haiku/)
})
