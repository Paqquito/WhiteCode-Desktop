/**
 * Dernière modalité de saisie : clavier ou pointeur.
 *
 * Un menu ou un dialogue place le focus sur son premier élément à
 * l'ouverture — c'est ce qui permet de continuer au clavier. Mais ouvert à la
 * souris, l'anneau de focus sur cet élément se lit comme une sélection que
 * l'utilisateur n'a pas faite. `focusInside` place le focus dans les deux
 * cas, et ne le montre que si l'ouverture venait du clavier.
 */

let keyboard = true

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => { keyboard = false }, true)
  window.addEventListener('keydown', event => {
    // Une touche de modification seule (Maj, Ctrl…) ne dit rien de l'intention.
    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) keyboard = true
  }, true)
}

export function focusInside(element: HTMLElement | null | undefined, options: { preventScroll?: boolean } = {}): void {
  // `focusVisible` est reconnu par Chromium (donc Electron) ; ailleurs, il est
  // ignoré et le navigateur applique sa propre règle.
  element?.focus({ ...options, focusVisible: keyboard } as FocusOptions)
}
