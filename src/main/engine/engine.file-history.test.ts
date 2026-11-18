import { testConfig } from './testConfig.js'
import { expect, test } from 'bun:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { projectKey, desktopTranscript } from '../backend/transcript.js'
import { Engine } from './engine.js'
import { DEFAULT_SESSION_SETTINGS, type EngineMessage } from '../../shared/protocol.js'
import { ISOLATION_ENV } from '../providers/index.js'
import { listRestorePoints, setProjectsRoot } from '../session/sessions.js'
import { rewindFiles } from '../session/rewind.js'
import { TEST_ROOTS } from '../testRoots.test-support.js'

/**
 * Points de restauration : le contenu d'avant l'édition doit rester lisible.
 *
 * Le moteur tourne ici en `-p`, donc en session non interactive, où la
 * sauvegarde des fichiers reste fermée tant que le desktop ne pose pas
 * `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`. Le test passe par la vraie
 * classe `Engine` — c'est elle qui compose l'environnement du sous-processus —
 * et non par un environnement reconstitué : c'est le seul moyen que la
 * variable manquante fasse échouer le test plutôt que passer inaperçue.
 *
 * L'inférence est simulée pour que les éditions soient certaines ; le CLI, lui,
 * est le binaire compilé.
 */

/** Un appel d'outil que l'inférence simulée fera jouer, dans l'ordre. */
type Step = { tool: string; input: unknown }

/**
 * Inférence simulée : elle enchaîne les appels d'outils demandés, puis conclut.
 *
 * Simulée pour que la séquence soit certaine — un vrai modèle choisirait
 * librement ses outils, et le sujet du test n'est pas son choix mais ce que le
 * moteur sauvegarde.
 */
function toolServer(steps: Step[]) {
  let calls = 0
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* Le fixture n'émet rien hors boucle locale. */ }
    if (!req.url?.split('?')[0]?.endsWith('/messages')) { res.writeHead(404).end(); return }
    const step = steps[calls]
    calls++
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const sse = (type: string, value: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`)
    sse('message_start', { type: 'message_start', message: { id: `msg_${calls}`, type: 'message', role: 'assistant', model: 'local-history-test', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } })
    if (step) {
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${calls}`, name: step.tool, input: {} } })
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } })
    } else {
      sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Terminé.' } })
    }
    sse('content_block_stop', { type: 'content_block_stop', index: 0 })
    sse('message_delta', { type: 'message_delta', delta: { stop_reason: step ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 4 } })
    sse('message_stop', { type: 'message_stop' })
    res.end()
  })
  return server
}

/** Ouvre un moteur réel contre cette inférence simulée. */
async function engineFor(directory: string, server: ReturnType<typeof toolServer>, tools: string[]) {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  const messages: EngineMessage[] = []
  const engine = new Engine({
    cwd: directory,
    ...TEST_ROOTS,
    configDir: testConfig(join(directory, 'configuration')),
    settings: { ...DEFAULT_SESSION_SETTINGS, tools, permissionMode: 'bypassPermissions' },
    extraEnv: async () => ({ ...ISOLATION_ENV, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_MODEL: 'local-history-test', ANTHROPIC_AUTH_TOKEN: 'local-test', CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }),
  })
  engine.on('message', message => messages.push(message))
  const settle = async () => {
    const deadline = Date.now() + 30000
    while (engine.isBusy) {
      if (Date.now() > deadline) throw new Error(`Tour non terminé : ${JSON.stringify(messages)}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  return { engine, messages, settle, cleanup() { engine.stop(); server.closeAllConnections(); server.close() } }
}

async function editOneFile(secondPrompt?: string): Promise<{
  directory: string
  target: string
  original: string
  sessionId: string | null
  messages: EngineMessage[]
  cleanup: () => void
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sample-file-history-'))
  const target = join(directory, 'existant.txt')
  const original = 'contenu initial à retrouver\n'
  await writeFile(target, original, 'utf8')

  // `Write` refuse d'écraser un fichier qu'il n'a pas lu ; la lecture n'est
  // donc pas décorative, c'est la séquence réelle qu'un modèle emprunte.
  const run = await engineFor(directory, toolServer([
    { tool: 'read_file', input: { path: target } },
    { tool: 'write_file', input: { path: target, content: 'contenu réécrit\n' } },
  ]), ['read_file', 'write_file'])

  await run.engine.send('Réécris le fichier existant.')
  await run.settle()
  expect(await readFile(target, 'utf8')).toBe('contenu réécrit\n')

  // Chaque tour est un sous-processus neuf, repris par `--resume` : c'est ce
  // passage qui décide si les points de restauration d'un tour survivent au
  // suivant, et il ne se joue qu'à partir du deuxième.
  if (secondPrompt !== undefined) {
    await run.engine.send(secondPrompt)
    await run.settle()
  }

  return {
    directory,
    target,
    original,
    sessionId: run.engine.currentSessionId,
    messages: run.messages,
    cleanup: run.cleanup,
  }
}

test('une édition du vrai CLI laisse le contenu précédent récupérable', async () => {
  const run = await editOneFile()
  try {
    expect(run.sessionId).toBeTruthy()
    const backupDirectory = join(run.directory, 'configuration', 'sessions', projectKey(run.directory), run.sessionId as string, 'file-history')
    const backups = await readdir(backupDirectory)
    expect(backups.length).toBeGreaterThan(0)

    // La preuve utile n'est pas qu'un dossier existe, mais que l'état d'avant
    // l'édition s'y relise tel quel : c'est ce qu'une restauration rendra.
    const contents = await Promise.all(backups.map(name => readFile(join(backupDirectory, name), 'utf8')))
    expect(contents).toContain(run.original)
  } finally { run.cleanup() }
}, 60000)

test('le transcript associe le point de restauration à un message utilisateur', async () => {
  const run = await editOneFile()
  try {
    // L'étape suivante de T06 restaure via un `user_message_id` ; il doit donc
    // exister dans le transcript, seul lien entre un tour et ses sauvegardes.
    const projectDirectory = join(run.directory, 'configuration', 'sessions')
    const projects = await readdir(projectDirectory)
    const lines: string[] = []
    for (const project of projects) {
      for (const file of await readdir(join(projectDirectory, project))) {
        if (!file.endsWith('.jsonl')) continue
        lines.push(...(await readFile(join(projectDirectory, project, file), 'utf8')).split('\n').filter(Boolean))
      }
    }
    const entries = lines.map(line => desktopTranscript(JSON.parse(line)) as { type?: string; uuid?: string; messageId?: string })
    const snapshot = entries.find(entry => entry.type === 'file-history-snapshot')
    expect(snapshot).toBeDefined()
    expect(snapshot?.messageId).toBeTruthy()
    expect(entries.some(entry => entry.type === 'user' && entry.uuid === snapshot?.messageId)).toBe(true)
  } finally { run.cleanup() }
}, 60000)

test('un tour réel devient un point de restauration nommé par son invite', async () => {
  const run = await editOneFile()
  try {
    setProjectsRoot(join(run.directory, 'configuration', 'sessions'))
    const points = await listRestorePoints(run.directory, run.sessionId as string)
    expect(points.length).toBe(1)
    expect(points[0]!.text).toBe('Réécris le fichier existant.')
    expect(points[0]!.at).toBeTruthy()

    // L'identifiant doit être celui que le moteur a consigné, sinon la
    // restauration visera un message qu'il ne connaît pas.
    const projects = await readdir(join(run.directory, 'configuration', 'sessions'))
    const lines: string[] = []
    for (const project of projects) {
      for (const file of await readdir(join(run.directory, 'configuration', 'sessions', project))) {
        if (!file.endsWith('.jsonl')) continue
        lines.push(...(await readFile(join(run.directory, 'configuration', 'sessions', project, file), 'utf8')).split('\n').filter(Boolean))
      }
    }
    const snapshots = lines.map(line => desktopTranscript(JSON.parse(line)) as { type?: string; messageId?: string })
      .filter(entry => entry.type === 'file-history-snapshot')
    expect(snapshots.map(entry => entry.messageId)).toContain(points[0]!.messageId)
  } finally { run.cleanup() }
}, 60000)

test('seules les invites de l’utilisateur pourvues d’un instantané sont proposées', async () => {
  // Transcript écrit à la main : les entrées à écarter n'apparaissent pas
  // toutes dans un tour ordinaire, et c'est justement leur tri qui se casse
  // sans être vu.
  const root = await mkdtemp(join(tmpdir(), 'sample-restore-points-'))
  const cwd = join(root, 'projet')
  await mkdir(cwd, { recursive: true })
  setProjectsRoot(join(root, 'sessions'))
  const directory = join(root, 'sessions', projectKey(cwd))
  await mkdir(directory, { recursive: true })

  const entry = (value: unknown) => `${JSON.stringify(value)}\n`
  await writeFile(join(directory, 'sess.jsonl'), [
    entry({ type: 'user', uuid: 'u1', timestamp: '2026-09-08T10:00:00Z', message: { content: 'Première invite' } }),
    entry({ type: 'file-history-snapshot', messageId: 'u1', snapshot: { trackedFileBackups: {} } }),
    // Résultat d'outil : une entrée `user` qui n'est pas une invite.
    entry({ type: 'user', uuid: 'u2', timestamp: '2026-09-08T10:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    entry({ type: 'file-history-snapshot', messageId: 'u2', snapshot: { trackedFileBackups: {} } }),
    // Invite d'un sous-agent : elle ne ramène pas le disque de l'utilisateur.
    entry({ type: 'user', uuid: 'u3', isSidechain: true, timestamp: '2026-09-08T10:00:02Z', message: { content: 'Invite de sous-agent' } }),
    entry({ type: 'file-history-snapshot', messageId: 'u3', snapshot: { trackedFileBackups: {} } }),
    // Message interne encadré par des chevrons.
    entry({ type: 'user', uuid: 'u4', timestamp: '2026-09-08T10:00:03Z', message: { content: '<command-name>/init</command-name>' } }),
    entry({ type: 'file-history-snapshot', messageId: 'u4', snapshot: { trackedFileBackups: {} } }),
    // Invite sans instantané : rien à restaurer, donc rien à proposer.
    entry({ type: 'user', uuid: 'u5', timestamp: '2026-09-08T10:00:04Z', message: { content: 'Invite sans instantané' } }),
    entry({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'réponse' }] } }),
    'ligne illisible\n',
  ].join(''), 'utf8')

  const points = await listRestorePoints(cwd, 'sess')
  expect(points.map(point => point.messageId)).toEqual(['u1'])
  expect(points[0]!.text).toBe('Première invite')
  expect(points[0]!.at).toBe('2026-09-08T10:00:00Z')

  expect(await listRestorePoints(cwd, 'session-inconnue')).toEqual([])
})

test('les points de restauration survivent au sous-processus du tour suivant', async () => {
  const run = await editOneFile('Et maintenant, résume.')
  try {
    setProjectsRoot(join(run.directory, 'configuration', 'sessions'))
    const points = await listRestorePoints(run.directory, run.sessionId as string)
    expect(points.map(point => point.text)).toEqual([
      'Réécris le fichier existant.',
      'Et maintenant, résume.',
    ])
    expect(new Set(points.map(point => point.messageId)).size).toBe(2)
  } finally { run.cleanup() }
}, 90000)

/** Paramètres communs aux appels de restauration d'un scénario. */
function rewindOptions(run: { directory: string; sessionId: string | null }, messageId: string, dryRun: boolean) {
  return {
    ...TEST_ROOTS,
    cwd: run.directory,
    configDir: testConfig(join(run.directory, 'configuration')),
    sessionId: run.sessionId as string,
    messageId,
    dryRun,
    timeoutMs: 45000,
  }
}

async function pointOf(run: { directory: string; sessionId: string | null }): Promise<string> {
  setProjectsRoot(join(run.directory, 'configuration', 'sessions'))
  const points = await listRestorePoints(run.directory, run.sessionId as string)
  expect(points.length).toBeGreaterThan(0)
  return points[0]!.messageId
}

test('la prévisualisation annonce le changement sans toucher au disque', async () => {
  const run = await editOneFile()
  try {
    const messageId = await pointOf(run)
    const preview = await rewindFiles(rewindOptions(run, messageId, true))
    expect(preview.canRewind).toBe(true)
    expect(preview.error).toBeUndefined()
    expect(preview.filesChanged).toEqual([run.target])
    expect(preview.insertions).toBe(1)
    expect(preview.deletions).toBe(1)

    // Une prévisualisation qui modifierait le disque ne serait pas un aperçu.
    expect(await readFile(run.target, 'utf8')).toBe('contenu réécrit\n')
  } finally { run.cleanup() }
}, 120000)

test('la restauration confirmée ramène le fichier à son état d’avant le tour', async () => {
  const run = await editOneFile()
  try {
    const messageId = await pointOf(run)
    const restored = await rewindFiles(rewindOptions(run, messageId, false))
    expect(restored.canRewind).toBe(true)
    expect(restored.error).toBeUndefined()
    expect(await readFile(run.target, 'utf8')).toBe(run.original)
  } finally { run.cleanup() }
}, 120000)

test('un point de restauration inconnu est refusé sans rien écrire', async () => {
  const run = await editOneFile()
  try {
    const refused = await rewindFiles(rewindOptions(run, '11111111-2222-3333-4444-555555555555', false))
    expect(refused.canRewind).toBe(false)
    expect(refused.error).toBeTruthy()
    expect(await readFile(run.target, 'utf8')).toBe('contenu réécrit\n')
  } finally { run.cleanup() }
}, 120000)

test('une session inconnue échoue proprement, sans blocage ni écriture', async () => {
  const run = await editOneFile()
  try {
    const messageId = await pointOf(run)
    const failed = await rewindFiles({
      ...rewindOptions(run, messageId, false),
      sessionId: '99999999-8888-7777-6666-555555555555',
    })
    expect(failed.canRewind).toBe(false)
    expect(failed.error).toBeTruthy()
    expect(await readFile(run.target, 'utf8')).toBe('contenu réécrit\n')
  } finally { run.cleanup() }
}, 120000)

test('une modification manuelle exige le consentement pour le plan exact avant écrasement', async () => {
  const run = await editOneFile()
  try {
    const messageId = await pointOf(run)
    // L'utilisateur retouche lui-même le fichier après le tour : la
    // restauration porte alors sur un état que le moteur n'a jamais vu.
    await writeFile(run.target, 'retouché à la main\n', 'utf8')

    const preview = await rewindFiles(rewindOptions(run, messageId, true))
    expect(preview.canRewind).toBe(true)
    expect(preview.filesChanged).toEqual([run.target])

    expect(preview.conflicts).toEqual([run.target])
    const refused = await rewindFiles(rewindOptions(run, messageId, false))
    expect(refused.canRewind).toBe(false)
    expect(await readFile(run.target, 'utf8')).toBe('retouché à la main\n')
    const restored = await rewindFiles({ ...rewindOptions(run, messageId, false), fingerprint: preview.fingerprint })
    expect(restored.canRewind).toBe(true)
    expect(await readFile(run.target, 'utf8')).toBe(run.original)
  } finally { run.cleanup() }
}, 120000)

test('restaurer avant un tour supprime le fichier que ce tour avait créé', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-file-cree-'))
  const created = join(directory, 'cree.txt')
  // `Write` n'exige une lecture préalable que pour un fichier existant ; la
  // création se fait donc en un seul appel, comme un modèle le ferait.
  const run = await engineFor(directory, toolServer([{ tool: 'write_file', input: { path: created, content: 'fichier tout neuf\n' } }]), ['write_file'])
  try {
    await run.engine.send('Crée le fichier.')
    await run.settle()
    expect(await readFile(created, 'utf8')).toBe('fichier tout neuf\n')

    setProjectsRoot(join(directory, 'configuration', 'sessions'))
    const sessionId = run.engine.currentSessionId as string
    const points = await listRestorePoints(directory, sessionId)
    expect(points.length).toBe(1)
    const options = {
      ...TEST_ROOTS,
      cwd: directory, configDir: testConfig(join(directory, 'configuration')), sessionId,
      messageId: points[0]!.messageId, timeoutMs: 45000,
    }

    const preview = await rewindFiles({ ...options, dryRun: true })
    expect(preview.canRewind).toBe(true)
    expect(preview.filesChanged).toEqual([created])
    expect(await readFile(created, 'utf8')).toBe('fichier tout neuf\n')

    const restored = await rewindFiles({ ...options, dryRun: false, fingerprint: preview.fingerprint })
    expect(restored.canRewind).toBe(true)
    // Avant ce tour le fichier n'existait pas : le ramener là, c'est le retirer.
    expect(await readFile(created, 'utf8').catch(error => (error as NodeJS.ErrnoException).code)).toBe('ENOENT')
  } finally { run.cleanup() }
}, 120000)

test('restaurer ramène un fichier suivi supprimé depuis le tour', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sample-file-supprime-'))
  const target = join(directory, 'supprime.txt')
  const original = 'contenu à faire revenir\n'
  await writeFile(target, original, 'utf8')
  const run = await engineFor(directory, toolServer([
    { tool: 'read_file', input: { path: target } },
    { tool: 'write_file', input: { path: target, content: 'réécrit par le modèle\n' } },
  ]), ['read_file', 'write_file'])
  try {
    await run.engine.send('Modifie le fichier.')
    await run.settle()
    expect(await readFile(target, 'utf8')).toBe('réécrit par le modèle\n')

    // Le fichier disparaît après le tour : suppression manuelle, ou nettoyage
    // par un outil que l'historique ne suit pas.
    await rm(target)

    setProjectsRoot(join(directory, 'configuration', 'sessions'))
    const sessionId = run.engine.currentSessionId as string
    const points = await listRestorePoints(directory, sessionId)
    expect(points.length).toBe(1)
    const options = {
      ...TEST_ROOTS,
      cwd: directory, configDir: testConfig(join(directory, 'configuration')), sessionId,
      messageId: points[0]!.messageId, timeoutMs: 45000,
    }

    const preview = await rewindFiles({ ...options, dryRun: true })
    expect(preview.canRewind).toBe(true)
    expect(preview.filesChanged).toEqual([target])

    const restored = await rewindFiles({ ...options, dryRun: false, fingerprint: preview.fingerprint })
    expect(restored.canRewind).toBe(true)
    expect(await readFile(target, 'utf8')).toBe(original)
  } finally { run.cleanup() }
}, 120000)
