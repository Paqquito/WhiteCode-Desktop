/** WhiteCode's public JSONL protocol translated to the desktop's display events. */
import { ESSENTIAL_TOOLS, type EngineMessage, type PermissionMode } from '#desktop/session-protocol'

export const approvalMode = (mode: PermissionMode): string => ({ default: 'ask', acceptEdits: 'auto_edit', plan: 'planning', bypassPermissions: 'unrestricted', dontAsk: 'no_prompt' })[mode]
export const desktopMode = (mode: string): PermissionMode => ({ ask: 'default', auto_edit: 'acceptEdits', planning: 'plan', unrestricted: 'bypassPermissions', no_prompt: 'dontAsk' } as Record<string, PermissionMode>)[mode] ?? 'default'

const TOOLS: Record<string, string[]> = {
  Read: ['read_file'], Write: ['write_file'], Edit: ['edit_file'], Bash: ['run_shell', 'run_powershell'], PowerShell: ['run_powershell'],
  WebSearch: ['search_web'], Monitor: ['monitor_process'], SendUserFile: ['deliver_file'], PushNotification: ['notify_device'],
  Glob: ['find_files'], Grep: ['search_content'], TodoWrite: ['update_todo_list'], Agent: ['spawn_agent'], Task: ['spawn_agent'],
  WebFetch: ['fetch_url'], NotebookEdit: ['update_notebook_cell'],
}
export function whiteCodeTools(tools: string[]): string[] {
  const names = new Set(tools.flatMap(name => TOOLS[name] ?? [name]))
  // Saved sessions store the reduced preset as desktop names. Translate it here
  // so existing and new sessions can both load skills and attach their output.
  if (tools.length === ESSENTIAL_TOOLS.length && ESSENTIAL_TOOLS.every(name => tools.includes(name))) {
    names.add('use_skill')
    names.add('deliver_file')
  }
  return [...names]
}

export function whiteCodeContent(content: string | unknown[]): unknown {
  if (typeof content === 'string') return content
  return content.map((part: any) => {
    if (part?.type === 'text' && typeof part.text === 'string') return { type: 'text', text: part.text }
    if (part?.type === 'image' && part.source?.type === 'base64') return { type: 'image', mediaType: part.source.media_type, data: part.source.data }
    throw new Error('Pièce jointe non prise en charge : fournissez du texte ou une image base64.')
  })
}

export class WhiteCodeProtocol {
  private textOpen = false
  private thinkingOpen = false
  private model = ''
  constructor(private readonly contextWindow: number) {}

  messages(event: Record<string, any>): EngineMessage[] {
    const stream = (event: unknown): EngineMessage => ({ type: 'stream_event', event } as EngineMessage)
    const assistant = (content: unknown[]): EngineMessage => ({ type: 'assistant', message: { id: crypto.randomUUID(), model: this.model, content } } as EngineMessage)
    switch (event.type) {
      case 'session':
        this.model = String(event.model ?? '')
        return [{ type: 'system', subtype: 'init', session_id: event.sessionId, cwd: event.cwd, tools: event.tools ?? [], model: this.model, permissionMode: desktopMode(event.permissionMode), slash_commands: event.commands, context_limit: this.contextWindow }]
      case 'assistant': {
        if (typeof event.content !== 'string') return []
        if (event.partial === true) {
          const messages: EngineMessage[] = []
          if (!this.textOpen) { this.textOpen = true; messages.push(stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })) }
          messages.push(stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: event.content } }))
          return messages
        }
        const messages: EngineMessage[] = []
        if (this.textOpen) messages.push(stream({ type: 'content_block_stop', index: 0 }))
        if (this.thinkingOpen) messages.push(stream({ type: 'content_block_stop', index: 1 }))
        this.textOpen = false; this.thinkingOpen = false
        messages.push(assistant([{ type: 'text', text: event.content }, ...(event.toolCalls ?? []).map((call: any) => ({ type: 'tool_use', id: call.callId, name: call.toolId, input: call.input }))]))
        return messages
      }
      case 'thinking': {
        const messages: EngineMessage[] = []
        if (!this.thinkingOpen) { this.thinkingOpen = true; messages.push(stream({ type: 'content_block_start', index: 1, content_block: { type: 'thinking', thinking: '' } })) }
        messages.push(stream({ type: 'content_block_delta', index: 1, delta: { type: 'thinking_delta', thinking: event.content } }))
        return messages
      }
      case 'tool_call': return [assistant([{ type: 'tool_use', id: event.callId, name: event.toolId, input: event.input }])]
      case 'tool_result': return [{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: event.callId, content: event.output, is_error: event.errored === true }] } }]
      case 'control_response': return [event as EngineMessage]
      case 'control_request':
        if (event.request !== 'approval_request') return []
        return [{ type: 'control_request', request_id: event.id, request: { subtype: 'can_use_tool', tool_name: event.params.toolName, input: event.params.input ?? {}, tool_use_id: event.params.callId, title: event.params.summary, decision_reason: event.params.reason } }]
      case 'run_completed': return [{
        type: 'result', session_id: event.sessionId, subtype: event.exitCode === 0 && event.haltReason === 'completed' ? 'success' : event.haltReason ?? 'error',
        is_error: event.exitCode !== 0 || event.haltReason !== 'completed', stop_reason: event.haltReason === 'completed' ? 'end_turn' : event.haltReason, result: event.message ?? event.result ?? '', duration_ms: event.elapsedMs,
        ...(event.cost?.currency === 'USD' && typeof event.cost.confirmed === 'number' ? { total_cost_usd: event.cost.confirmed } : {}),
        usage: { input_tokens: event.usage?.inputTokens ?? 0, output_tokens: event.usage?.outputTokens ?? 0, cache_read_input_tokens: event.usage?.cacheReadTokens ?? 0, cache_creation_input_tokens: event.usage?.cacheWriteTokens ?? 0 },
        modelUsage: { [this.model]: { contextWindow: this.contextWindow } },
      }]
      default: return []
    }
  }
}
