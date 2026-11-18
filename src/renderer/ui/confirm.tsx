/**
 * Confirmation dans l'interface, à la place de `window.confirm()`.
 *
 * La boîte du système était grise, sans rapport avec l'application, et
 * libellait ses boutons « OK / Annuler » — parfois en anglais selon l'OS —
 * sans rappeler ce qu'on s'apprêtait à faire. Ici, le bouton porte le verbe
 * de l'action (« Supprimer la note », « Fermer sans enregistrer ») et une
 * action destructive est en rouge, avec le focus sur Annuler.
 *
 * `ask()` est impératif pour remplacer `confirm()` sans réorganiser l'état
 * des composants appelants : il monte son propre dialogue et rend une
 * promesse résolue par le choix.
 */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { Dialog } from './Dialog.js'

export type AskOptions = {
  title: string
  /** Détail facultatif ; les sauts de ligne sont conservés. */
  message?: string
  /** Verbe de l'action, jamais « OK ». */
  confirmLabel: string
  cancelLabel?: string
  /** Action destructive : bouton rouge, focus initial sur Annuler. */
  danger?: boolean
}

export function ask(options: AskOptions): Promise<boolean> {
  return new Promise(resolve => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let settled = false
    const done = (accepted: boolean) => {
      if (settled) return
      settled = true
      root.unmount()
      host.remove()
      resolve(accepted)
    }
    root.render(<ConfirmDialog {...options} onDone={done} />)
  })
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Annuler', danger = false, onDone }: AskOptions & { onDone: (accepted: boolean) => void }): React.ReactNode {
  const cancel = React.useRef<HTMLButtonElement>(null)
  const accept = React.useRef<HTMLButtonElement>(null)
  React.useEffect(() => { (danger ? cancel : accept).current?.focus() }, [danger])
  return (
    <Dialog
      title={title}
      size="sm"
      role="alertdialog"
      className="confirm-dialog"
      onClose={() => onDone(false)}
      footer={<>
        <button ref={cancel} type="button" className="ghost confirm-cancel" onClick={() => onDone(false)}>{cancelLabel}</button>
        <button ref={accept} type="button" className={danger ? 'danger confirm-accept' : 'primary confirm-accept'} onClick={() => onDone(true)}>{confirmLabel}</button>
      </>}
    >
      {message && <p className="confirm-message">{message}</p>}
    </Dialog>
  )
}
