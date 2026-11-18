import { app, BrowserWindow, dialog, nativeImage } from 'electron'
import { join } from 'node:path'

function sessionFromDeepLink(scheme: string, urls: readonly string[]): string | null {
  for (const raw of urls) {
    if (!raw.startsWith(`${scheme}://`)) continue
    try {
      const url = new URL(raw)
      if (url.hostname !== 'session') continue
      const id = url.pathname.replace(/^\/+/, '')
      if (id) return decodeURIComponent(id)
    } catch {
      // Un lien mal formé se trouve dans la nature ; il ne doit rien casser.
    }
  }
  return null
}

export function registerSessionLinks(scheme: string, currentWindow: () => BrowserWindow | null, openNotificationSession: (id: string) => void) {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.on('second-instance', (_event, argv) => {
      const window = currentWindow()
      const id = sessionFromDeepLink(scheme, argv)
      if (id) openNotificationSession(id)
      else if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore()
        window.focus()
      }
    })
    // macOS ne relance pas le programme : il livre l'adresse à l'instance vivante.
    app.on('open-url', (event, url) => {
      event.preventDefault()
      const id = sessionFromDeepLink(scheme, [url])
      if (id) openNotificationSession(id)
    })
  }
}

export function createApplicationWindow(options: {
  product: string
  icon: string
  dist: string
  closePolicy(): string
  busy(): boolean
  closeSurfaces(window: BrowserWindow): void
}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 780,
    minHeight: 540,
    // Peint avant le premier rendu : sans cette teinte, la fenêtre s'ouvre
    // sur un fond blanc système puis bascule, ce qui produit un clignotement.
    backgroundColor: '#ffffff',
    title: options.product,
    icon: nativeImage.createFromPath(options.icon),
    // La barre de menu native (File / Edit / View / Window) n'offre rien que
    // l'application n'expose déjà, et rompt la ligne épurée : l'espace
    // au-dessus du contenu doit appartenir à l'application, pas au système.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(options.dist, 'preload.js'),
      // Le rendu n'a aucun accès direct à Node : tout passe par le
      // préchargement, qui expose une surface nommée et vérifiée.
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const browserOwner = window
  // The privileged desktop and its password form only load the bundled UI.
  // Web pages use the existing isolated BrowserSurfaces instead.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-redirect', event => event.preventDefault())
  window.on('close', event => {
    // Préférence « Confirmer avant de fermer » : une réponse en cours serait
    // interrompue sans trace, d'où le réglage par défaut « si une réponse est
    // en cours ».
    const policy = options.closePolicy()
    const busy = options.busy()
    if (policy === 'always' || (policy === 'busy' && busy)) {
      const choice = dialog.showMessageBoxSync(browserOwner, {
        type: 'question',
        buttons: ['Fermer', 'Annuler'],
        defaultId: 1,
        cancelId: 1,
        title: options.product,
        message: busy ? 'Une réponse est en cours. Fermer quand même ?' : `Fermer ${options.product} ?`,
        detail: busy ? 'Le tour en cours sera interrompu. Les conversations restent enregistrées.' : 'Les conversations restent enregistrées.',
      })
      if (choice !== 0) { event.preventDefault(); return }
    }
    options.closeSurfaces(browserOwner)
  })
  window.webContents.on('did-start-loading', () => options.closeSurfaces(browserOwner))
  window.webContents.on('render-process-gone', () => options.closeSurfaces(browserOwner))
  void window.loadFile(join(options.dist, 'renderer', 'index.html'))
  return window
}
