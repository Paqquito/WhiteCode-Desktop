/**
 * Modifier un projet.
 *
 * Deux réglages seulement, et ils n'ont pas le même poids. Le **nom** est
 * cosmétique : il remplace celui du dossier dans la liste, et l'effacer le
 * rend. Les **dossiers sources** changent ce que le moteur peut lire — ils
 * sont repris dans chaque nouvelle conversation ouverte ici, ce qui évite de
 * les redonner à chaque fois.
 *
 * ## « Retirer » n'efface rien, et le dit
 *
 * Le bouton est rouge parce que l'action est notable, pas parce qu'elle est
 * destructrice : elle sort le dossier de la liste, les transcripts restent où
 * le moteur les a écrits. Un bouton rouge qui supprimerait vraiment des
 * conversations n'aurait pas sa place à côté d'un champ de renommage.
 *
 * Sur le `<dialog>` natif, comme Routines et Paramètres depuis D08 : piège de
 * focus, `Esc` et restitution du focus sans rien écrire à la main.
 */

import * as React from 'react'
import type { Project } from '../../main/preload.js'
import type { ProjectMeta } from '../../shared/projectMeta.js'
import { Icon } from '../ui/Icon.js'
import { IconButton } from '../ui/IconButton.js'
import { Field } from '../ui/Field.js'
import { Dialog } from '../ui/Dialog.js'

export function ProjectDialog({
  project,
  onSave,
  onRemove,
  onClose,
}: {
  project: Project
  onSave: (patch: ProjectMeta) => void
  onRemove: () => void
  onClose: () => void
}): React.ReactNode {
  const [name, setName] = React.useState(project.name)
  const [sources, setSources] = React.useState<string[]>(project.sources ?? [])
  const [instructions, setInstructions] = React.useState(project.instructions ?? '')
  const [confirmRemove, setConfirmRemove] = React.useState(false)


  const ajouter = () => {
    void window.engine.chooseWorkspace().then(chosen => {
      if (chosen && !sources.includes(chosen)) setSources(current => [...current, chosen])
    })
  }

  return (
    <Dialog title="Modifier le projet" className="dialog project-dialog" onClose={onClose}>

      <Field
        label="Nom"
        hint={
          name.trim() && name.trim() !== project.derivedName
            ? `Nom du dossier : ${project.derivedName}`
            : 'Vider le champ rend le nom du dossier'
        }
      >
        <input
          type="text"
          value={name}
          placeholder={project.derivedName}
          onChange={event => setName(event.target.value)}
        />
      </Field>

      <Field label="Instructions du projet" hint="Reprises par les nouvelles conversations et les conversations rouvertes après un redémarrage. Les conversations déjà ouvertes gardent leurs consignes.">
        <textarea value={instructions} maxLength={16000} rows={4} placeholder="Par exemple : répondre en français, utiliser les conventions du projet…" onChange={event => setInstructions(event.target.value)} />
      </Field>
      <div className="project-sources">
        <p className="field-label">Dossiers sources</p>
        <p className="hint">
          Ajoutés aux dossiers accessibles de chaque nouvelle conversation
          ouverte dans ce projet. Le dossier du projet lui-même est toujours
          accessible, il n’a pas à figurer ici.
        </p>

        {sources.map(source => (
          <div className="project-source" key={source}>
            <Icon name="folder" size={13} />
            <code>{source}</code>
            <IconButton
              icon="close"
              size={12}
              title="Retirer ce dossier"
              label={`Retirer ${source}`}
              onClick={() => setSources(current => current.filter(s => s !== source))}
            />
          </div>
        ))}

        <button type="button" className="ghost project-add" onClick={ajouter}>
          <Icon name="plus" size={13} />
          <span>Ajouter un dossier…</span>
        </button>
      </div>

      {confirmRemove && (
        <p className="dialog-hint" role="alert">
          Le projet sort de la liste. Ses conversations ne sont pas effacées :
          elles restent sur le disque et reviendront si une nouvelle
          conversation s’ouvre dans ce dossier.
        </p>
      )}

      <div className="dialog-actions">
        {confirmRemove ? (
          <>
            <button type="button" className="danger" onClick={onRemove}>
              Confirmer le retrait
            </button>
            <button type="button" onClick={() => setConfirmRemove(false)}>
              Conserver
            </button>
          </>
        ) : (
          <button type="button" className="danger" onClick={() => setConfirmRemove(true)}>
            Retirer le projet
          </button>
        )}
        <span className="dialog-spacer" />
        <button type="button" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => onSave({ name, sources, instructions })}
        >
          Enregistrer
        </button>
      </div>
    </Dialog>
  )
}
