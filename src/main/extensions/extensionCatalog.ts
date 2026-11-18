/** Built-in suggestions; additional Git catalogues are managed by Extensions. */
export type ExtensionKind = 'plugin' | 'tool'

export type CatalogEntry = {
  id: string
  name: string
  kind: ExtensionKind
  summary: string
  /** Dépôt à cloner, pour les plugins. */
  repository?: string
  /** Programme à trouver sur le PATH, pour les outils. */
  command?: string
  /** Comment l'obtenir, pour les outils. */
  install?: string
  sourceId?: string
  ref?: string
  pluginPath?: string
  content?: 'skill' | 'plugin'
  skills?: string[]
  version?: string
  problem?: string
  /** Standard engine manifest synthesized only for strict:false entries or raw skills. */
  manifest?: Record<string, unknown>
  homepage: string
  license: string
  category?: string
  /** Nom affiché ; `name` reste l'identifiant technique, vérifié contre le manifeste. */
  displayName?: string
  /** Mis en avant dans « Découvrir » (étiquette `recommended` du catalogue). */
  recommended?: boolean
}

/**
 * Catalogue officiel de WhiteCode, ajouté au premier lancement.
 *
 * Épinglé sur un tag : une nouvelle version n'arrive que lorsque
 * l'utilisateur actualise la source, comme pour toute autre source.
 */
export const DEFAULT_SOURCE = { repository: 'https://github.com/Paqquito/WhiteCode-Extensions.git', ref: 'v1.1.0' }

/** Le plugin Bureautique : autrefois inclus, désormais installé depuis le catalogue officiel. */
export const OFFICE_PLUGIN = 'whitecode-office'

/**
 * Catalogue.
 *
 * Suggestions initiales, complétées par les sources ajoutées par l’utilisateur :
 * un plugin s'exécute avec les droits du moteur, c'est-à-dire les vôtres. Une
 * liste nommée, dont chaque entrée a été regardée, vaut mieux qu'un annuaire
 * où l'on installe à l'aveugle.
 */
export const CATALOG: CatalogEntry[] = [
  {
    id: 'ponytail',
    skills: ['ponytail', 'ponytail-audit', 'ponytail-debt', 'ponytail-gain', 'ponytail-help', 'ponytail-review'],
    name: 'Ponytail',
    kind: 'plugin',
    summary:
      'Pousse l’agent à écrire le moins de code possible : chercher l’existant avant d’ajouter, préférer la suppression.',
    repository: 'https://github.com/dietrichgebert/ponytail.git',
    homepage: 'https://github.com/dietrichgebert/ponytail',
    license: 'MIT',
  },
  {
    id: 'agent-skills',
    skills: ['api-and-interface-design', 'browser-testing-with-devtools', 'ci-cd-and-automation', 'code-review-and-quality', 'code-simplification', 'constraint-driven-development', 'context-engineering', 'debugging-and-error-recovery', 'deprecation-and-migration', 'documentation-and-adrs', 'doubt-driven-development', 'frontend-ui-engineering', 'git-workflow-and-versioning', 'idea-refine', 'incremental-implementation', 'interview-me', 'observability-and-instrumentation', 'performance-optimization', 'planning-and-task-breakdown', 'security-and-hardening', 'shipping-and-launch', 'source-driven-development', 'spec-driven-development', 'test-driven-development', 'using-agent-skills'],
    name: 'Agent Skills',
    kind: 'plugin',
    summary:
      'Compétences d’ingénierie généralistes : revue, tests, refonte, performance, accessibilité.',
    repository: 'https://github.com/addyosmani/agent-skills.git',
    homepage: 'https://github.com/addyosmani/agent-skills',
    license: 'MIT',
  },
  {
    id: 'ecc',
    name: 'ECC',
    kind: 'plugin',
    summary:
      'Ensemble étendu : mémoire, sécurité, recherche préalable, réglages de comportement.',
    repository: 'https://github.com/affaan-m/ECC.git',
    homepage: 'https://github.com/affaan-m/ECC',
    license: 'MIT',
  },
  {
    id: 'graphify',
    name: 'Graphify',
    kind: 'tool',
    summary:
      'Transforme un dépôt en graphe de connaissance interrogeable, par analyse syntaxique. Remplace le grep par des questions.',
    command: 'graphify',
    install: 'uv tool install graphifyy',
    homepage: 'https://github.com/Graphify-Labs/graphify',
    license: 'Apache-2.0',
  },
]
