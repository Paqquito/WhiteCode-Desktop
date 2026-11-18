/**
 * Pont Anthropic ⇄ Ollama.
 *
 * ## Pourquoi ce fichier existe
 *
 * Le moteur ne parle **qu'un seul protocole** : celui des Messages d'Anthropic.
 * `ANTHROPIC_BASE_URL` permet de le pointer ailleurs, mais l'endroit visé doit
 * répondre dans cette forme-là. Or Ollama ne la connaît pas : il expose son
 * `/api/chat` et une compatibilité OpenAI, deux formes différentes.
 *
 * Pointer le moteur directement sur Ollama ne donnerait donc pas un modèle
 * local, mais une erreur de protocole à chaque tour. Ce serveur comble l'écart :
 * il accepte `/v1/messages`, traduit vers `/api/chat`, et retraduit la réponse
 * en flux d'événements Anthropic.
 *
 * ## Ce qui est traduit
 *
 * Les blocs de contenu dans les deux sens — texte, images, appels d'outils et
 * leurs résultats. Les outils sont le point critique : le moteur en dépend pour
 * tout ce qu'il fait, et un modèle qui ne les gère pas ne pourra ni lire un
 * fichier ni lancer une commande. Ollama annonce cette capacité par modèle
 * (`capabilities: ["tools"]`), ce que le sélecteur de modèles vérifie.
 *
 * ## Ce qui ne l'est pas
 *
 * La mise en cache de contexte (`cache_control`) n'a pas d'équivalent : elle
 * est ignorée. Le décompte de jetons est celui d'Ollama, donc mesuré et non
 * estimé, mais son découpage diffère de celui d'Anthropic — les chiffres de la
 * jauge de contexte sont justes pour Ollama, pas comparables à ceux d'un
 * modèle Claude.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'

export type BridgeOptions = {
  /** Adresse du serveur Ollama, par exemple `http://127.0.0.1:11434`. */
  host: string
  /** Modèle Ollama employé, quel que soit celui que le moteur demande. */
  model: string
  /**
   * Fenêtre de contexte annoncée à Ollama.
   *
   * Sans elle, Ollama retombe sur sa valeur par défaut — souvent 4096 jetons,
   * bien en deçà de ce que le modèle sait faire. Le moteur envoie des invites
   * de plusieurs dizaines de milliers de jetons : la conversation serait
   * tronquée en silence dès le premier appel d'outil.
   */
  contextLength: number
}

/** Bloc de contenu Anthropic, réduit à ce que le pont manipule. */
type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: string; media_type: string; data: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: unknown; is_error?: boolean }
  | { type: string; [key: string]: unknown }

type AnthropicRequest = {
  model?: string
  max_tokens?: number
  system?: string | AnthropicBlock[]
  messages: Array<{ role: 'user' | 'assistant'; content: string | AnthropicBlock[] }>
  tools?: Array<{ name: string; description?: string; input_schema?: unknown }>
  stream?: boolean
  temperature?: number
}

type OllamaMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  images?: string[]
  tool_calls?: Array<{ function: { name: string; arguments: unknown } }>
  tool_name?: string
}

/** Texte d'un contenu, quelle que soit sa forme. */
function flatten(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content)
  return content
    .map(part => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) {
        return String((part as { text: unknown }).text)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Traduit les messages Anthropic vers la forme d'Ollama.
 *
 * Un message Anthropic peut porter plusieurs blocs de nature différente ; un
 * message Ollama porte un texte, des images et des appels d'outils séparés. Un
 * message d'entrée peut donc en produire plusieurs — c'est le cas des résultats
 * d'outils, qu'Ollama attend chacun dans son propre message `tool`.
 */
function toOllamaMessages(request: AnthropicRequest): OllamaMessage[] {
  const out: OllamaMessage[] = []

  const system = request.system ? flatten(request.system) : ''
  if (system) out.push({ role: 'system', content: system })

  for (const message of request.messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content })
      continue
    }

    const texts: string[] = []
    const images: string[] = []
    const toolCalls: Array<{ function: { name: string; arguments: unknown } }> = []
    /** Émis après le message courant : Ollama veut un message par résultat. */
    const results: OllamaMessage[] = []

    for (const block of message.content) {
      switch (block.type) {
        case 'text':
          texts.push((block as { text: string }).text)
          break

        case 'image': {
          const source = (block as { source?: { data?: string } }).source
          // Ollama ne prend que le base64 nu, sans type MIME ni préfixe.
          if (source?.data) images.push(source.data)
          break
        }

        case 'tool_use': {
          const call = block as { id: string; name: string; input: unknown }
          toolCalls.push({
            function: { name: call.name, arguments: call.input ?? {} },
          })
          break
        }

        case 'tool_result': {
          const result = block as {
            tool_use_id: string
            content: unknown
            is_error?: boolean
          }
          const text = flatten(result.content)
          results.push({
            role: 'tool',
            // Le nom permet à Ollama de rattacher le résultat à son appel ;
            // les modèles qui l'ignorent se contentent du contenu.
            tool_name: result.tool_use_id,
            content: result.is_error ? `Erreur : ${text}` : text,
          })
          break
        }
      }
    }

    const body = texts.join('\n')
    if (body || images.length > 0 || toolCalls.length > 0) {
      out.push({
        role: message.role,
        content: body,
        ...(images.length > 0 ? { images } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
    }
    out.push(...results)
  }

  return out
}

function toOllamaTools(request: AnthropicRequest): unknown[] | undefined {
  if (!request.tools || request.tools.length === 0) return undefined
  return request.tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema ?? { type: 'object', properties: {} },
    },
  }))
}

/** Écrit un événement au format SSE attendu par le moteur. */
function sse(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export class OllamaBridge {
  private server: Server | null = null
  private port = 0
  private active = new Map<AbortController, ServerResponse>()

  constructor(private readonly options: BridgeOptions) {}

  /** Adresse à donner au moteur, ou `null` tant que le pont n'écoute pas. */
  get baseUrl(): string | null {
    return this.port ? `http://127.0.0.1:${this.port}` : null
  }

  async start(): Promise<string> {
    if (this.server) return this.baseUrl!

    const server = createServer((request, response) => {
      const controller = new AbortController()
      this.active.set(controller, response)
      const abort = () => controller.abort()
      // IncomingMessage.close also fires after a complete POST body. Only
      // an aborted upload or an unfinished response means the client left.
      const onClose = () => { if (!response.writableEnded) abort() }
      request.once('aborted', abort)
      response.once('close', onClose)
      // L'échec doit repartir dans la forme d'erreur d'Anthropic : le moteur
      // ne sait lire que celle-là, et un corps hors format se manifesterait
      // par une erreur d'analyse sans rapport avec la cause.
      void this.handle(request, response, controller.signal).catch((error: unknown) => {
        if (controller.signal.aborted || response.destroyed) return
        const message = String((error as Error)?.message ?? error)
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({
              type: 'error',
              error: { type: 'api_error', message: `Pont Ollama : ${message}` },
            }),
          )
        } else {
          response.end()
        }
      }).finally(() => {
        this.active.delete(controller)
        request.off('aborted', abort)
        response.off('close', onClose)
      })
    })

    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      // Port éphémère et adresse de bouclage : le pont ne doit être joignable
      // que depuis cette machine, et n'a aucune raison de réserver un port fixe.
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const address = server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    return this.baseUrl!
  }

  stop(): void {
    this.server?.close()
    for (const [controller, response] of this.active) {
      controller.abort()
      response.destroy()
    }
    this.active.clear()
    this.server?.closeAllConnections()
    this.server = null
    this.port = 0
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    const url = request.url ?? ''

    // Le moteur estime parfois la taille d'une invite avant de l'envoyer.
    // Ollama n'expose pas ce calcul : une approximation vaut mieux qu'un échec,
    // l'usage réel étant rapporté à la fin du tour.
    if (url.startsWith('/v1/messages/count_tokens')) {
      const body = await readBody(request)
      const approx = Math.ceil(JSON.stringify(body).length / 4)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ input_tokens: approx }))
      return
    }

    if (!url.startsWith('/v1/messages')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: url } }))
      return
    }

    const payload = (await readBody(request)) as AnthropicRequest
    signal.throwIfAborted()
    const ollamaBody = {
      model: this.options.model,
      messages: toOllamaMessages(payload),
      tools: toOllamaTools(payload),
      stream: payload.stream !== false,
      options: {
        num_ctx: this.options.contextLength,
        ...(payload.temperature !== undefined
          ? { temperature: payload.temperature }
          : {}),
      },
    }

    const upstream = await fetch(`${this.options.host}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ollamaBody),
      signal,
    })

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => upstream.statusText)
      signal.throwIfAborted()
      response.writeHead(502, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          type: 'error',
          error: { type: 'api_error', message: `Ollama : ${detail}` },
        }),
      )
      return
    }

    if (payload.stream === false) {
      await this.relayWhole(upstream, response)
      return
    }
    await this.relayStream(upstream, response)
  }

  /** Réponse d'un seul tenant, pour les rares appels non diffusés. */
  private async relayWhole(upstream: Response, response: ServerResponse): Promise<void> {
    const text = await upstream.text()
    // Ollama répond en NDJSON même hors diffusion : la dernière ligne porte
    // le message complet.
    const lines = text.trim().split('\n').filter(Boolean)
    const last = JSON.parse(lines[lines.length - 1]!) as OllamaChunk
    const blocks: unknown[] = []
    if (last.message?.content) {
      blocks.push({ type: 'text', text: last.message.content })
    }
    for (const call of last.message?.tool_calls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        name: call.function.name,
        input: call.function.arguments ?? {},
      })
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        id: `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        type: 'message',
        role: 'assistant',
        model: this.options.model,
        content: blocks,
        stop_reason: last.message?.tool_calls?.length ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: last.prompt_eval_count ?? 0,
          output_tokens: last.eval_count ?? 0,
        },
      }),
    )
  }

  /**
   * Retransmet le flux d'Ollama en événements Anthropic.
   *
   * Le découpage diffère : Ollama émet un objet JSON par ligne, chacun portant
   * un fragment de texte ; Anthropic attend une ouverture de bloc, des deltas,
   * puis une fermeture. Les appels d'outils arrivent d'un bloc chez Ollama et
   * doivent repartir en `input_json_delta`, forme que le moteur sait recomposer.
   */
  private async relayStream(upstream: Response, response: ServerResponse): Promise<void> {
    const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })

    sse(response, 'message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: this.options.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })

    let index = -1
    /** Un bloc de texte est-il ouvert ? */
    let textOpen = false
    let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'
    let inputTokens = 0
    let outputTokens = 0

    const closeText = () => {
      if (!textOpen) return
      sse(response, 'content_block_stop', { type: 'content_block_stop', index })
      textOpen = false
    }

    const reader = upstream.body!.getReader()
    const decoder = new TextDecoder()
    let buffered = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        let chunk: OllamaChunk
        try {
          chunk = JSON.parse(trimmed) as OllamaChunk
        } catch {
          continue
        }

        const piece = chunk.message?.content ?? ''
        if (piece) {
          if (!textOpen) {
            index++
            textOpen = true
            sse(response, 'content_block_start', {
              type: 'content_block_start',
              index,
              content_block: { type: 'text', text: '' },
            })
          }
          sse(response, 'content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: { type: 'text_delta', text: piece },
          })
        }

        for (const call of chunk.message?.tool_calls ?? []) {
          // Un appel d'outil clôt le texte en cours : Anthropic n'autorise pas
          // deux blocs ouverts à la fois.
          closeText()
          index++
          const id = `toolu_${randomUUID().replace(/-/g, '').slice(0, 24)}`
          sse(response, 'content_block_start', {
            type: 'content_block_start',
            index,
            content_block: { type: 'tool_use', id, name: call.function.name, input: {} },
          })
          sse(response, 'content_block_delta', {
            type: 'content_block_delta',
            index,
            delta: {
              type: 'input_json_delta',
              partial_json: JSON.stringify(call.function.arguments ?? {}),
            },
          })
          sse(response, 'content_block_stop', { type: 'content_block_stop', index })
          stopReason = 'tool_use'
        }

        if (chunk.done) {
          inputTokens = chunk.prompt_eval_count ?? 0
          outputTokens = chunk.eval_count ?? 0
          if (chunk.done_reason === 'length') stopReason = 'max_tokens'
        }
      }
    }

    closeText()

    sse(response, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    })
    sse(response, 'message_stop', { type: 'message_stop' })
    response.end()
  }
}

type OllamaChunk = {
  message?: {
    content?: string
    thinking?: string
    tool_calls?: Array<{ function: { name: string; arguments: unknown } }>
  }
  done?: boolean
  done_reason?: string
  prompt_eval_count?: number
  eval_count?: number
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}
