import { expect, test } from 'bun:test'
import { createServer, type ServerResponse } from 'node:http'
import { OllamaBridge } from './ollamaBridge.js'

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1500
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Upstream connection did not close after cancellation')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

async function fixture(sendHeaders: boolean) {
  const responses: ServerResponse[] = []
  let closed = 0
  const upstream = createServer((request, response) => {
    request.resume()
    responses.push(response)
    response.once('close', () => { closed++ })
    if (sendHeaders) {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      response.write(JSON.stringify({ message: { content: 'partial answer' }, done: false }) + '\n')
    }
  })
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const address = upstream.address()
  if (!address || typeof address === 'string') throw new Error('No upstream port')
  const bridge = new OllamaBridge({ host: `http://127.0.0.1:${address.port}`, model: 'local-fixture', contextLength: 4096 })
  const baseUrl = await bridge.start()
  return {
    bridge, responses, closed: () => closed,
    request(signal: AbortSignal, stream: boolean) {
      return fetch(`${baseUrl}/v1/messages`, { method: 'POST', signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'test' }], stream }),
      }).then(response => response.text()).catch(() => 'cancelled')
    },
    cleanup() {
      for (const response of responses) response.destroy()
      upstream.closeAllConnections()
      upstream.close()
      bridge.stop()
    },
  }
}

for (const scenario of [
  { name: 'before upstream headers', headers: false, stream: true },
  { name: 'during streaming', headers: true, stream: true },
  { name: 'during a non-streaming response', headers: true, stream: false },
]) {
  test(`client cancellation aborts Ollama ${scenario.name}`, async () => {
    const f = await fixture(scenario.headers)
    const controller = new AbortController()
    const request = f.request(controller.signal, scenario.stream)
    try {
      await until(() => f.responses.length === 1)
      // Give the bridge time to enter the body reader when headers were sent.
      await new Promise(resolve => setTimeout(resolve, 30))
      controller.abort()
      await request
      await until(() => f.closed() === 1)
      expect(f.responses[0]!.destroyed).toBe(true)
    } finally {
      controller.abort()
      f.cleanup()
      await request
    }
  })
}

test('stopping the bridge cancels all active upstream requests and closes clients', async () => {
  const f = await fixture(false)
  const controller = new AbortController()
  const requests = [f.request(controller.signal, true), f.request(controller.signal, false)]
  try {
    await until(() => f.responses.length === 2)
    f.bridge.stop()
    expect(f.bridge.baseUrl).toBeNull()
    await until(() => f.closed() === 2)
    // Bun can resolve a destroyed HTTP response to an empty body; Node fetch
    // rejects it. Both must finish without fabricating a 502 API error.
    for (const result of await Promise.all(requests)) expect(['', 'cancelled']).toContain(result)
  } finally {
    controller.abort()
    f.cleanup()
    await Promise.all(requests)
  }
})

for (const stream of [true, false]) {
  test(`a completed POST keeps its upstream alive until the response ends (stream=${stream})`, async () => {
    const f = await fixture(true)
    const controller = new AbortController()
    const request = f.request(controller.signal, stream)
    try {
      await until(() => f.responses.length === 1)
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(f.closed()).toBe(0)
      f.responses[0]!.end(JSON.stringify({ message: { content: 'complete answer' }, done: true, prompt_eval_count: 12, eval_count: 3 }) + '\n')
      const result = await request
      expect(result).toContain('complete answer')
      expect(result).toContain('"input_tokens":12')
      expect(result).toContain('"output_tokens":3')
      if (stream) expect(result).toContain('event: message_stop')
      else expect(JSON.parse(result).stop_reason).toBe('end_turn')
    } finally {
      controller.abort()
      f.cleanup()
      await request
    }
  })
}
