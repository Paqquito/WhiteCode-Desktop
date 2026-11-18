/**
 * Corpus documentaires.
 *
 * Un corpus est un dossier indexé, exposé au modèle comme **outil de
 * recherche**. Rien n'est injecté d'office dans la conversation : le modèle
 * décide d'aller chercher, comme il décide de lire un fichier. C'est ce qui
 * permet d'en garder plusieurs actifs sans payer leur taille à chaque tour.
 *
 * L'écran dit franchement ce que l'indexation coûte — un environnement Python,
 * plusieurs minutes au premier passage. Le découvrir après avoir cliqué serait
 * une mauvaise surprise ; le lire avant est un choix informé.
 */

import * as React from 'react'
import { SettingsPage } from '../ui/SettingRows.js'
import { Field } from '../ui/Field.js'
import type { Corpus } from '../../main/preload.js'
import type { useCorpora } from '../state/useCorpora.js'
import { IconButton } from '../ui/IconButton.js'

export function CorpusSettings({
  corpora,
}: {
  corpora: ReturnType<typeof useCorpora>
}): React.ReactNode {
  const [name, setName] = React.useState('')
  const [source, setSource] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [heavy, setHeavy] = React.useState(false)

  const submit = async () => {
    if (!name.trim() || !source) return
    // Le modèle lourd est celui d'Agentic Manager : nettement meilleur en
    // multilingue, mais il entraîne torch et plusieurs gigaoctets.
    if (!await corpora.create(name.trim(), source, heavy ? 'BAAI/bge-m3' : '')) return
    setName('')
    setSource('')
  }

  return (
    <SettingsPage title="Bases de connaissances" lead="Des dossiers de documents indexés sur ce poste (RAG). Activez une base dans la conversation : l’IA y cherche d’elle-même ce qui l’aide à répondre.">
      {(error || corpora.error) && <p role="alert" className="settings-error">{error || corpora.error}</p>}
      <details className="guide">
        <summary>Comment ça marche</summary>
        <div className="guide-body">
          <p>
            Un corpus est un dossier <strong>indexé</strong> : son texte est
            découpé en fragments, chacun converti en vecteur. Le modèle reçoit
            alors des outils de recherche et décide seul d’aller y puiser. Rien
            n’est ajouté d’office à la conversation — c’est ce qui permet d’en
            garder plusieurs actifs sans alourdir chaque message.
          </p>

          <h4>Formats lus</h4>
          <p>
            Texte et code sous toutes leurs formes (<code>.txt</code>,{' '}
            <code>.md</code>, <code>.csv</code>, <code>.json</code>,{' '}
            <code>.yaml</code>, sources de tous langages), les notebooks{' '}
            <code>.ipynb</code>, ainsi que <code>.pdf</code> et{' '}
            <code>.docx</code>.
          </p>
          <p>
            Les formats fermés ne le sont pas : un bloc-notes{' '}
            <strong>OneNote</strong> (<code>.one</code>), un message Outlook
            (<code>.msg</code>), une image sans texte. Il faut les exporter
            d’abord — OneNote sait exporter une section en PDF ou en Word — puis
            indexer le dossier d’export.
          </p>

          <h4>Marche à suivre</h4>
          <ol>
            <li>Rassembler les documents dans un dossier.</li>
            <li>Le déclarer ici, puis lancer l’indexation.</li>
            <li>
              Cocher le corpus dans le menu <strong>+</strong> du champ de
              saisie pour qu’il compte dans la conversation.
            </li>
          </ol>

          <h4>Ce que ça coûte</h4>
          <p>
            La première indexation crée un environnement Python dédié — quelques
            centaines de mégaoctets, installés une seule fois. Les suivantes
            sont incrémentales : seuls les fichiers modifiés depuis sont
            réencodés.
          </p>
        </div>
      </details>

      {!corpora.ready && (
        <p className="settings-note">
          L’environnement Python n’est pas encore installé. Il le sera au
          premier lancement d’indexation.
        </p>
      )}

      {corpora.corpora.length > 0 && (
        <div className="corpus-list">
          {corpora.corpora.map(corpus => (
            <CorpusRow
              key={corpus.id}
              corpus={corpus}
              activity={corpora.activity[corpus.id]}
              onIndex={() => void corpora.index(corpus.id)}
              onToggle={value => void corpora.setEnabled(corpus.id, value)}
              onRemove={() => void corpora.remove(corpus.id)}
            />
          ))}
        </div>
      )}

      <section className="settings-section">
        <h3>Nouvelle base de connaissances</h3>

        <Field
          label="Nom"
          hint="Vous pouvez renommer cette base plus tard. Son identifiant restera le même."
        >
          <input
            type="text"
            value={name}
            placeholder="Documentation du projet"
            onChange={e => setName(e.target.value)}
          />
        </Field>

        <Field label="Dossier à indexer">
          <div className="field-row">
            <input type="text" value={source} readOnly placeholder="Aucun dossier" />
            <button
              type="button"
              className="ghost"
              onClick={() => {
                void window.engine.chooseCorpusSource().then(chosen => {
                  if (chosen) setSource(chosen)
                }).catch(error => setError(String(error)))
              }}
            >
              Parcourir…
            </button>
          </div>
        </Field>

        <label className="toggle">
          <input
            type="checkbox"
            checked={heavy}
            onChange={e => setHeavy(e.target.checked)}
          />
          <span>
            Encodage multilingue de qualité supérieure
            <span className="field-hint">
              Modèle <code>BAAI/bge-m3</code> : meilleur sur du français et des
              documents mêlant les langues, mais il installe PyTorch — plusieurs
              gigaoctets. Sans lui, l’encodeur léger fourni avec la base suffit
              pour de la recherche documentaire.
            </span>
          </span>
        </label>

        <div className="settings-actions">
          <button
            type="button"
            className="primary"
            disabled={!name.trim() || !source}
            onClick={() => void submit()}
          >
            Créer
          </button>
        </div>
      </section>
    </SettingsPage>
  )
}

function CorpusRow({
  corpus,
  activity,
  onIndex,
  onToggle,
  onRemove,
}: {
  corpus: Corpus
  activity: { message: string; ratio: number | null; failed: boolean; running: boolean } | undefined
  onIndex: () => void
  onToggle: (enabled: boolean) => void
  onRemove: () => void
}): React.ReactNode {
  const indexed = corpus.indexedAt !== null

  return (
    <section className="corpus">
      <div className="corpus-head">
        <label className="toggle inline">
          <input
            type="checkbox"
            checked={corpus.enabled}
            // Activer un corpus jamais indexé exposerait au modèle des outils
            // qui ne rendent rien — il en conclurait que le corpus est vide.
            disabled={!indexed}
            onChange={e => onToggle(e.target.checked)}
          />
          <span className="corpus-name">{corpus.name}</span>
        </label>

        <span className="corpus-meta">
          {indexed
            ? `${corpus.documents} document(s) · ${corpus.chunks} fragments`
            : 'jamais indexé'}
        </span>

        <button
          type="button"
          className="ghost"
          onClick={onIndex}
          disabled={activity?.running}
        >
          {activity?.running ? 'Indexation…' : indexed ? 'Réindexer' : 'Indexer'}
        </button>
        <IconButton icon="close" size={13} onClick={onRemove} title="Supprimer le corpus et sa base" label={`Supprimer ${corpus.name}`} />
      </div>

      <div className="corpus-source" title={corpus.source}>
        {corpus.source}
      </div>

      {activity && (
        <div className={activity.failed ? 'corpus-activity failed' : 'corpus-activity'}>
          {activity.ratio !== null && !activity.failed && (
            <span className="corpus-bar">
              <span
                className="corpus-fill"
                style={{ width: `${Math.round(activity.ratio * 100)}%` }}
              />
            </span>
          )}
          <span className="corpus-message">{activity.message}</span>
        </div>
      )}
    </section>
  )
}
