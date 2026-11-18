/**
 * Terminal intégré.
 *
 * Un vrai shell, dans un vrai pseudo-terminal : couleurs, redimensionnement,
 * programmes interactifs. `xterm.js` fait l'affichage et l'interprétation des
 * séquences ANSI, le processus principal tient le PTY.
 *
 * Deux détails conditionnent le fait qu'on puisse **taper** dedans :
 *
 *  - xterm ne lit le clavier que par une zone de saisie invisible, qui doit
 *    avoir le focus. Le clic n'importe où dans le panneau le lui redonne.
 *  - la mise en forme d'xterm est construite à l'exécution dans des balises
 *    `<style>`. La politique de sécurité du rendu doit l'autoriser, sinon le
 *    terminal s'affiche en police proportionnelle, sans curseur, et paraît
 *    inerte alors qu'il fonctionne. Voir le commentaire de `index.html`.
 */

import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import * as React from 'react'
import type { TerminalTarget } from '../../main/preload.js'
import { IconButton } from '../ui/IconButton.js'
import { Menu, type MenuOption } from '../ui/Menu.js'
import { Panel } from '../ui/Panel.js'
import { usePreferences } from '../state/usePreferences.js'
import type { Preferences } from '../../shared/preferences.js'

/** Couleurs alignées sur le thème clair de l'application. */
const THEME = {
  background: '#ffffff',
  foreground: '#141414',
  cursor: '#111111',
  cursorAccent: '#ffffff',
  selectionBackground: '#d9d9d9',
  black: '#141414',
  red: '#414141',
  green: '#383838',
  yellow: '#555555',
  blue: '#555555',
  magenta: '#555555',
  cyan: '#555555',
  white: '#d0d0d0',
  brightBlack: '#6b6b6b',
  brightRed: '#555555',
  brightGreen: '#555555',
  brightYellow: '#555555',
  brightBlue: '#555555',
  brightMagenta: '#555555',
  brightCyan: '#555555',
  brightWhite: '#141414',
}

export function TerminalPanel({
  cwd,
  onClose,
}: {
  cwd: string
  onClose: () => void
}): React.ReactNode {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const termRef = React.useRef<Terminal | null>(null)
  // Le shell vient de la préférence lue à l'ouverture ; un shell absent du
  // poste est remplacé par celui du système, ce que l'en-tête ne peut pas
  // savoir — d'où « préférence » dans l'infobulle des paramètres.
  const shell = usePreferences().value.terminalShell
  /**
   * Shell couramment affiché.
   *
   * Hors de l'effet : depuis que la fermeture du panneau ne tue plus rien, les
   * deux seules actions qui arrêtent un processus — « Arrêter » et le
   * redémarrage — ont besoin de le désigner.
   */
  const lifecycle = React.useRef(0)
  const ptyRef = React.useRef<string | null>(null)
  const [exited, setExited] = React.useState<number | null>(null)
  const [failure, setFailure] = React.useState<string | null>(null)
  const [transitioning, setTransitioning] = React.useState(false)
  const [ready, setReady] = React.useState(false)
  const [generation, setGeneration] = React.useState(0)

  /**
   * Cible du shell : `null` pour la machine locale.
   *
   * Le fournisseur de la distribution expose ses cibles sans options de
   * lancement. Une distribution sans cible conserve le terminal local.
   */
  const [sessions, setSessions] = React.useState<TerminalTarget[]>([])
  const [remote, setRemote] = React.useState<TerminalTarget | null>(null)

  React.useEffect(() => {
    void window.engine.terminalTargets().then(state => {
      setSessions(state.targets)
    }).catch(() => {})
  }, [])

  React.useEffect(() => {
    const host = hostRef.current
    if (!host || !cwd) return

    lifecycle.current++
    setTransitioning(false)
    setReady(false)
    setExited(null)
    setFailure(null)
    ptyRef.current = null
    let disposed = false
    let ptyId: string | null = null

    const term = new Terminal({
      fontFamily:
        'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      theme: THEME,
      cursorBlink: true,
      // Le défilement natif du panneau ne peut pas remonter dans un écran
      // alternatif : xterm doit gérer son propre historique.
      scrollback: 5000,
      allowProposedApi: true,
    })
    termRef.current = term
    const fit = new FitAddon()
    const applyAppearance = () => {
      const css = getComputedStyle(document.documentElement)
      const color = (name: string) => css.getPropertyValue(name).trim()
      term.options.theme = { ...THEME, background: color('--bg') || THEME.background, foreground: color('--text') || THEME.foreground, cursor: color('--accent') || THEME.cursor, selectionBackground: color('--accent-soft') || THEME.selectionBackground, black: color('--text'), brightWhite: color('--text'), brightBlack: color('--text-muted'), green: color('--text-muted'), red: color('--text'), yellow: color('--text-muted'), cyan: color('--text-muted'), blue: color('--text'), magenta: color('--text'), brightGreen: color('--text'), brightRed: color('--text'), brightYellow: color('--text'), brightCyan: color('--text'), brightBlue: color('--text'), brightMagenta: color('--text') }
      term.options.fontFamily = color('--mono') || 'monospace'
      term.options.fontSize = parseFloat(color('--code-size')) || 12
      try { fit.fit() } catch {}
      if (ptyId) void window.engine.resizeTerminal(ptyId, term.cols, term.rows)
    }
    const appearanceObserver = new MutationObserver(applyAppearance)
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    applyAppearance()
    appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'data-theme'] })

    const offData = window.engine.onTerminalData(payload => {
      if (payload.id === ptyId) term.write(payload.data)
    })
    const offExit = window.engine.onTerminalExit(payload => {
      if (payload.id === ptyId && !disposed) setExited(payload.exitCode)
    })

    // Rattachement d'abord, création ensuite. Un shell laissé en vie par une
    // fermeture de panneau est retrouvé avec sa sortie ; sans cette reprise,
    // rouvrir le terminal donnerait un écran vide sur un processus qui,
    // pourtant, continue de tourner.
    void window.engine
      .attachTerminal(cwd, remote?.id)
      .then(async existant => {
        if (disposed) return null
        if (existant) {
          term.write(existant.scrollback)
          return existant.id
        }
        return window.engine.createTerminal(cwd, term.cols, term.rows, remote?.id)
      })
      .then(id => {
        if (disposed || !id) {
          // Le panneau a disparu pendant l'ouverture. Ne pas tuer : ce shell
          // est désormais rattachable, et le tuer ici rétablirait le défaut
          // que cette reprise corrige.
          return
        }
        ptyId = id
        ptyRef.current = id
        setReady(true)
        void window.engine.resizeTerminal(id, term.cols, term.rows)
        term.focus()
      })
      // Sans ce rattrapage, l'échec est muet : le panneau afficherait un cadre
      // vide où la frappe ne produit rien, sans dire pourquoi.
      .catch((error: unknown) => {
        if (!disposed) setFailure(String(error))
      })

    term.onData(data => {
      if (ptyId) void window.engine.writeTerminal(ptyId, data)
    })

    // Le PTY doit connaître les dimensions réelles, sinon les programmes
    // plein écran se dessinent de travers. Déclenché aussi par la poignée de
    // hauteur du panneau, qui redimensionne l'hôte.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // Panneau replié : rien à ajuster.
      }
      if (ptyId) void window.engine.resizeTerminal(ptyId, term.cols, term.rows)
    })
    observer.observe(host)

    return () => {
      // Détachement, pas arrêt. Fermer un panneau ressemble à fermer une vue ;
      // c'en est une. Le shell survit avec ce qui y tourne — un build, un
      // serveur, une session `ssh` — et se retrouve à la réouverture. L'arrêt
      // reste possible, mais il se demande explicitement (bouton « Arrêter »).
      lifecycle.current++
      disposed = true
      observer.disconnect()
      appearanceObserver.disconnect()
      offData()
      offExit()
      term.dispose()
      termRef.current = null
    }
    // `remote` fait partie des dépendances : changer de cible réaffiche le
    // shell de cette cible, ou en ouvre un s'il n'y en a pas.
  }, [cwd, generation, remote])

  /** Arrête le shell affiché, s'il en reste un. */
  const stop = async (): Promise<void> => {
    const id = ptyRef.current
    if (id) await window.engine.killTerminal(id)
    if (ptyRef.current === id) {
      ptyRef.current = null
      setReady(false)
      setExited(0)
    }
  }
  const changeShell = async (restart: boolean) => {
    if (transitioning) return
    const owner = lifecycle.current
    setTransitioning(true)
    try {
      await stop()
      if (owner !== lifecycle.current) return
      if (restart) { setExited(null); setFailure(null); setGeneration(g => g + 1) }
    } catch (error) { if (owner === lifecycle.current) setFailure(String(error)) }
    finally { if (owner === lifecycle.current) setTransitioning(false) }
  }

  const folder = cwd.split(/[\/]/).filter(Boolean).pop() ?? cwd
  return (
    <Panel
      title="Terminal"
      subtitle={remote ? remote.description : `${SHELL_LABELS[shell]}, ${folder}`}
      icon="terminal"
      onClose={onClose}
      padded={false}
      scroll={false}
      actions={
        <>
          {sessions.length > 0 && (
            <span className="terminal-target-picker">
              <Menu
                label={remote ? remote.label : 'Local'}
                icon={remote ? 'branch' : 'terminal'}
                title="Machine sur laquelle ouvrir le shell"
                align="right"
                value={remote?.id ?? null}
                options={targetOptions(sessions)}
                onChange={id => {
                  setRemote(sessions.find(s => s.id === id) ?? null)
                  setExited(null)
                  setFailure(null)
                }}
              />
            </span>
          )}
          {/* Fermer le panneau masque la vue ; ce bouton-ci arrête le
              processus. La distinction est le sujet même du constat D07 : le
              seul bouton disponible tuait un shell qui pouvait porter un build
              ou un serveur, sous une icône qui annonçait une fermeture. */}
          <IconButton icon="stop" size={14} onClick={() => void changeShell(false)} disabled={!ready || exited !== null || transitioning} title="Arrêter le shell et ce qui y tourne" label="Arrêter le terminal" />
          <IconButton icon="refresh" size={14} onClick={() => void changeShell(true)} disabled={transitioning || (!ready && !failure && exited === null)} title="Nouveau shell" label="Redémarrer le terminal" />
        </>
      }
    >
      {/* Le clic est rattrapé au niveau de l'hôte et pas seulement des lignes
          d'xterm : cliquer dans la marge, sous la dernière ligne, ou pendant
          que le shell redessine ne doit pas laisser le clavier ailleurs. */}
      <div
        className="terminal-host"
        ref={hostRef}
        onPointerDown={() => termRef.current?.focus()}
      />

      {!ready && !failure && exited === null && <div className="terminal-exited" role="status">Connexion au terminal…</div>}
      {failure && (
        <div className="terminal-exited error">
          Le shell n’a pas pu démarrer : {failure}
        </div>
      )}
      {exited !== null &&
        (remote ? (
          <div className="terminal-exited">
            Session {remote.label} terminée (code {exited}). Utilisez « Redémarrer le terminal » pour réessayer.
          </div>
        ) : (
          <div className="terminal-exited">
            Shell terminé (code {exited}). Utilisez ↻ pour en ouvrir un nouveau.
          </div>
        ))}
    </Panel>
  )
}

/**
 * Le libellé et la description viennent du fournisseur de cibles. La sélection
 * utilise son identifiant, car deux destinations peuvent porter le même nom.
 */
function targetOptions(sessions: TerminalTarget[]): Array<MenuOption<string | null>> {
  return [
    { id: null, label: 'Cette machine', hint: 'Shell local, dans le dossier de travail' },
    ...sessions.map(session => ({
      id: session.id,
      label: session.label,
      hint: session.description,
    })),
  ]
}

const SHELL_LABELS: Record<Preferences['terminalShell'], string> = {
  system: 'Shell du système', powershell: 'PowerShell', pwsh: 'PowerShell 7', cmd: 'Invite de commandes', bash: 'Bash',
}
