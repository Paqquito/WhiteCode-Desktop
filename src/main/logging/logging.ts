import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const MASK = '[REDACTED]'
const SECRET_KEY = /^(?:token|(?:access|refresh|auth|id)[_-]?token|password|passwd|secret|client[_-]?secret|(?:openai)?api[_-]?key|authorization|proxy[_-]?authorization|cookie|set-cookie|JSESSIONID|CASTGC|ticket|lt|[a-z0-9_-]*csrf[_-]?token|x-api-key|x-[a-z0-9-]*(?:token|api-key)|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)$/i

export class Redactor {
  private readonly secrets = new Set<string>()
  private readonly temporarySecrets = new Map<symbol, Redactor>()
  constructor(secrets: string[] = []) { this.addSecrets(secrets) }

  addSecrets(secrets: string[]): void {
    for (const secret of secrets) {
      if (!secret) continue
      this.secrets.add(secret)
      this.secrets.add(encodeURIComponent(secret))
      this.secrets.add(JSON.stringify(secret).slice(1, -1))
    }
  }

  addTemporarySecrets(secrets: string[]): () => void {
    const id = Symbol('temporary-secret')
    this.temporarySecrets.set(id, new Redactor(secrets))
    return () => { this.temporarySecrets.delete(id) }
  }

  text(text: string, opaqueHashes = true): string {
    for (const temporary of this.temporarySecrets.values()) text = temporary.text(text, opaqueHashes)
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join(MASK)
    }
    if (opaqueHashes) text = text.replace(/\b[0-9a-fA-F]{40}\b/g, MASK)
    return text
      .replace(/glpat-[\w.-]+/g, MASK)
      .replace(/\b(?:ST|TGT)-[\w.-]+/g, MASK)
      .replace(/\b(JSESSIONID|CASTGC|[A-Z0-9_]*CSRF_TOKEN)\s*[:=]\s*[^\s"'\\,;]+/gi, `$1=${MASK}`)
      .replace(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g, MASK)
      .replace(/(^|\r?\n)([ \t]*(?:cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-[a-z0-9-]*(?:token|api-key))\s*:\s*)[^\r\n]*/gi,
        (_match, newline: string, header: string) => `${newline}${header}${MASK}`)
      .replace(/\b(Bearer|Basic)\s+[^\s"'\\,;]+/gi, `$1 ${MASK}`)
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, `$1${MASK}@`)
      .replace(/([?&](?:api[_-]?key|token|access_token|password|secret|ticket|lt)=)[^&\s"']*/gi, `$1${MASK}`)
      .replace(/((?:["']?)(?:password|passwd|token|api[_-]?key|secret|authorization|x-api-key|x-[a-z0-9-]*(?:token|api-key)|cookie|set-cookie)(?:["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\s,;]+)/gi,
        (_match, prefix: string) => `${prefix}"${MASK}"`)
      .replace(/\b(password|passwd)\s+(?![:=])\S+/gi, `$1 ${MASK}`)
  }

  value(value: unknown, opaqueHashes = true): unknown {
    if (typeof value === 'string') return this.text(value, opaqueHashes)
    if (Array.isArray(value)) return value.map(item => this.value(item, opaqueHashes))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEY.test(key) ? MASK : this.value(item, opaqueHashes)]))
    }
    return value
  }
}

/** Bounded, redacted diagnostic trace. Conversation transcripts are separate. */
export class DiagnosticLog {
  private bytes = 0
  private failed = false

  constructor(
    private readonly file: string,
    readonly redactor: Redactor,
    private readonly maxBytes = 8 * 1024 * 1024,
    private readonly archives = 3,
    private readonly onError: () => void = () => {},
  ) {
    if (maxBytes < 256 || archives < 1) throw new Error('Invalid diagnostic log limits')
    try {
      mkdirSync(dirname(file), { recursive: true })
      for (let i = 0; i <= archives; i++) this.scrub(i === 0 ? file : `${file}.${i}`)
      this.bytes = existsSync(file) ? statSync(file).size : 0
    } catch { this.fail() }
  }

  write(direction: string, payload: unknown): void {
    if (this.failed) return
    try {
      const line = this.line(`${new Date().toISOString()} ${direction} `, this.redactor.value(payload))
      const size = Buffer.byteLength(line)
      if (this.bytes + size > this.maxBytes) this.rotate()
      appendFileSync(this.file, line, { encoding: 'utf8', mode: 0o600 })
      this.bytes += size
    } catch { this.fail() }
  }

  private line(prefix: string, payload: unknown): string {
    const json = JSON.stringify(payload) ?? 'null'
    let line = `${prefix}${json}\n`
    if (Buffer.byteLength(line) > this.maxBytes) {
      let preview = json.slice(0, Math.floor(this.maxBytes / 4))
      do {
        line = `${prefix}${JSON.stringify({ truncated: true, originalBytes: Buffer.byteLength(json), preview })}\n`
        preview = preview.slice(0, Math.floor(preview.length / 2))
      } while (Buffer.byteLength(line) > this.maxBytes && preview.length > 0)
    }
    return line
  }

  private rotate(): void {
    const oldest = `${this.file}.${this.archives}`
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let i = this.archives - 1; i >= 1; i--) {
      if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`)
    }
    if (existsSync(this.file)) renameSync(this.file, `${this.file}.1`)
    this.bytes = 0
  }

  private scrub(file: string): void {
    if (!existsSync(file)) return
    const size = statSync(file).size
    const length = Math.min(size, this.maxBytes)
    const buffer = Buffer.alloc(length)
    const fd = openSync(file, 'r')
    try { readSync(fd, buffer, 0, length, size - length) }
    finally { closeSync(fd) }
    let text = buffer.toString('utf8')
    if (size > length) text = text.slice(text.indexOf('\n') + 1)
    const lines: string[] = []
    let bytes = 0
    for (const raw of text.split('\n')) {
      if (!raw) continue
      const match = /^(\S+ (?:<<|>>|stderr) )(.*)$/.exec(raw)
      let line: string
      try {
        if (!match) throw new Error()
        line = this.line(match[1]!, this.redactor.value(JSON.parse(match[2]!)))
      } catch { line = this.line(`${new Date().toISOString()} legacy `, { text: this.redactor.text(raw) }) }
      lines.push(line)
      bytes += Buffer.byteLength(line)
      while (bytes > this.maxBytes && lines.length) bytes -= Buffer.byteLength(lines.shift()!)
    }
    const temporary = `${file}.redacting`
    try { writeFileSync(temporary, lines.join(''), { mode: 0o600 }); renameSync(temporary, file) }
    finally { if (existsSync(temporary)) unlinkSync(temporary) }
  }

  private fail(): void {
    this.failed = true
    this.onError()
  }
}
