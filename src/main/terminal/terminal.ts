/**
 * Terminaux réels.
 *
 * Chaque terminal est un **pseudo-terminal** (`node-pty`), pas un
 * sous-processus à tuyaux. La différence est décisive : un programme
 * interactif — `git rebase -i`, un installeur, un `ssh` — teste s'il parle à
 * un terminal et se comporte différemment sinon. Sans PTY, pas de couleurs,
 * pas de redimensionnement, pas d'invite de saisie.
 *
 * `node-pty` livre des binaires N-API : ils fonctionnent sous Electron sans
 * recompilation, ce qui a été vérifié avant d'en dépendre.
 */

import type { WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { IPty } from 'node-pty'
import { spawn } from 'node-pty'
import type { RemoteTerminal } from '../../shared/terminal.js'

export type ShellChoice = 'system' | 'powershell' | 'pwsh' | 'cmd' | 'bash'

/** Premier exécutable trouvé dans le PATH, ou `null`. */
function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, name))) return join(dir, name)
  }
  return null
}

/**
 * Shell des terminaux locaux, selon la préférence et la plateforme.
 *
 * Un choix introuvable sur ce poste retombe sur le shell du système : un
 * terminal qui refuse de s'ouvrir parce qu'un réglage désigne un programme
 * absent ressemblerait à une panne, pas à une préférence.
 */
export function defaultShell(choice: ShellChoice = 'system'): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    if (choice === 'powershell') return { file: 'powershell.exe', args: ['-NoLogo'] }
    if (choice === 'pwsh') { const pwsh = onPath('pwsh.exe'); if (pwsh) return { file: pwsh, args: ['-NoLogo'] } }
    if (choice === 'cmd') return { file: 'cmd.exe', args: [] }
    if (choice === 'bash') {
      const git = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]
        .filter((dir): dir is string => Boolean(dir)).map(dir => join(dir, 'Git', 'bin', 'bash.exe')).find(existsSync)
      if (git) return { file: git, args: ['--login', '-i'] }
    }
    return { file: process.env.COMSPEC ?? 'powershell.exe', args: [] }
  }
  if (choice === 'pwsh') { const pwsh = onPath('pwsh'); if (pwsh) return { file: pwsh, args: ['-NoLogo'] } }
  if (choice === 'bash' && existsSync('/bin/bash')) return { file: '/bin/bash', args: ['-l'] }
  // `-l` charge le profil : sans lui, le PATH de l'utilisateur manque et la
  // moitié de ses outils sont introuvables.
  return { file: process.env.SHELL ?? '/bin/bash', args: ['-l'] }
}

type TerminalProcess = Pick<IPty, 'write' | 'resize' | 'kill' | 'onData' | 'onExit'>
type Session = {
  pty: TerminalProcess
  cwd: string
  /**
   * Cible distante, pour ne pas confondre deux terminaux du même dossier.
   *
   * Un shell local et une session `ssh` ouverts depuis le même projet
   * partagent leur `cwd` : sans cette marque, rouvrir le panneau pourrait
   * rattacher l'un à la place de l'autre.
   */
  remoteKey?: string
  /** Sortie déjà émise, rejouée quand le panneau est rouvert. */
  scrollback: string
}

/** Identité d'une cible distante, stable entre deux ouvertures du panneau. */
function remoteKeyOf(remote?: RemoteTerminal): string | undefined {
  return remote?.key
}

const SCROLLBACK_LIMIT = 256 * 1024

export class Terminals {
  private readonly sessions = new Map<string, Session>()
  get workingDirectories(): string[] { return [...this.sessions.values()].map(s => s.cwd) }

  constructor(
    private readonly target: () => WebContents | null,
    private readonly spawnPty: (...args: Parameters<typeof spawn>) => TerminalProcess = spawn,
    /** Lu à chaque ouverture : un changement de préférence vaut pour le terminal suivant. */
    private readonly shell: () => ShellChoice = () => 'system',
  ) {}

  /**
   * Ouvre un terminal et rend son identifiant.
   *
   * Les dimensions viennent du rendu : lui seul connaît la taille réelle de
   * la zone d'affichage, et un PTY mal dimensionné coupe les lignes au
   * mauvais endroit.
   */
  create(
    cwd: string,
    cols: number,
    rows: number,
    /**
     * Session distante, ou `undefined` pour un shell local.
     *
     * Le distant passe par le client `ssh` du système dans le même
     * pseudo-terminal : on obtient un vrai shell sur le serveur, avec les
     * couleurs, le redimensionnement et les programmes interactifs — et sans
     * que l'application ait à connaître le moindre secret.
     */
    remote?: RemoteTerminal,
  ): string {
    const id = randomUUID()
    const { file, args } = remote ?? defaultShell(this.shell())

    const pty = this.spawnPty(file, args, {
      name: 'xterm-256color',
      cols: Math.max(cols, 20),
      rows: Math.max(rows, 5),
      // Le répertoire local n'a pas de sens à distance : `ssh` ouvrirait le
      // shell dans le dossier personnel du compte distant de toute façon, mais
      // un chemin Windows inexistant ferait échouer le lancement ici.
      cwd: remote ? undefined : cwd,
      env: {
        ...process.env,
        // Sans ceci, les outils qui se fient à TERM restent en mode dégradé.
        TERM: 'xterm-256color',
        // Beaucoup de CLI colorent conditionnellement : on le dit clairement.
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    })

    const session: Session = { pty, cwd, remoteKey: remoteKeyOf(remote), scrollback: '' }
    this.sessions.set(id, session)

    pty.onData(data => {
      session.scrollback = (session.scrollback + data).slice(-SCROLLBACK_LIMIT)
      this.target()?.send('terminal:data', { id, data })
    })

    pty.onExit(({ exitCode }) => {
      this.sessions.delete(id)
      this.target()?.send('terminal:exit', { id, exitCode })
    })

    return id
  }

  /**
   * Terminal déjà ouvert pour ce dossier et cette cible, s'il en existe un.
   *
   * C'est ce qui permet de **fermer la vue sans tuer le shell** : le panneau
   * se rattache à la session laissée en vie et rejoue sa sortie. Le champ
   * `scrollback` existait pour cela depuis l'origine — il était alimenté mais
   * jamais relu, le rendu tuant le processus au démontage (constat D07 de
   * l'audit du 14 septembre 2026).
   */
  find(cwd: string, remote?: RemoteTerminal): { id: string; scrollback: string } | null {
    const key = remoteKeyOf(remote)
    for (const [id, session] of this.sessions) {
      if (session.remoteKey === key && session.cwd === cwd) {
        return { id, scrollback: session.scrollback }
      }
    }
    return null
  }

  /** Transmet la frappe de l'utilisateur au shell. */
  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  /**
   * Ajuste les dimensions.
   *
   * À appeler à chaque redimensionnement du panneau : c'est ce qui permet aux
   * programmes plein écran de se redessiner correctement.
   */
  resize(id: string, cols: number, rows: number): void {
    try {
      this.sessions.get(id)?.pty.resize(Math.max(cols, 20), Math.max(rows, 5))
    } catch {
      // Le PTY vient de se terminer : le redimensionnement n'a plus d'objet.
    }
  }

  /** Sortie déjà produite, pour réafficher un terminal rouvert. */
  scrollback(id: string): string {
    return this.sessions.get(id)?.scrollback ?? ''
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    try {
      session.pty.kill()
    } catch {
      // Déjà mort.
    }
  }

  /** Ferme tout : appelé à la fermeture de la fenêtre. */
  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
