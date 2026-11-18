import { usePreferences } from '../state/usePreferences.js'
import { sendsMessage } from '../../shared/preferences.js'
/**
 * Zone de saisie.
 *
 * Une carte unique : pièces jointes en haut, texte au milieu, réglages et
 * envoi en pied. Ce n'est pas qu'une affaire de dessin — mode de permission,
 * modèle et effort se décident au moment d'écrire, pas dans un panneau de
 * préférences qu'on ouvrirait à part. Les mettre là où l'on tape, c'est les
 * rendre relisibles d'un coup d'œil avant d'appuyer sur Entrée.
 *
 * Trois voies d'ajout de pièces jointes, parce qu'aucune ne couvre les
 * autres : le dépôt depuis l'explorateur, le sélecteur, et le collage — une
 * capture d'écran n'existe que dans le presse-papier, elle n'a pas de chemin
 * sur le disque.
 */

import * as React from 'react'
import type { Attachment, Corpus, ExtensionState } from '../../main/preload.js'
import type { EffortLevel, PermissionMode, SessionStatus } from '#desktop/session-protocol'
import { EFFORTS, PERMISSION_MODES } from '../state/useSettings.js'
import { ADD_MODEL } from '#desktop/model-choice'
import { useDraft } from '../state/useDraft.js'
import { Icon } from '../ui/Icon.js'
import { Menu, type MenuOption } from '../ui/Menu.js'
import { ContextGauge } from './ContextGauge.js'
import {
  CommandPicker,
  findMention,
  MentionPicker,
  type MentionEntry,
} from './MentionPicker.js'
import { PlusMenu } from './PlusMenu.js'
import { useCompletion } from './useCompletion.js'
import { useFileDrop } from './useFileDrop.js'
import type { Tab as SettingsTab } from '#desktop/settings-dialog'

export function Composer({
  sessionId,
  transcriptId,
  liveSessionIds,
  chat,
  context,
  permission,
  preparing = false,
  attachmentError,
  supportsImages,
  busy,
  disabled,
  empty = false,
  queued = [],
  queuePaused = false,
  onUnqueue,
  onResumeQueue,
  attachments,
  workspace,
  corpora,
  extensions,
  models,
  showEffort,
  reasoningToggle,
  seed,
  settings,
  status,
  onSubmit,
  onInterrupt,
  onDropFiles,
  onPasteFiles,
  onPickFiles,
  onRemoveAttachment,
  onOpenAttachment,
  onToggleCorpus,
  onToggleExtension,
  onOpenSettings,
  onOpenCatalog,
  onPermissionMode,
  onModel,
  onEffort,
}: {
  sessionId: string | null
  liveSessionIds?: readonly string[]
  transcriptId?: string | null
  chat?: boolean
  context?: React.ReactNode
  permission?: React.ReactNode
  preparing?: boolean
  attachmentError?: string
  supportsImages?: boolean
  busy: boolean
  disabled: boolean
  /** Conversation sans message : l'invite propose de décrire une tâche, sinon de répondre. */
  empty?: boolean
  /**
   * Messages écrits pendant une réponse, envoyés un à un quand elle se
   * termine. Après une interruption ou un échec, la file se met en pause :
   * l'utilisateur vient de reprendre la main, rien ne doit partir sans lui.
   */
  queued?: readonly string[]
  queuePaused?: boolean
  onUnqueue?: (index: number) => void
  onResumeQueue?: () => void
  attachments: Attachment[]
  /** Espace de travail : racine des chemins proposés par la mention « @ ». */
  workspace: string
  corpora: Corpus[]
  extensions: ExtensionState[]
  /**
   * Modèles proposés, calculés d'après le fournisseur actif.
   *
   * Sous Ollama, les alias d'Anthropic n'ont aucun sens : le pont emploie le
   * modèle local choisi et ignore ce que le moteur demande. La liste doit donc
   * refléter ce qui tournera réellement.
   */
  models: Array<MenuOption<string | null>>
  /** Faux pour un modèle sans réflexion étendue : le réglage est alors masqué. */
  showEffort: boolean
  /**
   * Modèle local `llama-server` : le réglage n'est pas un effort gradué mais un
   * simple on/off de la réflexion (seul levier qui agit localement). Le bouton
   * bascule alors « Réflexion : oui/non » au lieu des quatre niveaux. « non »
   * réutilise le niveau `low`, que le fournisseur traduit en `--reasoning off`.
   */
  reasoningToggle?: boolean
  /**
   * Texte à replacer dans la zone de saisie.
   *
   * Le compteur, et non le texte, déclenche la reprise : réutiliser deux fois
   * le même message doit fonctionner, et une comparaison sur le texte seul
   * ignorerait le second clic.
   */
  seed: { text: string; nonce: number } | null
  settings: {
    permissionMode: PermissionMode
    model: string | null
    effort: EffortLevel | null
  }
  status: SessionStatus
  onSubmit: (text: string) => void
  onInterrupt: () => void
  onDropFiles: (files: FileList) => void
  onPasteFiles: (files: File[]) => void
  onPickFiles: () => void
  onRemoveAttachment: (path: string) => void
  onOpenAttachment: (item: Attachment) => void
  onToggleCorpus: (id: string, enabled: boolean) => void
  onToggleExtension: (id: string, enabled: boolean) => void
  onOpenCatalog?: () => void
  onOpenSettings: (tab: SettingsTab) => void
  onPermissionMode: (mode: PermissionMode) => void
  onModel: (model: string | null) => void
  onEffort: (effort: EffortLevel | null) => void
}): React.ReactNode {
  const { draft, setDraft, recovered, recover, saveFailed } = useDraft(sessionId, transcriptId ?? null, workspace, liveSessionIds, chat)
  const appliedSeeds = React.useRef(new Set<number>())

  // Reprise d'un message envoyé : le texte revient dans la zone, curseur en
  // fin, prêt à être corrigé.
  React.useEffect(() => {
    if (!seed || appliedSeeds.current.has(seed.nonce)) return
    appliedSeeds.current.add(seed.nonce)
    setDraft(seed.text)
    const area = areaRef.current
    if (area) {
      area.focus()
      window.requestAnimationFrame(() => {
        area.selectionStart = area.selectionEnd = area.value.length
      })
    }
  }, [seed])
  const areaRef = React.useRef<HTMLTextAreaElement>(null)
  const drop = useFileDrop(onDropFiles)
  const completion = useCompletion({
    draft,
    setDraft,
    areaRef,
    workspace,
    commands: status.commands,
    sessionId,
  })

  React.useEffect(() => {
    drop.reset()
    // `completion` se remet à plat de lui-même : il connaît la session.
  }, [sessionId, drop.reset])

  const invalidImages = supportsImages === false && attachments.some(a => a.kind === 'image')
  const rejectedFiles = attachments.some(a => a.kind === 'rejected')
  const canSend = Boolean(draft.trim()) && !disabled && !preparing && !invalidImages && !rejectedFiles
  const submit = () => {
    // Pendant une réponse, le message n'est pas refusé : la cellule le met en
    // file d'attente et l'enverra à la fin.
    if (!canSend) return
    onSubmit(draft.trim() || 'Fais le compte rendu des enregistrements joints.')
    setDraft('')
    completion.reset()
  }

  const pickCommand = React.useCallback(
    (name: string) => {
      // Une espace derrière : la plupart des commandes prennent un argument,
      // et l'utilisateur enchaîne sans avoir à l'ajouter.
      setDraft(`/${name} `)
      areaRef.current?.focus()
    },
    [],
  )

  const personal = usePreferences()
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (completion.handleKey(event)) return
    // Entrée envoie, Maj+Entrée insère un saut de ligne — la convention des
    // messageries, et celle du terminal.
    if (sendsMessage({ ...event, isComposing: event.nativeEvent.isComposing }, personal.value.sendMode)) {
      event.preventDefault()
      submit()
    }
  }

  /**
   * Collage.
   *
   * Le presse-papier peut porter à la fois du texte et une image — une capture
   * copiée depuis un navigateur, par exemple. On n'intercepte que s'il y a un
   * fichier, sinon le collage de texte ordinaire cesserait de fonctionner.
   */
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    onPasteFiles(files)
  }

  // Hauteur suivant le contenu, jusqu'à huit lignes : un message court ne doit
  // pas réserver l'espace d'un long, ni un long forcer à défiler dans trois
  // lignes.
  React.useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, 220)}px`
  }, [draft])

  const modeLabel =
    PERMISSION_MODES.find(m => m.id === settings.permissionMode)?.label ??
    'Auto'
  const modelLabel =
    models.find(m => m.id === settings.model)?.label ?? 'Défaut'
  // Aucun modèle réel dans la liste : seulement un message d'état (id nul) et,
  // parfois, « + Ajouter ». Le sélecteur devient alors un accès direct au
  // réglage qui débloque la situation.
  const noModel = !models.some(m => m.id !== null && m.id !== ADD_MODEL)
  const placeholder = busy ? 'Message suivant : il partira à la fin de la réponse' : empty ? 'Décrivez une tâche' : 'Répondre…'
  const effortLabel = reasoningToggle
    ? settings.effort === 'low'
      ? 'Réflexion : non'
      : 'Réflexion : oui'
    : (EFFORTS.find(e => e.id === settings.effort)?.label ?? 'Auto')

  // Modèle local : le seul réglage qui agit est on/off (voir la prop). On
  // réutilise le champ `effort` — `null` = réflexion, `low` = coupée — pour ne
  // pas ajouter un second état de session en parallèle.
  const effortOptions: Array<MenuOption<EffortLevel | null>> = reasoningToggle
    ? [
        {
          id: null,
          label: 'Réflexion : oui',
          hint: 'Le modèle réfléchit avant de répondre',
        },
        {
          id: 'low',
          label: 'Réflexion : non',
          hint: 'Réponse directe, plus rapide (relance le serveur local)',
        },
      ]
    : [
        { id: null, label: 'Auto', hint: 'L’effort par défaut du moteur' },
        ...EFFORTS,
      ]

  return (
    <div className="composer">
      {context}
      {saveFailed && <p role="alert">Le brouillon reste dans cette fenêtre, mais son enregistrement sur disque a échoué.</p>}
      {recovered.length > 0 && <details className="draft-recovery"><summary>Brouillons enregistrés ({recovered.length})</summary><p>{draft.trim() ? 'Ajouter au brouillon actuel :' : 'Reprendre dans cette conversation :'}</p>{recovered.map(item => <button type="button" key={item.id} onClick={() => recover(item)} title={item.text}>{item.text.slice(0, 90)}</button>)}</details>}
      {attachmentError && <p role="alert">{attachmentError}</p>}
      {invalidImages && <p role="alert">Ce modèle ne lit pas les images. Choisissez un modèle compatible ou retirez les images pour envoyer.</p>}
      {supportsImages === undefined && attachments.some(a => a.kind === 'image') && <p className="composer-preparing">La prise en charge des images n’est pas renseignée par ce fournisseur.</p>}
      {rejectedFiles && <p role="alert">Retirez les fichiers refusés avant d’envoyer. Leur contenu ne sera pas transmis.</p>}
      {preparing && <p className="composer-preparing" role="status">Préparation des fichiers…</p>}
      <div
        className={drop.over ? 'composer-card drop-target' : 'composer-card'}
        {...drop.handlers}
      >
        {!permission && completion.command !== null && completion.commandMatches.length > 0 && (
          <CommandPicker
            names={completion.commandMatches}
            active={completion.highlight % completion.commandMatches.length}
            onPick={completion.pick}
            onHover={completion.setHighlight}
          />
        )}

        {!permission && completion.mention && (
          <MentionPicker
            entries={completion.matches}
            active={completion.highlight}
            onPick={completion.insert}
            onHover={completion.setHighlight}
          />
        )}

        {queued.length > 0 && (
          <div className="composer-queue" role="group" aria-label="Messages en file d’attente">
            <p className="composer-queue-head">
              {queuePaused
                ? 'File en pause : la dernière réponse n’a pas abouti.'
                : `${queued.length} message${queued.length > 1 ? 's' : ''} en attente de la fin de la réponse`}
              {queuePaused && !busy && onResumeQueue && <button type="button" className="ghost" onClick={onResumeQueue}>Envoyer le suivant</button>}
            </p>
            <ol>
              {queued.map((text, index) => (
                <li key={index}>
                  <Icon name="history" size={12} />
                  <span title={text}>{text}</span>
                  {onUnqueue && <button type="button" className="icon-button" aria-label={`Retirer « ${text.slice(0, 40)} » de la file`} title="Retirer de la file" onClick={() => onUnqueue(index)}><Icon name="close" size={12} /></button>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map(item => (
              <AttachmentChip
                key={item.path}
                item={item}
                onOpen={() => onOpenAttachment(item)}
                onRemove={() => onRemoveAttachment(item.path)}
              />
            ))}
          </div>
        )}

        {permission ?? <textarea
          ref={areaRef}
          aria-label="Message"
          value={draft}
          onChange={event => {
            setDraft(event.target.value)
            completion.sync(event.target.value, event.target.selectionStart ?? 0)
          }}
          // La mention dépend de la position du curseur, pas seulement du
          // texte : cliquer ailleurs dans la phrase doit la refermer.
          onSelect={event => {
            const area = event.currentTarget
            completion.sync(area.value, area.selectionStart ?? 0)
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={1}
          disabled={disabled}
        />}

        <div className="composer-tools">
          <PlusMenu
            corpora={corpora}
            extensions={extensions}
            disabled={disabled}
            onPickFiles={onPickFiles}
            onToggleCorpus={onToggleCorpus}
            onToggleExtension={onToggleExtension}
            onOpenSettings={onOpenSettings}
            onOpenCatalog={onOpenCatalog}
          />

          <Menu
            numbered
            label={modeLabel}
            options={PERMISSION_MODES}
            value={settings.permissionMode}
            title="Mode"
            onChange={onPermissionMode}
          />

          <div className="composer-spacer" />

          {personal.value.contextGauge && <ContextGauge status={status} />}

          {noModel ? (
            <button
              type="button"
              className="composer-model-missing"
              title={models[0]?.hint ?? models[0]?.label}
              onClick={() => onOpenSettings(models.some(m => m.id === ADD_MODEL) ? 'models' : 'provider')}
            >
              Choisir un modèle
            </button>
          ) : (
            <Menu
              label={modelLabel}
              options={models}
              value={settings.model}
              title="Modèle"
              align="right"
              onChange={onModel}
            />
          )}

          {/* Masqué sur un modèle sans réflexion étendue : la passerelle
              écarte le paramètre avant l'appel, et le bouton laisserait croire
              à un réglage qui n'agit sur rien. */}
          {showEffort && (
            <Menu
              label={effortLabel}
              options={effortOptions}
              value={settings.effort}
              title={
                reasoningToggle
                  ? 'Réflexion du modèle — coupée = réponse directe, plus rapide'
                  : 'Effort — plus rapide ou plus fouillé'
              }
              align="right"
              onChange={onEffort}
            />
          )}

          {/* Pendant une réponse : Arrêter reste toujours là — c'est le seul
              arrêt de l'interface — et Envoyer devient « mettre en file »
              dès qu'un message est écrit. */}
          {busy && canSend && (
            <button
              type="button"
              className="composer-action primary"
              onClick={submit}
              title="Envoyer à la fin de la réponse"
              aria-label="Mettre le message en file d’attente"
            >
              <Icon name="send" size={14} />
            </button>
          )}
          {busy ? (
            <button
              type="button"
              className="composer-action danger"
              onClick={onInterrupt}
              title="Arrêter la réponse"
              aria-label="Arrêter la réponse"
            >
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button
              type="button"
              className="composer-action primary"
              onClick={submit}
              disabled={!canSend}
              title="Envoyer"
              aria-label="Envoyer le message"
            >
              <Icon name="send" size={14} />
            </button>
          )}
        </div>

        {drop.over && (
          <div className="drop-hint">Déposez pour joindre au message</div>
        )}
      </div>
    </div>
  )
}

function AttachmentChip({
  item,
  onOpen,
  onRemove,
}: {
  item: Attachment
  onOpen: () => void
  onRemove: () => void
}): React.ReactNode {
  const rejected = item.kind === 'rejected'
  const detail = rejected
    ? item.reason === 'too-large'
      ? 'trop volumineux'
      : item.reason === 'unsupported'
        ? 'format non pris en charge'
        : 'illisible'
    : item.kind === 'image'
      ? 'image'
      : item.truncated
          ? 'texte, tronqué'
          : 'texte'

  // Une image est montrée, pas décrite : la vignette dit en un coup d'œil ce
  // qu'aucun nom de fichier ne dira. Le reste garde une icône.
  const thumbnail =
    item.kind === 'image' ? (
      <img
        className="chip-thumb"
        src={`data:${item.mediaType};base64,${item.data}`}
        alt=""
      />
    ) : (
      <Icon name="file" size={13} />
    )

  return (
    <span className={rejected ? 'chip rejected' : 'chip'} title={item.path}>
      {item.kind === 'image' || item.kind === 'text' ? (
        <button
          type="button"
          className="chip-open"
          onClick={onOpen}
          title={item.kind === 'image' ? 'Agrandir' : 'Lire le contenu joint'}
          aria-label={`${item.kind === 'image' ? 'Agrandir' : 'Lire'} ${item.name}`}
        >
          {thumbnail}
        </button>
      ) : (
        thumbnail
      )}
      <span className="chip-name">{item.name}</span>
      <span className="chip-detail">{detail}</span>
      <button
        type="button"
        className="chip-remove"
        onClick={onRemove}
        title="Retirer"
        aria-label={`Retirer ${item.name}`}
      >
        <Icon name="close" size={11} />
      </button>
    </span>
  )
}
