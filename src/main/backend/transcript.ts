/** Read-only adaptation of the documented WhiteCode v1 transcript format. */
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function projectKey(path: string): string {
  return [...Buffer.from(path, 'utf8')].map(byte => /[A-Za-z0-9.-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : '_' + byte.toString(16).padStart(2, '0')).join('')
}

export function desktopTranscript(record: any, contentRoot?: string): any {
  if (record?.v !== 1 || !record.data || typeof record.data !== 'object') return record
  const decode = (value: any, depth = 0): any => {
    if (depth > 8) return '[Contenu trop imbriqué]'
    if (value && typeof value === 'object' && /^[a-f0-9]{64}$/.test(value.$contentRef ?? '') && ['utf8', 'base64'].includes(value.encoding)) {
      if (!contentRoot) return '[Contenu stocké séparément]'
      try {
        const file = join(contentRoot, value.$contentRef + '.blob'), info = lstatSync(file)
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 20 * 1024 * 1024) return '[Contenu indisponible]'
        const bytes = readFileSync(file)
        return createHash('sha256').update(bytes).digest('hex') === value.$contentRef ? bytes.toString(value.encoding) : '[Contenu altéré]'
      } catch { return '[Contenu indisponible]' }
    }
    if (Array.isArray(value)) return value.map(part => decode(part, depth + 1))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, decode(part, depth + 1)]))
    return value
  }
  const data = record.data, base = { uuid: record.id, timestamp: record.ts, sessionId: record.sessionId }
  switch (record.type) {
    case 'session_meta': return { ...base, type: 'system', cwd: data.cwd }
    case 'user': return { ...base, type: 'user', message: { content: decode(data.content) } }
    case 'assistant': return { ...base, type: 'assistant', message: { content: [{ type: 'text', text: data.text ?? '' }, ...(data.toolCalls ?? []).map((call: any) => ({ type: 'tool_use', id: call.id ?? call.callId, name: call.name, input: call.input }))] } }
    case 'tool_result': return { ...base, type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: data.callId, is_error: data.isError, content: data.content }] } }
    case 'file_snapshot': return data.kind === 'checkpoint' ? { ...base, type: 'file-history-snapshot', messageId: data.message } : { ...base, type: 'system' }
    default: return { ...base, type: 'system' }
  }
}
