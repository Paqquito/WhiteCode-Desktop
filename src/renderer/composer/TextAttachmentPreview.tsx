import * as React from 'react'
import type { Attachment } from '../../main/preload.js'
export function TextAttachmentPreview({ item, onClose }: { item: Extract<Attachment, {kind: 'text'}>; onClose: () => void }) {
  const ref = React.useRef<HTMLDialogElement>(null)
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); previous?.focus() }
  }, [])
  return <dialog ref={ref} className="dialog attachment-preview" aria-label={item.name} onCancel={event => { event.preventDefault(); onClose() }}>
    <h2>{item.name}</h2><p>{item.truncated ? 'Aperçu du texte tronqué qui sera envoyé.' : 'Contenu qui sera joint au prochain message.'}</p>
    <pre>{item.text}</pre><div className="dialog-actions"><button type="button" onClick={onClose}>Fermer l’aperçu</button></div>
  </dialog>
}
