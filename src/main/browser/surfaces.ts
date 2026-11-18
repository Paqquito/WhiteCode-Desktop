import {
  BrowserWindow,
  WebContentsView,
  protocol,
  session,
  shell,
  type DownloadItem,
  type IpcMain,
} from 'electron'
import { randomUUID } from 'node:crypto'
import {
  browserUrl,
  type SurfaceSource,
  type SurfaceState,
  type SurfaceBounds,
  type SurfaceCommand,
  type BrowserDownload,
  type BrowserSelection,
} from '../../shared/browser.js'
import { readDocument, type DocumentData } from './documents.js'

// Private scheme: no arbitrary filesystem path is ever exposed to a guest.
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app-preview',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}
type Surface = {
  owner: BrowserWindow
  view: WebContentsView
  state: SurfaceState
  source: SurfaceSource
  abort: AbortController
  document?: DocumentData
  documentUrl: string
  items: Map<string, DownloadItem>
}
export class BrowserSurfaces {
  private surfaces = new Map<string, Surface>()
  constructor(private readonly downloadPath?: (name: string) => string) {}
  get(id: string, owner: BrowserWindow): Surface {
    const surface = this.surfaces.get(id)
    if (!surface || surface.owner !== owner)
      throw new Error('Panneau de navigation fermé.')
    return surface
  }
  private publish(s: Surface): void {
    if (s.view.webContents.isDestroyed() || s.owner.isDestroyed()) return
    const wc = s.view.webContents
    s.state = {
      ...s.state,
      url: s.source.kind === 'web' ? wc.getURL() : s.source.path,
      title: s.document?.title ?? wc.getTitle(),
      back: wc.navigationHistory.canGoBack(),
      forward: wc.navigationHistory.canGoForward(),
    }
    s.owner.webContents.send('surface:state', s.state)
  }
  async open(
    owner: BrowserWindow,
    id: string,
    source: SurfaceSource,
  ): Promise<SurfaceState> {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id))
      throw new Error('Identifiant de panneau invalide.')
    this.close(owner, id)
    const partition = session.fromPartition(`surface-${randomUUID()}`)
    const view = new WebContentsView({
      webPreferences: {
        session: partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true,
        javascript: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    })
    const state: SurfaceState = {
      id,
      url: '',
      title: '',
      loading: true,
      error: '',
      back: false,
      forward: false,
      permission: '',
      downloads: [],
    }
    const s: Surface = {
      owner,
      view,
      state,
      source,
      abort: new AbortController(),
      documentUrl: `app-preview://document/${randomUUID()}`,
      items: new Map(),
    }
    this.surfaces.set(id, s)
    view.setVisible(false)
    owner.contentView.addChildView(view)
    const wc = view.webContents
    const blocked = (permission: string) => {
      const label =
        (
          {
            geolocation: 'géolocalisation',
            media: 'caméra ou microphone',
            notifications: 'notifications',
            fullscreen: 'plein écran',
            'clipboard-read': 'lecture du presse-papiers',
          } as Record<string, string>
        )[permission] ?? 'accès demandé par le site'
      s.state.permission = `Autorisation refusée dans ce panneau : ${label}. Utilisez votre navigateur système si nécessaire.`
      this.publish(s)
    }
    partition.setPermissionCheckHandler(() => false)
    partition.setPermissionRequestHandler((_wc, permission, callback) => {
      blocked(permission)
      callback(false)
    })
    partition.setDevicePermissionHandler(() => false)
    partition.on('will-download', (_event, item, contents) => {
      if (
        source.kind === 'document' &&
        s.document?.mime !== 'application/pdf'
      ) {
        item.cancel()
        return
      }
      if (s.items.size >= 25) {
        item.cancel()
        s.state.error = 'Limite de 25 téléchargements par panneau atteinte.'
        this.publish(s)
        return
      }
      const downloadId = randomUUID()
      s.items.set(downloadId, item)
      if (this.downloadPath)
        item.setSavePath(this.downloadPath(item.getFilename()))
      else item.setSaveDialogOptions({ title: 'Enregistrer le téléchargement' })
      const update = (status: BrowserDownload['status']) => {
        const entry: BrowserDownload = {
          id: downloadId,
          name: item.getFilename(),
          received: item.getReceivedBytes(),
          total: item.getTotalBytes(),
          status,
          paused: item.isPaused(),
        }
        s.state.downloads = [
          entry,
          ...s.state.downloads.filter((d) => d.id !== downloadId),
        ]
        this.publish(s)
      }
      update('progressing')
      item.on('updated', (_e, status) => update(status))
      item.once('done', (_e, status) => update(status))
    })
    if (source.kind === 'document') {
      partition.protocol.handle('app-preview', (request) => {
        if (request.url !== s.documentUrl || !s.document)
          return new Response('Not found', { status: 404 })
        const headers: Record<string, string> = {
          'content-type': s.document.mime,
          'cache-control': 'no-store',
        }
        if (s.document.mime.startsWith('text/html'))
          headers['content-security-policy'] =
            "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; sandbox; base-uri 'none'; form-action 'none'"
        return new Response(s.document.body as Uint8Array<ArrayBuffer>, {
          headers,
        })
      })
      partition.webRequest.onBeforeRequest((details, callback) =>
        callback({
          cancel:
            !details.url.startsWith('app-preview:') &&
            !details.url.startsWith('chrome-extension:') &&
            !details.url.startsWith('chrome:') &&
            !details.url.startsWith('chrome-untrusted:') &&
            !details.url.startsWith('data:') &&
            !details.url.startsWith('blob:'),
        }),
      )
    } else
      partition.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: /^(file|app-preview):/i.test(details.url) }),
      )
    wc.setWindowOpenHandler(({ url }) => {
      if (source.kind === 'web') void this.navigate(s, url)
      return { action: 'deny' }
    })
    const navigation = (event: Electron.Event, url: string) => {
      try {
        if (source.kind === 'web') browserUrl(url)
        else if (url !== s.documentUrl)
          throw new Error('Navigation désactivée dans l’aperçu.')
      } catch (error) {
        event.preventDefault()
        s.state.error = String(error)
        this.publish(s)
      }
    }
    wc.on('will-navigate', navigation)
    wc.on('will-redirect', navigation)
    wc.on('did-start-loading', () => {
      s.state.loading = true
      this.publish(s)
    })
    wc.on('did-stop-loading', () => {
      s.state.loading = false
      this.publish(s)
    })
    wc.on('did-navigate', () => this.publish(s))
    wc.on('did-navigate-in-page', () => this.publish(s))
    wc.on('page-title-updated', () => this.publish(s))
    wc.on('did-fail-load', (_e, code, description, _url, main) => {
      if (main && code !== -3) {
        s.state.error = `Chargement impossible : ${description}`
        s.state.loading = false
        this.publish(s)
      }
    })
    wc.on('render-process-gone', () => {
      s.state.error = 'Le lecteur s’est arrêté. Rechargez le panneau.'
      s.state.loading = false
      this.publish(s)
    })
    if (source.kind === 'web') void this.navigate(s, source.url)
    else
      void readDocument(source.root, source.path, source.html, s.abort.signal)
        .then((document) => {
          if (s.abort.signal.aborted) return
          s.document = document
          return wc.loadURL(s.documentUrl)
        })
        .catch((error) => {
          if (!s.abort.signal.aborted) {
            s.state.error = String(error)
            s.state.loading = false
            this.publish(s)
          }
        })
    return state
  }
  async navigate(s: Surface, url: string): Promise<void> {
    try {
      s.state.error = ''
      s.state.permission = ''
      await s.view.webContents.loadURL(browserUrl(url))
    } catch (error) {
      if (!s.view.webContents.isDestroyed()) {
        s.state.error = String(error)
        s.state.loading = false
        this.publish(s)
      }
    }
  }
  bounds(owner: BrowserWindow, id: string, bounds: SurfaceBounds): void {
    const s = this.surfaces.get(id)
    if (!s || s.owner !== owner) return
    if (
      ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    )
      return
    const [width = 0, height = 0] = owner.getContentSize()
    const x = Math.max(0, Math.min(width, Math.round(bounds.x))),
      y = Math.max(0, Math.min(height, Math.round(bounds.y)))
    s.view.setBounds({
      x,
      y,
      width: Math.max(0, Math.min(width - x, Math.round(bounds.width))),
      height: Math.max(0, Math.min(height - y, Math.round(bounds.height))),
    })
    s.view.setVisible(bounds.visible && bounds.width > 0 && bounds.height > 0)
  }
  async command(
    owner: BrowserWindow,
    id: string,
    command: SurfaceCommand,
    value?: string,
  ): Promise<BrowserSelection | void> {
    const s = this.get(id, owner),
      wc = s.view.webContents
    switch (command) {
      case 'navigate':
        if (s.source.kind === 'web') await this.navigate(s, value ?? '')
        break
      case 'back':
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
        break
      case 'forward':
        if (wc.navigationHistory.canGoForward())
          wc.navigationHistory.goForward()
        break
      case 'reload':
        s.state.error = ''
        wc.reload()
        break
      case 'stop':
        wc.stop()
        s.state.loading = false
        this.publish(s)
        break
      case 'external':
        if (s.source.kind === 'web')
          await shell.openExternal(browserUrl(wc.getURL()))
        break
      case 'selection': {
        const url = wc.getURL()
        const text = String(
          await wc.executeJavaScript(
            'window.getSelection()?.toString().slice(0,4000) || ""',
          ),
        )
        if (wc.getURL() !== url)
          throw new Error(
            'La page a changé ; sélectionnez de nouveau le texte.',
          )
        return { url, text }
      }
      default: {
        const item = s.items.get(value ?? '')
        if (!item) throw new Error('Téléchargement indisponible.')
        if (command === 'cancel-download') item.cancel()
        else if (command === 'pause-download') item.pause()
        else if (command === 'resume-download') item.resume()
        else if (
          command === 'reveal-download' &&
          item.getState() === 'completed'
        )
          shell.showItemInFolder(item.getSavePath())
        s.state.downloads = s.state.downloads.map((d) =>
          d.id === value ? { ...d, paused: item.isPaused() } : d,
        )
        this.publish(s)
        break
      }
    }
  }
  close(owner: BrowserWindow, id: string): void {
    const s = this.surfaces.get(id)
    if (!s) return
    if (s.owner !== owner)
      throw new Error('Panneau appartenant à une autre fenêtre.')
    s.abort.abort()
    for (const item of s.items.values())
      if (item.getState() === 'progressing') item.cancel()
    const partition = s.view.webContents.session
    if (s.source.kind === 'document')
      partition.protocol.unhandle('app-preview')
    partition.webRequest.onBeforeRequest(null)
    partition.removeAllListeners('will-download')
    owner.contentView.removeChildView(s.view)
    s.view.webContents.close()
    s.document = undefined
    this.surfaces.delete(id)
    void partition.clearStorageData().catch(() => {})
    void partition.clearCache().catch(() => {})
  }
  closeOwner(owner: BrowserWindow): void {
    for (const [id, s] of this.surfaces)
      if (s.owner === owner) this.close(owner, id)
  }
}
export function registerBrowserIpc(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  downloadPath?: (name: string) => string,
): BrowserSurfaces {
  const browser = new BrowserSurfaces(downloadPath)
  const owner = (event: Electron.IpcMainInvokeEvent) => {
    const window = getWindow()
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Appel de navigation non autorisé.')
    return window
  }
  ipcMain.handle(
    'surface:open',
    (event, payload: { id: string; source: SurfaceSource }) =>
      browser.open(owner(event), payload.id, payload.source),
  )
  ipcMain.handle(
    'surface:bounds',
    (event, payload: { id: string; bounds: SurfaceBounds }) =>
      browser.bounds(owner(event), payload.id, payload.bounds),
  )
  ipcMain.handle('surface:close', (event, id: string) =>
    browser.close(owner(event), id),
  )
  ipcMain.handle(
    'surface:command',
    (event, payload: { id: string; command: SurfaceCommand; value?: string }) =>
      browser.command(owner(event), payload.id, payload.command, payload.value),
  )
  return browser
}
