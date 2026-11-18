/**
 * Espace de travail et inventaire des projets.
 *
 * Les deux sont indissociables : changer de répertoire change la liste des
 * sessions pertinentes, et ouvrir une session d'un autre projet change le
 * répertoire. Les tenir dans un seul état évite qu'ils se désynchronisent.
 */

import * as React from 'react'
import type { Project } from '../../main/preload.js'

export function useWorkspace() {
  const [workspace, setWorkspace] = React.useState('')
  const [projects, setProjects] = React.useState<Project[]>([])
  const [loading, setLoading] = React.useState(true)

  const refresh = React.useCallback(async () => {
    setLoading(true)
    try {
      setProjects(await window.engine.listProjects())
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void window.engine.defaultWorkspace().then(setWorkspace)
    void refresh()
  }, [refresh])

  /**
   * Relecture au retour dans la fenêtre.
   *
   * La liste ne se remplissait qu'au démarrage et en fin de tour. Un tour
   * interrompu — parce qu'on a ouvert une autre session, ou fermé
   * l'application — n'atteignait jamais cette fin : la conversation existait
   * sur le disque, mais restait invisible jusqu'au prochain redémarrage.
   */
  React.useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const choose = React.useCallback(async (): Promise<string | null> => {
    const chosen = await window.engine.chooseWorkspace()
    if (chosen) {
      setWorkspace(chosen)
      void refresh()
    }
    return chosen
  }, [refresh])

  /**
   * Projet correspondant au répertoire courant.
   *
   * Comparaison insensible à la casse et au séparateur : le moteur consigne
   * `E:\users\…` là où le sélecteur de dossier rend `E:/users/…`, et les
   * deux désignent le même endroit.
   */
  const current = React.useMemo(() => {
    const norm = (p: string) => p.replace(/[\\/]+/g, '/').toLowerCase()
    return projects.find(p => norm(p.cwd) === norm(workspace)) ?? null
  }, [projects, workspace])

  return { workspace, setWorkspace, projects, current, loading, refresh, choose }
}
