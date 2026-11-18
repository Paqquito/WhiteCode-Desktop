import * as React from 'react'
import type { SurfaceSource, SurfaceState } from '../../shared/browser.js'
/** Native content follows its DOM slot, clipped to every scrolling ancestor.
 * Hide it behind dialogs/menus: native views otherwise cover HTML overlays. */
export function WebSurface({
  id,
  source,
  onState,
  hidden = false,
}: {
  id: string
  source: SurfaceSource
  onState?: (state: SurfaceState) => void
  hidden?: boolean
}): React.ReactNode {
  const slot = React.useRef<HTMLDivElement>(null)
  const callback = React.useRef(onState)
  callback.current = onState
  const [error, setError] = React.useState('')
  const hiddenRef = React.useRef(hidden)
  hiddenRef.current = hidden
  const sourceKey = JSON.stringify(source)
  React.useEffect(() => {
    let alive = true,
      last = '',
      frame = 0
    setError('')
    const unsubscribe = window.engine.onSurfaceState((state) => {
      if (state.id === id && alive) callback.current?.(state)
    })
    const sync = () => {
      const element = slot.current
      if (!element || !alive) return
      const rect = element.getBoundingClientRect()
      let left = rect.left,
        top = rect.top,
        right = rect.right,
        bottom = rect.bottom
      for (
        let parent = element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent)
        if (
          /auto|scroll|hidden|clip/.test(
            `${style.overflowX} ${style.overflowY}`,
          )
        ) {
          const clip = parent.getBoundingClientRect()
          left = Math.max(left, clip.left)
          right = Math.min(right, clip.right)
          top = Math.max(top, clip.top)
          bottom = Math.min(bottom, clip.bottom)
        }
      }
      left = Math.max(0, left)
      top = Math.max(0, top)
      right = Math.min(innerWidth, right)
      bottom = Math.min(innerHeight, bottom)
      const visible =
        !hiddenRef.current &&
        !document.hidden &&
        !document.querySelector('dialog[open], [role="menu"], .menu-popover') &&
        rect.width > 0 &&
        rect.height > 0
      const bounds = {
        x: left,
        y: top,
        width: Math.max(0, right - left),
        height: Math.max(0, bottom - top),
        visible: Boolean(visible),
      }
      const key = JSON.stringify(bounds)
      if (key !== last) {
        last = key
        void window.engine
          .surfaceBounds(id, bounds)
          .catch((e) => alive && setError(String(e)))
      }
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(sync)
    }
    const resize = new ResizeObserver(schedule)
    if (slot.current) resize.observe(slot.current)
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'class', 'style'],
      childList: true,
    })
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    void window.engine
      .surfaceOpen(id, JSON.parse(sourceKey))
      .then((state) => {
        if (alive) {
          callback.current?.(state)
          last = ''
          sync()
        }
      })
      .catch((e) => alive && setError(String(e)))
    return () => {
      alive = false
      unsubscribe()
      resize.disconnect()
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      void window.engine.surfaceClose(id).catch(() => {})
    }
  }, [id, sourceKey])
  return (
    <div ref={slot} className="web-surface" aria-label="Contenu du lecteur">
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
export function DocumentPreview({
  root,
  path,
  html,
  revision,
}: {
  root: string
  path: string
  html?: string
  revision?: string
}): React.ReactNode {
  const id = React.useMemo(() => crypto.randomUUID(), [root, path, revision])
  const [state, setState] = React.useState<SurfaceState | null>(null)
  React.useEffect(() => setState(null), [id])
  return (
    <div className="document-preview">
      <div className="reader-info">
        {!state || state.loading
          ? 'Préparation de l’aperçu…'
          : 'Aperçu en lecture seule'}
        {html !== undefined && ' · Scripts et ressources externes désactivés'}
      </div>
      {state?.downloads.map((item) => (
        <p key={item.id} className="reader-info" role="status">
          {item.name} ·{' '}
          {item.status === 'completed'
            ? 'Copie enregistrée'
            : item.status === 'progressing'
              ? 'Enregistrement de la copie…'
              : 'Enregistrement interrompu'}
        </p>
      ))}
      {state?.error && (
        <p className="file-error" role="alert">
          {state.error}
        </p>
      )}
      <WebSurface
        id={id}
        source={{
          kind: 'document',
          root,
          path,
          ...(html !== undefined ? { html } : {}),
        }}
        onState={setState}
        hidden={Boolean(state?.error)}
      />
    </div>
  )
}
