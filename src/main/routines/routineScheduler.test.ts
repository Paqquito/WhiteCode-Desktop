/**
 * Ordonnanceur des routines.
 *
 * Trois garanties, et ce sont les trois façons dont un planificateur trahit :
 * ne pas partir, partir deux fois, ou repartir indéfiniment après un
 * redémarrage. Le test écrit un vrai `scheduled_tasks.json` dans un répertoire
 * temporaire — le format du moteur, pas une imitation.
 */

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Routine } from './routines.js'
import {
  addRoutine,
  readRoutines,
  removeRoutine,
  writeRoutines,
} from './routinesStore.js'
import { RoutineScheduler } from './routineScheduler.js'

const HEURE = 3_600_000
const CREATION = Date.UTC(2026, 0, 1, 10, 0, 0)

let projet: string

beforeEach(async () => {
  projet = await mkdtemp(join(tmpdir(), 'sample-routines-'))
})

afterEach(async () => {
  await rm(projet, { recursive: true, force: true })
})

const horaire = (over: Partial<Routine> = {}): Routine => ({
  id: 'r1',
  cron: '0 * * * *',
  prompt: 'Faire le point',
  createdAt: CREATION,
  recurring: true,
  ...over,
})

/** Un ordonnanceur qui note ses tirs au lieu d'ouvrir des sessions. */
function ordonnanceur(): {
  scheduler: RoutineScheduler
  tirs: { cwd: string; prompt: string }[]
} {
  const tirs: { cwd: string; prompt: string }[] = []
  const scheduler = new RoutineScheduler(
    () => [projet],
    (cwd, task) => tirs.push({ cwd, prompt: task.prompt }),
  )
  return { scheduler, tirs }
}

test('une routine due part, avec son invite', async () => {
  await writeRoutines(projet, [horaire()])
  const { scheduler, tirs } = ordonnanceur()

  await scheduler.tick(CREATION + 2 * HEURE)

  expect(tirs).toEqual([{ cwd: projet, prompt: 'Faire le point' }])
})

test('une routine dont l’heure n’est pas venue ne part pas', async () => {
  await writeRoutines(projet, [horaire()])
  const { scheduler, tirs } = ordonnanceur()

  await scheduler.tick(CREATION + 60_000)

  expect(tirs).toEqual([])
})

test('une routine récurrente ne repart pas au tick suivant', async () => {
  // Le défaut le plus coûteux : sans écriture de `lastFiredAt`, la routine
  // repart à chaque minute et ouvre une session à chaque fois.
  await writeRoutines(projet, [horaire()])
  const { scheduler, tirs } = ordonnanceur()

  await scheduler.tick(CREATION + 2 * HEURE)
  await scheduler.tick(CREATION + 2 * HEURE + 60_000)

  expect(tirs.length).toBe(1)

  // Et la marque est sur le disque, pas seulement en mémoire : c'est elle qui
  // fait survivre la retenue à un redémarrage.
  const apres = await readRoutines(projet)
  expect(apres[0]?.lastFiredAt).toBe(CREATION + 2 * HEURE)
})

test('une routine à tir unique disparaît après son tir', async () => {
  await writeRoutines(projet, [horaire({ recurring: false })])
  const { scheduler, tirs } = ordonnanceur()

  await scheduler.tick(CREATION + 2 * HEURE)

  expect(tirs.length).toBe(1)
  expect(await readRoutines(projet)).toEqual([])
})

test('un projet sans fichier de routines ne fait rien tomber', async () => {
  const { scheduler, tirs } = ordonnanceur()
  await scheduler.tick(CREATION + 2 * HEURE)
  expect(tirs).toEqual([])
})

test('avant sa première échéance, rien ne part', async () => {
  await writeRoutines(projet, [horaire()])
  const { scheduler, tirs } = ordonnanceur()

  await scheduler.tick(CREATION - HEURE)

  expect(tirs).toEqual([])
})

// --- Création et suppression -----------------------------------------------

test('une routine créée est relue à l’identique', async () => {
  const creee = await addRoutine(projet, {
    cron: '0 9 * * 1',
    prompt: 'Revue du lundi',
  })
  const [relue] = await readRoutines(projet)

  expect(relue?.id).toBe(creee.id)
  expect(relue?.cron).toBe('0 9 * * 1')
  expect(relue?.prompt).toBe('Revue du lundi')
  // Récurrente par défaut : une routine qui ne part qu'une fois est le cas
  // rare, et l'oubli doit tomber du bon côté.
  expect(relue?.recurring).toBe(true)
})

test('une expression illisible est refusée, pas corrigée', async () => {
  // Accepter en silence donnerait une routine indiscernable d'une routine
  // oubliée : son auteur ne l'apprendrait qu'en ne voyant rien se produire.
  await expect(
    addRoutine(projet, { cron: 'tous les lundis', prompt: 'x' }),
  ).rejects.toThrow(/cron/i)
  expect(await readRoutines(projet)).toEqual([])
})

test('une invite vide est refusée', async () => {
  await expect(
    addRoutine(projet, { cron: '0 9 * * *', prompt: '   ' }),
  ).rejects.toThrow()
})

test('la création n’écrase pas les routines existantes', async () => {
  await addRoutine(projet, { cron: '0 9 * * *', prompt: 'Première' })
  await addRoutine(projet, { cron: '0 18 * * *', prompt: 'Seconde' })
  expect((await readRoutines(projet)).map(r => r.prompt)).toEqual([
    'Première',
    'Seconde',
  ])
})

test('la suppression ne retire que la routine visée', async () => {
  const a = await addRoutine(projet, { cron: '0 9 * * *', prompt: 'Garder' })
  const b = await addRoutine(projet, { cron: '0 18 * * *', prompt: 'Retirer' })

  await removeRoutine(projet, b.id)

  expect((await readRoutines(projet)).map(r => r.id)).toEqual([a.id])
})

test('supprimer une routine déjà partie ne lève pas', async () => {
  await expect(removeRoutine(projet, 'inconnue')).resolves.toBeUndefined()
})

test('simultaneous due routines remain claimed across concurrent ticks and restart', async () => {
  await writeRoutines(projet,[horaire(),horaire({id:'r2'}),horaire({id:'once',recurring:false})])
  const {scheduler,tirs}=ordonnanceur()
  await Promise.all([scheduler.tick(CREATION+2*HEURE),scheduler.tick(CREATION+2*HEURE)])
  expect(tirs).toHaveLength(3)
  const restarted=ordonnanceur();await restarted.scheduler.tick(CREATION+2*HEURE+60_000)
  expect(restarted.tirs).toHaveLength(0)
  expect((await readRoutines(projet)).map(t=>t.lastFiredAt)).toEqual([CREATION+2*HEURE,CREATION+2*HEURE])
})

test('pause survives restart, edits preserve identity and resume starts a fresh schedule', async () => {
  const {updateRoutine}=await import('./routinesStore.js')
  await writeRoutines(projet,[horaire()]);await updateRoutine(projet,'r1',{paused:true})
  const {scheduler,tirs}=ordonnanceur();await scheduler.tick(Date.now());expect(tirs).toHaveLength(0)
  await updateRoutine(projet,'r1',{prompt:'Nouveau texte',paused:false})
  const [task]=await readRoutines(projet);expect(task?.id).toBe('r1');expect(task?.prompt).toBe('Nouveau texte')
  await scheduler.tick(Date.now());expect(tirs).toHaveLength(0)
})

test('parallel additions are not lost and corrupt files are preserved', async () => {
  const {writeFile,readFile}=await import('node:fs/promises')
  const {routinesFilePath}=await import('./routinesStore.js')
  await Promise.all(Array.from({length:6},(_,i)=>addRoutine(projet,{cron:'0 * * * *',prompt:String(i)})))
  expect(await readRoutines(projet)).toHaveLength(6)
  await writeFile(routinesFilePath(projet),'broken')
  await expect(addRoutine(projet,{cron:'0 * * * *',prompt:'x'})).rejects.toThrow()
  expect(await readFile(routinesFilePath(projet),'utf8')).toBe('broken')
})

test('history keeps sessions and failures after routine deletion; completion is recorded', async () => {
  const {readRoutineHistory}=await import('./routineHistory.js')
  await writeRoutines(projet,[horaire(),horaire({id:'fail',recurring:false})])
  let finish!:(value:{failed:boolean;cancelled:boolean})=>void
  const completion=new Promise<{failed:boolean;cancelled:boolean}>(resolve=>{finish=resolve})
  const scheduler=new RoutineScheduler(()=>[projet],(_cwd,task)=>{
    if(task.id==='fail')throw Error('Moteur indisponible')
    return {sessionId:'session-fixture',completion}
  })
  await scheduler.tick(CREATION+2*HEURE)
  let history=await readRoutineHistory(projet)
  expect(history.find(r=>r.routineId==='r1')?.sessionId).toBe('session-fixture')
  expect(history.find(r=>r.routineId==='fail')?.error).toContain('Moteur indisponible')
  finish({failed:false,cancelled:false})
  for(let i=0;i<100;i++){history=await readRoutineHistory(projet);if(history.some(r=>r.status==='completed'))break;await Bun.sleep(5)}
  expect(history.some(r=>r.status==='completed')).toBe(true)
  await removeRoutine(projet,'r1');expect(await readRoutineHistory(projet)).toHaveLength(2)
})

test('a running routine does not overlap; missed occurrences coalesce after completion',async()=>{
  await writeRoutines(projet,[horaire()])
  let finish!:(value:{failed:boolean;cancelled:boolean})=>void
  const completion=new Promise<{failed:boolean;cancelled:boolean}>(resolve=>{finish=resolve})
  let count=0
  const scheduler=new RoutineScheduler(()=>[projet],()=>{count++;return count===1?{sessionId:'running',completion}:'next'})
  await scheduler.tick(CREATION+HEURE)
  await scheduler.tick(CREATION+4*HEURE);expect(count).toBe(1)
  finish({failed:false,cancelled:false})
  for(let i=0;i<100&&count===1;i++){await Bun.sleep(5);await scheduler.tick(CREATION+4*HEURE)}
  expect(count).toBe(2)
})
