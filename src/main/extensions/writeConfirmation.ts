import { dialog } from 'electron'

/** Native confirmation for a connector write started from a panel, outside any conversation. */
export async function confirmConnectorWrite(tool: string, args: unknown): Promise<boolean> {
  const result = await dialog.showMessageBox({ type: 'question', title: 'Confirmer l’écriture',
    message: `Confirmer ${tool} avec votre compte ?`, detail: JSON.stringify(args, null, 2),
    buttons: ['Annuler', 'Confirmer'], defaultId: 0, cancelId: 0, noLink: true })
  return result.response === 1
}
