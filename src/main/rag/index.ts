/**
 * Corpus documentaires (RAG).
 *
 * Un corpus = un dossier indexé dans une base vectorielle, exposé au moteur
 * comme **serveur MCP**. C'est la couture prévue par le moteur pour ce genre
 * d'extension : le modèle voit des outils de recherche parmi les siens, et
 * décide seul quand les appeler. Rien n'est injecté d'office dans le contexte,
 * ce qui évite de payer le corpus à chaque tour.
 *
 * ## Ce qui vit où
 *
 *  - Les **définitions** (nom, dossier source, état) dans un fichier JSON des
 *    données applicatives.
 *  - Les **bases vectorielles**, une par corpus, à côté.
 *  - Un **environnement Python** partagé, créé à la première utilisation.
 *
 * Python est requis parce que l'encodage vectoriel n'a pas d'équivalent
 * utilisable côté Node : Chroma embarque un modèle ONNX qui fait le travail
 * sans dépendre de torch, mais il n'existe qu'en Python.
 */

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import treeKill from 'tree-kill'

export type Corpus = {
  id: string
  name: string
  /** Dossier indexé. */
  source: string
  /** Exposé au moteur ? Un corpus désactivé reste indexé. */
  enabled: boolean
  /**
   * Modèle d'encodage, vide pour celui qu'embarque Chroma.
   *
   * Le modèle par défaut pèse quelques dizaines de mégaoctets ; un modèle
   * `sentence-transformers` comme `BAAI/bge-m3` est bien meilleur en
   * multilingue mais entraîne torch, soit plusieurs gigaoctets.
   */
  embedding: string
  /** Dernière indexation, en millisecondes. */
  indexedAt: number | null
  documents: number
  chunks: number
}

export type IndexProgress =
  | { kind: 'setup'; message: string }
  | { kind: 'start'; files: number }
  | { kind: 'file'; path: string; position: number; total: number }
  | {
      kind: 'done'
      indexed: number
      skipped: number
      removed: number
      chunks: number
      total: number
      /** Extensions écartées faute d'être du texte, par nombre décroissant. */
      ignored: Record<string, number>
      /** Formats connus mais illisibles ici — bibliothèque absente, fichier abîmé. */
      unreadable: Record<string, number>
    }
  | { kind: 'error'; message: string }

/** Paquets nécessaires. `chromadb` entraîne son encodeur ONNX. */
const PACKAGES = ['chromadb>=0.5', 'pypdf>=4', 'python-docx>=1.1']

export class RagStore {
  private corpora: Corpus[] = []
  private loaded = false

  constructor(
    /** Dossier de données de l'application. */
    private readonly root: string,
    /** Chemins des scripts Python, résolus depuis le bundle. */
    private readonly scripts: { index: string; server: string },
  ) {}

  private get file(): string {
    return join(this.root, 'rags.json')
  }

  private get venv(): string {
    return join(this.root, 'rag-env')
  }

  /** Interpréteur de l'environnement dédié. */
  private get python(): string {
    return process.platform === 'win32'
      ? join(this.venv, 'Scripts', 'python.exe')
      : join(this.venv, 'bin', 'python')
  }

  private storeFor(id: string): string {
    return join(this.root, 'rag-stores', id)
  }

  async list(): Promise<Corpus[]> {
    if (!this.loaded) {
      try {
        this.corpora = JSON.parse(await readFile(this.file, 'utf8')) as Corpus[]
      } catch {
        this.corpora = []
      }
      this.loaded = true
    }
    return this.corpora
  }

  private async persist(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await writeFile(this.file, JSON.stringify(this.corpora, null, 2), 'utf8')
  }

  async create(name: string, source: string, embedding: string): Promise<Corpus> {
    await this.list()
    const corpus: Corpus = {
      id: randomUUID().slice(0, 8),
      name,
      source,
      // Désactivé à la création : un corpus non indexé exposerait des outils
      // qui ne rendraient rien, et le modèle conclurait que le corpus est vide.
      enabled: false,
      embedding,
      indexedAt: null,
      documents: 0,
      chunks: 0,
    }
    this.corpora.push(corpus)
    await this.persist()
    return corpus
  }

  async update(id: string, patch: Partial<Corpus>): Promise<void> {
    await this.list()
    const corpus = this.corpora.find(c => c.id === id)
    if (!corpus) return
    Object.assign(corpus, patch)
    await this.persist()
  }

  async remove(id: string): Promise<void> {
    await this.list()
    this.corpora = this.corpora.filter(c => c.id !== id)
    await this.persist()
    // La base suit la définition : la laisser occuperait plusieurs centaines de
    // mégaoctets pour un corpus que plus rien ne référence.
    await rm(this.storeFor(id), { recursive: true, force: true }).catch(() => {})
  }

  /**
   * L'environnement Python est-il prêt ?
   *
   * L'existence de l'interpréteur ne suffit pas : une installation de
   * dépendances interrompue laisse un environnement complet en apparence, dans
   * lequel `import chromadb` échoue. Le test réel est fait une fois puis
   * mémorisé — lancer un sous-processus Python à chaque affichage serait
   * disproportionné.
   */
  private verified: boolean | null = null

  get ready(): boolean {
    return this.verified === true
  }

  /** Vérifie réellement que les dépendances sont importables. */
  async check(signal?: AbortSignal): Promise<boolean> {
    signal?.throwIfAborted()
    if (this.verified !== null) return this.verified
    if (!existsSync(this.python)) {
      this.verified = false
      return false
    }
    const verified = await run(this.python, ['-c', 'import chromadb'], () => {}, signal)
    signal?.throwIfAborted(); this.verified = verified
    return this.verified
  }

  /**
   * Prépare l'environnement Python.
   *
   * Un environnement virtuel dédié plutôt que le Python du système : installer
   * Chroma dans l'installation globale de l'utilisateur est intrusif, et une
   * version de dépendance qui change sous ses pieds casserait autre chose que
   * cette application.
   */
  async prepare(onProgress: (progress: IndexProgress) => void, signal?: AbortSignal): Promise<boolean> {
    if (await this.check(signal)) return true

    const base = await findSystemPython(signal)
    if (!base) {
      onProgress({
        kind: 'error',
        message:
          "Python 3 est introuvable. L'indexation vectorielle en dépend : installez Python puis relancez la préparation.",
      })
      return false
    }

    await mkdir(this.root, { recursive: true })
    onProgress({ kind: 'setup', message: 'Création de l’environnement Python…' })
    const created = await run(base, ['-m', 'venv', this.venv], line =>
      onProgress({ kind: 'setup', message: line }),
      signal,
    )
    if (!created) {
      onProgress({ kind: 'error', message: "L'environnement Python n'a pas pu être créé." })
      return false
    }

    onProgress({
      kind: 'setup',
      message: 'Installation des dépendances (plusieurs minutes au premier lancement)…',
    })
    const installed = await run(
      this.python,
      ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', ...PACKAGES],
      line => onProgress({ kind: 'setup', message: line }),
      signal,
    )
    if (!installed) {
      onProgress({
        kind: 'error',
        message:
          "L'installation a échoué. Derrière un proxy d'entreprise, `pip` a souvent besoin d'un index configuré.",
      })
      return false
    }

    // Vérification franche plutôt que confiance dans le code de retour de
    // `pip` : c'est l'import qui compte, et c'est lui qui échouera plus tard si
    // on ne le teste pas maintenant.
    this.verified = null
    if (!(await this.check(signal))) {
      onProgress({
        kind: 'error',
        message:
          "Les dépendances se sont installées mais `import chromadb` échoue. L'environnement est peut-être incomplet : supprimez le dossier `rag-env` des données de l'application et relancez.",
      })
      return false
    }

    onProgress({ kind: 'setup', message: 'Environnement prêt.' })
    return true
  }

  /**
   * Indexe un corpus.
   *
   * Incrémental : seuls les fichiers nouveaux ou modifiés sont réencodés. Un
   * second passage sur un corpus inchangé ne coûte que la lecture des dates.
   */
  async index(
    id: string,
    onProgress: (progress: IndexProgress) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    signal?.throwIfAborted()
    const corpus = (await this.list()).find(c => c.id === id)
    if (!corpus) return

    if (!(await this.prepare(onProgress, signal))) return
    signal?.throwIfAborted()

    const store = this.storeFor(id)
    await mkdir(store, { recursive: true })

    const args = [
      this.scripts.index,
      '--source', corpus.source,
      '--store', store,
      '--collection', 'corpus',
      ...(corpus.embedding ? ['--embedding', corpus.embedding] : []),
    ]

    await new Promise<void>(resolve => {
      const child = spawn(this.python, args, { windowsHide: true })
      let buffered = ''
      let completed: Partial<Corpus> | undefined
      let done: IndexProgress | undefined
      const abort = () => {
        if (child.pid) treeKill(child.pid, 'SIGKILL', () => {})
        onProgress({ kind: 'error', message: 'Indexation annulée ou délai dépassé.' })
      }
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()

      child.stdout.on('data', chunk => {
        buffered += String(chunk)
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line) as Record<string, unknown>
            if (signal?.aborted) continue
            if (event.event === 'done') {
              completed = {
                indexedAt: Date.now(),
                documents: Number(event.indexed) + Number(event.skipped),
                chunks: Number(event.total_in_store),
              }
              done = {
                kind: 'done',
                indexed: Number(event.indexed),
                skipped: Number(event.skipped),
                removed: Number(event.removed),
                chunks: Number(event.chunks),
                total: Number(event.total_in_store),
                ignored: (event.ignored ?? {}) as Record<string, number>,
                unreadable: (event.unreadable ?? {}) as Record<string, number>,
              }
            } else if (event.event === 'start') {
              onProgress({ kind: 'start', files: Number(event.files) })
            } else if (event.event === 'file') {
              onProgress({
                kind: 'file',
                path: String(event.path),
                position: Number(event.position),
                total: Number(event.total),
              })
            } else if (event.event === 'error') {
              onProgress({ kind: 'error', message: String(event.message) })
            }
          } catch {
            // Ligne non structurée : trace de bibliothèque, sans intérêt ici.
          }
        }
      })

      child.stderr.on('data', chunk => {
        const text = String(chunk).trim()
        // Chroma et ONNX écrivent des avertissements sur la sortie d'erreur
        // sans que rien n'ait échoué : seuls les vrais échecs remontent.
        if (/error|traceback|exception/i.test(text)) {
          onProgress({ kind: 'error', message: text.slice(0, 500) })
        }
      })

      child.on('close', async code => {
        signal?.removeEventListener('abort', abort)
        if (!signal?.aborted) {
          if (code === 0 && completed && done) {
            try { await this.update(id, completed); onProgress(done) }
            catch { onProgress({ kind: 'error', message: 'L’état de l’index n’a pas pu être enregistré.' }) }
          } else onProgress({ kind: 'error', message: 'L’indexation ne s’est pas terminée correctement.' })
        }
        resolve()
      })
      child.on('error', error => {
        signal?.removeEventListener('abort', abort)
        onProgress({ kind: 'error', message: String(error) })
        resolve()
      })
    })
  }

  /**
   * Configuration MCP des corpus actifs.
   *
   * Rend `null` s'il n'y en a aucun : passer une configuration vide au moteur
   * lui ferait démarrer un client MCP pour rien.
   */
  async mcpConfig(): Promise<string | null> {
    const active = (await this.list()).filter(c => c.enabled && c.indexedAt !== null)
    if (active.length === 0 || !(await this.check())) return null

    const servers: Record<string, unknown> = {}
    for (const corpus of active) {
      // Le nom du serveur préfixe les outils vus par le modèle
      // Identité stable même après renommage ; deux noms identiques ne se remplacent pas.
      const key = `rag_${corpus.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36)}`
      servers[key] = {
        command: this.python,
        args: [
          this.scripts.server,
          '--store', this.storeFor(corpus.id),
          '--collection', 'corpus',
          '--label', corpus.name,
          ...(corpus.embedding ? ['--embedding', corpus.embedding] : []),
        ],
      }
    }
    return JSON.stringify({ mcpServers: servers })
  }
}

/** Premier Python 3 utilisable du système. */
async function findSystemPython(signal?: AbortSignal): Promise<string | null> {
  const candidates =
    process.platform === 'win32'
      ? ['py', 'python', 'python3']
      : ['python3', 'python']
  for (const candidate of candidates) {
    // `py -3` sous Windows évite l'alias du Microsoft Store, qui ouvre une
    // page de magasin au lieu de lancer un interpréteur.
    const args = candidate === 'py' ? ['-3', '--version'] : ['--version']
    signal?.throwIfAborted()
    if (await run(candidate, args, () => {}, signal)) {
      return candidate
    }
  }
  return null
}

function run(
  file: string,
  args: string[],
  onLine: (line: string) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  return new Promise(resolve => {
    const child = spawn(file, args, { windowsHide: true, shell: false })
    const abort = () => { if (child.pid) treeKill(child.pid, 'SIGKILL', () => {}) }
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
    const consume = (chunk: unknown) => {
      for (const line of String(chunk).split('\n')) {
        const trimmed = line.trim()
        if (trimmed) onLine(trimmed)
      }
    }
    child.stdout?.on('data', consume)
    child.stderr?.on('data', consume)
    child.on('close', code => { signal?.removeEventListener('abort', abort); resolve(code === 0 && !signal?.aborted) })
    child.on('error', () => { signal?.removeEventListener('abort', abort); resolve(false) })
  })
}
