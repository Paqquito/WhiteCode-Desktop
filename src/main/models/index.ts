/**
 * Magasin de modèles locaux et serveur d'inférence.
 *
 * ## Deux choses, un seul endroit
 *
 * Les poids et le programme qui les exécute sont téléchargés par le même
 * mécanisme, parce que du point de vue de l'utilisateur c'est une seule
 * attente : « installer un modèle ». Séparer les deux l'obligerait à
 * comprendre que `llama-server` existe avant de pouvoir s'en servir.
 *
 * ## Emplacement
 *
 * Les modèles pèsent des dizaines de gigaoctets ; les mettre dans le profil
 * utilisateur remplit le disque système, ce qui est précisément ce qui est
 * arrivé avec Ollama. Le dossier est donc choisi, conservé, et par défaut hors
 * du disque système.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createWriteStream, existsSync } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { cpus, homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { CATALOG, huggingFaceUrl } from '../../shared/modelCatalog.js'
import type { QuantOption } from './huggingface.js'

export { CATALOG, type CatalogEntry } from '../../shared/modelCatalog.js'
export { resolveRepo } from './huggingface.js'
export type {
  GgufFile,
  QuantOption,
  ResolvedRepo,
  ResolveResult,
} from './huggingface.js'

/** Progression d'un téléchargement — poids comme programme. */
export type ModelProgress = {
  id: string
  status: string
  /** Fraction téléchargée, ou `null` quand l'étape n'est pas mesurable. */
  ratio: number | null
  done: boolean
  failed: boolean
}

/** Un fichier de poids présent sur le disque. */
export type InstalledModel = {
  /** Encodeur visuel disponible avec ce modèle, si le registre le connaît. */
  vision?: boolean
  id: string
  label: string
  file: string
  bytes: number
  context: number
  tools: boolean
}

export type RuntimeBackend = 'cpu' | 'vulkan'

/**
 * Un modèle installé depuis un dépôt collé, hors catalogue.
 *
 * Sans cette description, un modèle installé disparaîtrait de l'interface au
 * redémarrage : le dossier dirait qu'un `.gguf` est là, mais rien ne dirait
 * d'où il vient, quelles tranches l'accompagnent, ni quel projecteur il exige.
 */
export type CustomModel = {
  id: string
  label: string
  /** Dépôt d'origine, pour pouvoir y retourner. */
  repo: string
  /** Nom du fichier principal dans le dossier des modèles. */
  file: string
  /** Tranches suivantes d'un modèle découpé, présentes à côté. */
  shards: string[]
  /** Projecteur visuel, renommé à l'installation. */
  mmproj: string | null
  /** Somme téléchargée, tranches et projecteur compris. */
  bytes: number
  /**
   * Contexte d'entraînement, quand il est connu.
   *
   * Hugging Face ne le publie pas dans l'arborescence : pour un modèle collé,
   * il reste absent et c'est le réglage de l'utilisateur qui fait foi.
   */
  context?: number
}

export type ModelsConfig = {
  root: string
  backend: RuntimeBackend
  /** Modèle servi en dernier, repris tel quel au démarrage suivant. */
  serving?: string
  port: number
  /**
   * Fenêtre de contexte, en jetons.
   *
   * Le seul réglage de performance qui reste : llama.cpp en déduit lui-même
   * combien de couches il peut confier à la carte. Voir {@link serverArgs}.
   */
  context: number
  /** Modèles installés hors catalogue. Voir {@link CustomModel}. */
  custom: CustomModel[]
}

/**
 * Ce qu'il faut savoir pour lancer un identifiant, quelle qu'en soit l'origine.
 *
 * Catalogue et registre répondent à la même question ; tout le fichier passe
 * par cette vue plutôt que par `CATALOG`, sans quoi un modèle collé serait
 * introuvable au lancement, à la suppression et dans l'inventaire.
 */
type ModelSource = {
  id: string
  label: string
  file: string
  shards: string[]
  mmproj: string | null
  bytes: number
  context: number
  tools: boolean
}

/**
 * Réflexion du modèle, telle que l'accepte `--reasoning` de `llama-server`.
 *
 * C'est le **seul** levier qui agit sur le raisonnement d'un modèle local :
 * vérifié le 5 sept., ni `output_config.effort` (ce que le moteur envoie), ni
 * `reasoning_effort`, ni le champ `thinking` d'Anthropic ne sont honorés par
 * `llama-server`. Seul `--reasoning off` coupe réellement le bloc `<think>`.
 * Posé au lancement, donc un changement relance le serveur.
 */
export type ReasoningMode = 'auto' | 'off'

export type ServerStatus = {
  running: boolean
  model: string | null
  port: number
  /** Réflexion active au lancement, pour détecter un changement à propager. */
  reasoning: ReasoningMode | null
  /** Dernières lignes de `llama-server`, pour rendre un échec lisible. */
  log: string[]
}

/**
 * Emplacement par défaut des modèles.
 *
 * Sous Windows on vise un disque de données : le disque système d'un poste de
 * travail est petit, et un seul modèle suffit à le saturer.
 */
function defaultRoot(): string {
  if (process.platform === 'win32') return 'E:\\users\\LLM\\models'
  return join(homedir(), 'LLM', 'models')
}

/**
 * Plancher du contexte.
 *
 * L'invite du moteur pèse à elle seule plus de 15 000 jetons : en dessous de ce
 * plancher, la conversation est refusée dès le premier tour
 * (`exceeds the available context size`).
 */
const CONTEXT_FLOOR = 32768

const DEFAULTS: ModelsConfig = {
  root: defaultRoot(),
  backend: 'cpu',
  port: 8080,
  // Le plancher, pas le plafond : c'est la valeur qui démarre partout, y
  // compris sur un poste sans carte. Monter se fait dans les réglages, et sur
  // ce poste 262 k tient (voir {@link serverArgs}).
  context: CONTEXT_FLOOR,
  custom: [],
}

/** Version de llama.cpp employée. Figée : une mise à jour se décide. */
const LLAMA_BUILD = 'b10785'

/**
 * Ligne de commande de `llama-server`.
 *
 * Sortie de la classe pour être vérifiable : c'est ici que se décide le
 * contexte, et une erreur ne se voit qu'au premier tour refusé, une fois le
 * modèle chargé et les minutes passées.
 */
export function serverArgs(options: {
  config: ModelsConfig
  model: { file: string; context: number }
  mmproj: string | null
  reasoning: ReasoningMode
}): string[] {
  const { config, model, mmproj, reasoning } = options
  const args = [
    '--model',
    join(config.root, model.file),
    '--host',
    '127.0.0.1',
    '--port',
    String(config.port),
    // Un seul emplacement de conversation. `--ctx-size` est le contexte
    // **total**, que llama.cpp répartit entre les emplacements : avec
    // `--parallel 4`, une demande de 32768 devient 8192 par requête, et le
    // moteur — dont l'invite dépasse 16000 jetons — est refusé sans que rien
    // n'indique d'où vient la division.
    '--parallel',
    '1',
    // Un fil par cœur physique. Au delà, les fils se disputent le cache et le
    // débit baisse au lieu de monter.
    '--threads',
    String(Math.max(1, Math.floor(cpus().length / 2))),
    // Indispensable : sans le gabarit Jinja du modèle, `llama-server` n'émet
    // pas d'appels d'outils et le moteur ne peut rien faire.
    '--jinja',
    // Cache d'attention en q8_0 plutôt qu'en f16 : à contexte égal il pèse
    // moitié moins, donc à mémoire égale le contexte double — sur ce 27B,
    // 131 k jetons passent de 8,3 Go à 4,5 Go (mesuré, `llama-fit-params`).
    // La perte de qualité est de l'ordre du bruit ; la moitié du contexte,
    // non.
    '--cache-type-k',
    'q8_0',
    '--cache-type-v',
    'q8_0',
    '--cont-batching',
    // Réflexion du modèle. `off` coupe le bloc `<think>` (réponse directe,
    // plus rapide) ; `auto` laisse le gabarit décider. Seul levier qui agit
    // sur un modèle local — voir ReasoningMode.
    '--reasoning',
    reasoning,
  ]

  // Le contexte voulu, et rien d'autre : ni `--ctx-size`, ni `--n-gpu-layers`.
  //
  // `--fit`, actif par défaut depuis b10785, lit la mémoire réellement libre et
  // répartit les couches entre la carte et le processeur pour tenir la valeur
  // donnée ici. Il ne le fait que sur les arguments **absents** — avec `-ngl`
  // imposé il abandonne (« n_gpu_layers already set by user, abort ») et le
  // contexte retombe au défaut, ce qui est exactement la panne qu'on répare.
  //
  // Mesuré sur ce poste (27B Q4_K_M, RTX 4070 12 Go, invite de 8 383 jetons) :
  // 32 k → 307 jetons/s en lecture d'invite et 5,4 en génération ; 131 k → 306
  // et 5,2 ; 262 k → 276 et 4,6. Le contexte long ne se paie donc presque pas :
  // la carte est déjà pleine dans les trois cas, `--fit` déplace simplement
  // quelques couches de plus vers le processeur.
  //
  // Borné par le contexte d'entraînement quand on le connaît — au delà,
  // llama.cpp étire les positions et la qualité se dégrade en silence. Un
  // modèle collé ne le publie pas : c'est alors le réglage qui fait foi.
  const trained = model.context > 0 ? model.context : config.context
  args.push(
    '--fit-ctx',
    String(Math.max(CONTEXT_FLOOR, Math.min(config.context, trained))),
  )

  if (mmproj) args.push('--mmproj', join(config.root, mmproj))
  return args
}

/**
 * Archive llama.cpp correspondant à la plateforme et au dos choisi.
 *
 * Pas de variante CUDA : elle exige un pilote plus récent que celui installé
 * ici, et échouerait au lancement sans dire pourquoi. Vulkan couvre les cartes
 * NVIDIA et AMD avec le pilote d'origine.
 */
function runtimeAsset(backend: RuntimeBackend): string {
  if (process.platform === 'win32') {
    return `llama-${LLAMA_BUILD}-bin-win-${backend}-x64.zip`
  }
  const suffix = backend === 'vulkan' ? 'vulkan-x64' : 'x64'
  return `llama-${LLAMA_BUILD}-bin-ubuntu-${suffix}.tar.gz`
}

export class LocalModels {
  private config: ModelsConfig = DEFAULTS
  private server: ChildProcess | null = null
  private serving: string | null = null
  /** Réflexion du serveur en cours, pour comparer et relancer si elle change. */
  private servingReasoning: ReasoningMode | null = null
  private log: string[] = []
  /** Un contrôleur par téléchargement, pour pouvoir l'annuler. */
  private readonly running = new Map<string, AbortController>()

  constructor(private readonly stateDir: string) {}

  private get file(): string {
    return join(this.stateDir, 'models.json')
  }

  /** Le programme d'inférence vit à côté des poids, pas dans le profil. */
  private get runtimeDir(): string {
    return join(dirname(this.config.root), 'runtime', this.config.backend)
  }

  private get serverBinary(): string {
    // La disposition des archives llama.cpp a changé : les builds récents
    // (b10785 vérifié) déposent leurs binaires **à plat** dans un dossier
    // `llama-<build>/`, là où les anciens rangeaient sous `build/bin` (Linux)
    // ou à la racine (Windows). On essaie les dispositions connues et on garde
    // la première qui existe ; avant tout téléchargement, aucune n'existe et
    // l'on rend la disposition actuelle, celle que l'extraction produira.
    //
    // Les bibliothèques `.so`/`.dll` voisines se résolvent seules : le binaire
    // porte un RUNPATH `$ORIGIN`, il les trouve dans son propre dossier sans
    // qu'on ait à poser de variable d'environnement.
    const exe = process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'
    const candidates = [
      join(this.runtimeDir, `llama-${LLAMA_BUILD}`, exe),
      join(this.runtimeDir, 'build', 'bin', exe),
      join(this.runtimeDir, exe),
    ]
    return candidates.find(path => existsSync(path)) ?? candidates[0]!
  }

  async load(): Promise<ModelsConfig> {
    try {
      const parsed = JSON.parse(
        await readFile(this.file, 'utf8'),
      ) as Partial<ModelsConfig>
      this.config = { ...DEFAULTS, ...parsed }
      // Un contexte enregistré sous le plancher ne peut rien servir : l'invite
      // du moteur ne tient pas dedans et le premier tour repart en « exceeds
      // the available context size ». On le remonte plutôt que de laisser
      // l'utilisateur découvrir la panne — et pour que le sélecteur des
      // réglages affiche une valeur qu'il propose encore.
      this.config.context = Math.max(this.config.context, CONTEXT_FLOOR)
    } catch {
      // Absent : les défauts font l'affaire.
    }
    return this.config
  }

  get current(): ModelsConfig {
    return this.config
  }

  async set(next: Partial<ModelsConfig>): Promise<ModelsConfig> {
    this.config = { ...this.config, ...next }
    try {
      await mkdir(this.stateDir, { recursive: true })
      await writeFile(this.file, JSON.stringify(this.config, null, 2), 'utf8')
    } catch {
      // Le choix vaut pour la session en cours.
    }
    return this.config
  }

  /**
   * Catalogue et registre confondus, sous une seule forme.
   *
   * Recalculé à la lecture : le registre change à chaque installation, et une
   * copie mémorisée finirait par décrire l'état d'avant.
   */
  private get sources(): ModelSource[] {
    return [
      ...CATALOG.map(entry => ({
        id: entry.id,
        label: entry.label,
        file: entry.file,
        shards: [],
        mmproj: entry.mmproj ?? null,
        bytes: entry.bytes + (entry.mmprojBytes ?? 0),
        context: entry.context,
        tools: entry.tools,
      })),
      ...this.config.custom.map(model => ({
        id: model.id,
        label: model.label,
        file: model.file,
        shards: model.shards,
        mmproj: model.mmproj,
        bytes: model.bytes,
        // Contexte inconnu : celui des réglages, que l'utilisateur maîtrise.
        // Le borner par une valeur inventée ferait échouer un modèle capable
        // de plus, ou en promettrait plus qu'il ne peut.
        context: model.context ?? this.config.context,
        // Rien dans un dépôt ne dit si le modèle sait appeler des outils. On
        // suppose que oui : c'est le cas de tout ce qu'on installe ici, et
        // l'inverse se voit au premier tour.
        tools: true,
      })),
    ]
  }

  /**
   * Poids présents sur le disque.
   *
   * On lit le dossier plutôt que de tenir un inventaire : un fichier déposé à
   * la main doit apparaître, et un fichier effacé disparaître, sans qu'on ait
   * à tenir les deux en accord. Le registre ne sert qu'à *nommer* ce qui est
   * trouvé, jamais à décider de sa présence.
   */
  async installed(): Promise<InstalledModel[]> {
    let names: string[]
    try {
      names = await readdir(this.config.root)
    } catch {
      return []
    }

    const known = this.sources
    const models: InstalledModel[] = []
    for (const name of names) {
      // Le projecteur multimodal accompagne un modèle, il n'en est pas un.
      if (!name.endsWith('.gguf') || name.startsWith('mmproj')) continue
      // Les tranches suivantes d'un modèle découpé non plus : `llama-server`
      // ne reçoit que la première et trouve les autres à côté. Les lister
      // donnerait quatre modèles là où il n'y en a qu'un.
      if (/-\d{5}-of-\d{5}\.gguf$/i.test(name) && !/-00001-of-\d{5}\.gguf$/i.test(name)) {
        continue
      }
      const entry = known.find(candidate => candidate.file === name)
      let bytes = entry?.bytes ?? 0
      // Un modèle découpé : la taille annoncée est celle de l'ensemble, et
      // non celle de la première tranche.
      if (!entry?.shards.length) {
        try {
          bytes = (await stat(join(this.config.root, name))).size
        } catch {
          // Disparu entre la lecture du dossier et celle du fichier.
        }
      }
      models.push({
        id: entry?.id ?? name.replace(/\.gguf$/, ''),
        label: entry?.label ?? name.replace(/\.gguf$/, ''),
        file: name,
        bytes,
        context: entry?.context ?? 32768,
        tools: entry?.tools ?? true,
        vision: entry ? Boolean(entry.mmproj && names.includes(entry.mmproj)) : undefined,
      })
    }
    return models.sort((a, b) => a.label.localeCompare(b.label))
  }

  /**
   * Télécharge un modèle du catalogue.
   *
   * Reprend là où un téléchargement précédent s'est arrêté : le fichier
   * partiel porte le suffixe `.part` et sa taille sert de décalage. Sur 18 Go
   * et une coupure réseau, tout reprendre à zéro n'est pas une option.
   */
  async download(
    id: string,
    onProgress: (progress: ModelProgress) => void,
  ): Promise<boolean> {
    const entry = CATALOG.find(candidate => candidate.id === id)
    if (!entry) {
      onProgress(fail(id, `Modèle inconnu : ${id}.`))
      return false
    }
    if (this.running.has(id)) return false

    const control = new AbortController()
    this.running.set(id, control)
    try {
      await mkdir(this.config.root, { recursive: true })

      // Le total inclut le projecteur : la barre doit refléter l'attente
      // réelle, pas la première de deux étapes.
      const total = entry.bytes + (entry.mmprojBytes ?? 0)
      const files = [{ name: entry.file, bytes: entry.bytes }]
      if (entry.mmproj) {
        files.push({ name: entry.mmproj, bytes: entry.mmprojBytes ?? 0 })
      }

      let already = 0
      for (const target of files) {
        await this.fetchFile(
          huggingFaceUrl(entry.repo, target.name),
          join(this.config.root, target.name),
          control.signal,
          received =>
            onProgress({
              id,
              status: `Téléchargement de ${target.name}`,
              ratio: total ? Math.min(1, (already + received) / total) : null,
              done: false,
              failed: false,
            }),
        )
        already += target.bytes
      }

      onProgress({ id, status: 'Installé.', ratio: 1, done: true, failed: false })
      return true
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      onProgress(
        fail(id, control.signal.aborted ? 'Téléchargement annulé.' : message),
      )
      return false
    } finally {
      this.running.delete(id)
    }
  }

  /**
   * Installe un modèle depuis un dépôt collé, hors catalogue.
   *
   * Même mécanique de téléchargement que `download()` — reprise sur `.part`
   * comprise —, mais l'entrée décrivant le modèle n'existe nulle part : elle
   * est écrite au registre à la fin, et c'est elle qui fera exister le modèle
   * dans l'interface au redémarrage suivant.
   */
  async installFromRepo(
    repo: string,
    option: QuantOption,
    onProgress: (progress: ModelProgress) => void,
  ): Promise<boolean> {
    const id = option.id
    if (this.running.has(id)) return false

    const control = new AbortController()
    this.running.set(id, control)
    try {
      await mkdir(this.config.root, { recursive: true })

      // Les tranches sont déposées à plat, à côté du fichier principal : c'est
      // là que `llama-server` va les chercher, et un sous-dossier du dépôt les
      // en séparerait.
      //
      // Le projecteur, lui, est renommé. Trois dépôts sur quatre publient le
      // leur sous `mmproj-F16.gguf` ; sans ce renommage, le second modèle
      // installé hériterait du projecteur du premier — silencieusement, la
      // reprise voyant un fichier déjà complet.
      const targets = [
        ...[option.file, ...option.shards].map(file => ({
          file,
          local: basename(file.path),
        })),
        ...(option.mmproj
          ? [{ file: option.mmproj, local: `mmproj-${id}.gguf` }]
          : []),
      ]

      let already = 0
      for (const target of targets) {
        await this.fetchFile(
          huggingFaceUrl(repo, target.file.path),
          join(this.config.root, target.local),
          control.signal,
          received =>
            onProgress({
              id,
              status: `Téléchargement de ${target.local}`,
              ratio: option.totalBytes
                ? Math.min(1, (already + received) / option.totalBytes)
                : null,
              done: false,
              failed: false,
            }),
        )
        already += target.file.bytes
      }

      const name = repo.slice(repo.indexOf('/') + 1)
      await this.set({
        custom: [
          ...this.config.custom.filter(model => model.id !== id),
          {
            id,
            label: `${name} · ${option.label}`,
            repo,
            file: basename(option.file.path),
            shards: option.shards.map(shard => basename(shard.path)),
            mmproj: option.mmproj ? `mmproj-${id}.gguf` : null,
            bytes: option.totalBytes,
          },
        ],
      })

      onProgress({ id, status: 'Installé.', ratio: 1, done: true, failed: false })
      return true
    } catch (error) {
      const message = String((error as Error)?.message ?? error)
      onProgress(
        fail(id, control.signal.aborted ? 'Téléchargement annulé.' : message),
      )
      return false
    } finally {
      this.running.delete(id)
    }
  }

  cancel(id: string): void {
    this.running.get(id)?.abort()
  }

  /** Efface les poids d'un modèle ; le serveur le lâche s'il le servait. */
  async remove(id: string): Promise<void> {
    const found = (await this.installed()).find(model => model.id === id)
    if (!found) return
    if (this.serving === id) this.stop()
    const entry = this.sources.find(candidate => candidate.id === id)
    const files = [
      found.file,
      ...(entry?.shards ?? []),
      ...(entry?.mmproj ? [entry.mmproj] : []),
    ]
    for (const file of files) {
      await rm(join(this.config.root, file), { force: true })
    }
    // Le registre décrirait sinon un modèle qui n'est plus sur le disque.
    if (this.config.custom.some(model => model.id === id)) {
      await this.set({
        custom: this.config.custom.filter(model => model.id !== id),
      })
    }
  }

  /**
   * Installe `llama-server` s'il manque.
   *
   * L'archive est extraite avec `tar`, présent sur Windows depuis la version
   * 10 et sur tout Linux — inutile d'embarquer une bibliothèque de
   * décompression pour une opération faite une fois.
   */
  async ensureRuntime(
    onProgress: (progress: ModelProgress) => void,
  ): Promise<boolean> {
    const id = 'runtime'
    try {
      await stat(this.serverBinary)
      return true
    } catch {
      // Absent : à installer.
    }

    const control = new AbortController()
    this.running.set(id, control)
    try {
      const asset = runtimeAsset(this.config.backend)
      const url = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_BUILD}/${asset}`
      const archive = join(dirname(this.config.root), asset)
      await mkdir(this.runtimeDir, { recursive: true })

      await this.fetchFile(url, archive, control.signal, (received, total) =>
        onProgress({
          id,
          status: `Téléchargement du moteur d’inférence (${this.config.backend})`,
          ratio: total ? received / total : null,
          done: false,
          failed: false,
        }),
      )

      onProgress({
        id,
        status: 'Extraction…',
        ratio: null,
        done: false,
        failed: false,
      })
      await extract(archive, this.runtimeDir)
      await rm(archive, { force: true })
      // Vérifié plutôt que supposé : une archive dont l'arborescence a changé
      // s'extrait sans erreur et laisse le binaire introuvable.
      await stat(this.serverBinary)

      onProgress({
        id,
        status: 'Moteur prêt.',
        ratio: 1,
        done: true,
        failed: false,
      })
      return true
    } catch (error) {
      onProgress(fail(id, String((error as Error)?.message ?? error)))
      return false
    } finally {
      this.running.delete(id)
    }
  }

  /**
   * Démarre le serveur d'inférence sur un modèle.
   *
   * Un seul à la fois : deux modèles chargés se disputeraient la mémoire, et
   * sur un poste comme sur un serveur c'est la ressource qui manque en
   * premier.
   */
  async start(
    id: string,
    onProgress: (progress: ModelProgress) => void,
    reasoning: ReasoningMode = 'auto',
  ): Promise<boolean> {
    if (!(await this.ensureRuntime(onProgress))) return false

    const model = (await this.installed()).find(candidate => candidate.id === id)
    if (!model) {
      onProgress(fail(id, "Ce modèle n'est pas installé."))
      return false
    }

    this.stop()
    const entry = this.sources.find(candidate => candidate.id === id)
    const args = serverArgs({
      config: this.config,
      model,
      mmproj: entry?.mmproj ?? null,
      reasoning,
    })

    this.log = []
    this.server = spawn(this.serverBinary, args, {
      cwd: this.runtimeDir,
      windowsHide: true,
    })
    this.serving = id
    this.servingReasoning = reasoning

    const record = (chunk: Buffer) => {
      // Borné : `llama-server` est bavard, et seules les dernières lignes
      // expliquent un échec.
      this.log.push(...String(chunk).split('\n').filter(Boolean))
      if (this.log.length > 60) this.log = this.log.slice(-60)
    }
    this.server.stdout?.on('data', record)
    this.server.stderr?.on('data', record)
    this.server.on('exit', code => {
      if (this.serving !== id) return
      this.server = null
      this.serving = null
      this.servingReasoning = null
      if (code) onProgress(fail(id, `Le serveur s'est arrêté (code ${code}).`))
    })

    // Le chargement des poids prend de quelques secondes à quelques minutes
    // selon la taille. On attend que le serveur se déclare prêt plutôt que de
    // rendre la main sur un port qui refuse encore les connexions.
    const ready = await this.waitReady(ratio =>
      onProgress({
        id,
        status: 'Chargement du modèle…',
        ratio,
        done: false,
        failed: false,
      }),
    )
    if (!ready) {
      const reason = this.log.slice(-3).join(' ') || 'délai dépassé'
      this.stop()
      onProgress(fail(id, `Le modèle n'a pas démarré : ${reason}`))
      return false
    }

    await this.set({ serving: id })
    onProgress({ id, status: 'En service.', ratio: 1, done: true, failed: false })
    return true
  }

  stop(): void {
    this.serving = null
    this.servingReasoning = null
    this.server?.kill()
    this.server = null
  }

  status(): ServerStatus {
    return {
      running: this.server !== null,
      model: this.serving,
      port: this.config.port,
      reasoning: this.servingReasoning,
      log: this.log.slice(-12),
    }
  }

  /** Adresse compatible OpenAI, celle que la passerelle doit viser. */
  get baseUrl(): string {
    return `http://127.0.0.1:${this.config.port}/v1`
  }

  /**
   * Racine du serveur, celle que le moteur reçoit.
   *
   * Sans le `/v1` : le moteur l'ajoute lui-même pour former `/v1/messages`,
   * que `llama-server` sert nativement. Le donner deux fois produirait un
   * `/v1/v1/messages` introuvable.
   */
  get serverUrl(): string {
    return `http://127.0.0.1:${this.config.port}`
  }

  private async waitReady(onWait: (ratio: number) => void): Promise<boolean> {
    const timeout = 240_000
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      // Le processus a rendu la main : inutile d'attendre la fin du délai,
      // l'échec est déjà dans le journal.
      if (this.server === null) return false
      try {
        const response = await fetch(
          `http://127.0.0.1:${this.config.port}/health`,
          { signal: AbortSignal.timeout(2000) },
        )
        if (response.ok) return true
      } catch {
        // Pas encore en écoute.
      }
      onWait(1 - (deadline - Date.now()) / timeout)
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    return false
  }

  /**
   * Télécharge un fichier, en reprenant un `.part` existant.
   *
   * La progression est émise au plus une fois par demi-seconde : un fichier de
   * 18 Go produit des dizaines de milliers de fragments, et en relayer chacun
   * saturerait le pont IPC pour un affichage que l'œil ne suit pas.
   */
  private async fetchFile(
    url: string,
    target: string,
    signal: AbortSignal,
    onBytes: (received: number, total: number | null) => void,
  ): Promise<void> {
    try {
      await stat(target)
      return // Déjà là.
    } catch {
      // À télécharger.
    }

    const part = `${target}.part`
    let offset = 0
    try {
      offset = (await stat(part)).size
    } catch {
      // Rien à reprendre.
    }

    const response = await fetch(url, {
      signal,
      headers: offset ? { range: `bytes=${offset}-` } : {},
      redirect: 'follow',
    })
    // 206 : la reprise est acceptée. 200 malgré le décalage demandé : le
    // serveur l'a ignoré et renvoie le fichier entier — il faut repartir de
    // zéro, sans quoi on obtiendrait un fichier corrompu qui passerait pour
    // complet.
    if (offset && response.status === 200) offset = 0
    if (!response.ok || !response.body) {
      throw new Error(`Le dépôt a répondu ${response.status}.`)
    }

    const declared = Number(response.headers.get('content-length') ?? 0)
    const total = declared ? declared + offset : null
    const out = createWriteStream(part, { flags: offset ? 'a' : 'w' })
    const reader = response.body.getReader()
    let received = offset
    let announced = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (!out.write(value)) await once(out, 'drain')
        if (Date.now() - announced > 500) {
          announced = Date.now()
          onBytes(received, total)
        }
      }
    } finally {
      out.end()
      await once(out, 'close')
    }

    await rename(part, target)
    onBytes(received, total)
  }
}

function fail(id: string, status: string): ModelProgress {
  return { id, status, ratio: null, done: true, failed: true }
}

/**
 * Extrait une archive, zip sous Windows et tar.gz sous Linux.
 *
 * Deux pièges, tous deux rencontrés :
 *
 *  - **Le chemin absolu du programme.** `spawn('tar')` suit le PATH, et si Git
 *    y figure c'est son GNU tar qui répond — lequel ne lit pas le zip et se
 *    contente d'un « This does not look like a tar archive ». Le bsdtar livré
 *    avec Windows, lui, le lit. On le nomme donc explicitement.
 *
 *  - **L'archive nommée relativement.** Passer `E:\users\LLM\archive.zip`
 *    échoue : tar lit `hôte:chemin` dans tout nom contenant un deux-points et
 *    répond « Cannot connect to E: resolve failed ». Seul le nom passé à `-f`
 *    subit cette lecture ; `-C` peut rester absolu.
 */
async function extract(archive: string, into: string): Promise<void> {
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar'
  const child = spawn(tar, ['-xf', basename(archive), '-C', into], {
    cwd: dirname(archive),
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', chunk => (stderr += String(chunk)))
  const [code] = (await once(child, 'exit')) as [number | null]
  if (code !== 0) throw new Error(`Extraction impossible : ${stderr.trim()}`)
}
