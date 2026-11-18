export type BrowserSelection = { url: string; text: string }
export type SurfaceSource =
  | { kind: 'web'; url: string }
  | { kind: 'document'; root: string; path: string; html?: string }
export type SurfaceBounds = {
  x: number
  y: number
  width: number
  height: number
  visible: boolean
}
export type BrowserDownload = {
  id: string
  name: string
  received: number
  total: number
  status: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  paused: boolean
}
export type SurfaceState = {
  id: string
  url: string
  title: string
  loading: boolean
  error: string
  back: boolean
  forward: boolean
  permission: string
  downloads: BrowserDownload[]
}
export type SurfaceCommand =
  | 'navigate'
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'external'
  | 'selection'
  | 'cancel-download'
  | 'pause-download'
  | 'resume-download'
  | 'reveal-download'
export function browserUrl(input: string): string {
  const value = input.trim()
  if (!value || value.length > 8192)
    throw new Error('Saisissez une adresse HTTP ou HTTPS.')
  const url = new URL(
    /^[a-z][a-z\d+.-]*:/i.test(value) && !/^localhost:\d/i.test(value)
      ? value
      : `${/^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(value) ? 'http' : 'https'}://${value}`,
  )
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      'Seules les adresses HTTP et HTTPS sans identifiants sont acceptées.',
    )
  return url.href
}
export const DOCUMENT_PREVIEW = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i
export const HTML_PREVIEW = /\.html?$/i
