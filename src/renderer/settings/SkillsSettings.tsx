/**
 * Skills.
 *
 * Un skill est un savoir-faire : des instructions (et parfois des scripts)
 * que le modèle charge quand la demande s'y prête — « rédiger un document
 * Word », « relire du code ». Il n'apporte aucun accès : c'est le rôle des
 * connecteurs. Dans l’application comme chez Claude et ChatGPT, les skills
 * arrivent avec les plugins ; cet écran les montre tous, rangés par plugin,
 * pour répondre à « qu'est-ce que l'IA sait faire ici ? ».
 *
 * L'activation se règle au niveau du plugin, seule unité que le moteur charge
 * ou non : un interrupteur par skill laisserait croire à un réglage qui
 * n'existe pas.
 */

import * as React from 'react'
import type { ExtensionState } from '../../main/preload.js'
import type { useExtensions } from '../state/useExtensions.js'
import { skillNames } from '../catalog/skillNames.js'
import { Group, Row, SettingsPage } from '../ui/SettingRows.js'

type Bucket = { title: string; hint: string; plugins: Array<ExtensionState & { skills: string[] }> }

export function SkillsSettings({ extensions, onManagePlugins }: {
  extensions: ReturnType<typeof useExtensions>
  onManagePlugins: () => void
}): React.ReactNode {
  const [query, setQuery] = React.useState('')
  const needle = query.trim().toLocaleLowerCase()
  const withSkills = extensions.extensions
    .filter(entry => entry.kind === 'plugin' && (entry.skills?.length ?? 0) > 0)
    .map(entry => ({ ...entry, skills: skillNames(entry.skills!).filter(name => !needle || `${name} ${entry.name}`.toLocaleLowerCase().includes(needle)) }))
    .filter(entry => entry.skills.length > 0)
  const buckets: Bucket[] = [
    { title: 'Utilisables', hint: 'Fournis par un plugin activé : le modèle peut s’en servir dans vos conversations.', plugins: withSkills.filter(e => e.installed && e.enabled) },
    { title: 'Plugin désactivé', hint: 'Installés, mais leur plugin est désactivé.', plugins: withSkills.filter(e => e.installed && !e.enabled) },
    { title: 'À installer', hint: 'Disponibles dans le catalogue des plugins.', plugins: withSkills.filter(e => !e.installed) },
  ]
  const total = withSkills.reduce((sum, entry) => sum + entry.skills.length, 0)

  return <SettingsPage
    title="Skills"
    lead="Les savoir-faire que l’IA peut charger quand votre demande s’y prête : rédiger un document Word, relire du code… Ils arrivent avec les plugins, qui les activent ou les désactivent."
    actions={<button type="button" className="ghost" onClick={onManagePlugins}>Gérer les plugins</button>}
  >
    <label className="technical-search">Rechercher un skill<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Nom du skill ou du plugin" /></label>
    {extensions.loading && <p role="status" className="settings-note">Lecture des plugins…</p>}
    {!extensions.loading && total === 0 && <p role="status" className="settings-note">{needle ? 'Aucun skill ne correspond à la recherche.' : 'Aucun skill pour l’instant : installez un plugin qui en apporte.'}</p>}
    {buckets.filter(bucket => bucket.plugins.length > 0).map(bucket => <Group key={bucket.title} title={bucket.title}>
      <p className="setting-group-hint">{bucket.hint}</p>
      {bucket.plugins.map(entry => <Row
        key={entry.id}
        className="skill-plugin"
        title={<>{entry.name}<span className="setting-badge">{entry.skills.length} skill{entry.skills.length > 1 ? 's' : ''}</span></>}
        hint={<ul className="skill-names">{entry.skills.map(name => <li key={name}>{name}</li>)}</ul>}
      />)}
    </Group>)}
  </SettingsPage>
}
