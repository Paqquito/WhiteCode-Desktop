import { Field } from '../ui/Field.js'
import * as React from 'react'
import type { ProviderConfig, GatewayModel } from '../../main/preload.js'

export function OpenAIFields({ config, onApply }: { config: ProviderConfig; onApply: (config: ProviderConfig) => void }) {
  const [address, setAddress] = React.useState(config.openaiBaseUrl ?? '')
  const [key, setKey] = React.useState(config.openaiApiKey ?? '')
  const [model, setModel] = React.useState(config.openaiModel ?? '')
  const [context, setContext] = React.useState(config.openaiContext?.toString() ?? '')
  const [models, setModels] = React.useState<GatewayModel[]>([])
  const [status, setStatus] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  async function probe() {
    setBusy(true); setStatus('')
    try { const result = await window.engine.listOpenAIModels(address.trim(), key); setModels(result.ok ? result.models : []); setStatus(result.ok ? `${result.models.length} modèles publiés. Vérifiez que le modèle choisi accepte les outils.` : result.reason) }
    catch { setStatus('Impossible de consulter le catalogue OpenAI.') }
    finally { setBusy(false) }
  }
  return <form className="settings-section" aria-label="Fournisseur compatible OpenAI" onSubmit={event => {
    event.preventDefault()
    onApply({ ...config, openaiBaseUrl: address.trim(), openaiApiKey: key, openaiModel: model.trim(), openaiContext: context ? Number(context) : undefined })
  }}>
    <h3>API compatible OpenAI</h3>
    <p className="settings-note">Protocole Chat Completions avec appels d’outils. Les échanges vont directement au fournisseur choisi.</p>
    <Field label="Adresse de l’API"><input type="url" required value={address} placeholder="https://serveur.example/v1" onChange={event => setAddress(event.target.value)} /></Field>
    <Field label="Clé API"><input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} /></Field>
    <p className="settings-note">Clé conservée dans le coffre système. Elle peut rester vide pour un serveur local sans authentification.</p>
    <Field label="Identifiant du modèle"><input type="text" required maxLength={500} list="openai-models" value={model} onChange={event => setModel(event.target.value)} /></Field>
    <datalist id="openai-models">{models.map(m => <option key={m.id} value={m.id} />)}</datalist>
    <Field label="Fenêtre de contexte (facultatif)"><input type="number" min={1024} max={10000000} step={1} value={context} onChange={event => setContext(event.target.value)} /></Field>
    <p className="settings-note">Le catalogue standard ne précise pas le contexte ni les capacités. Renseignez la limite publiée par votre fournisseur ; l’estimation préalable des jetons reste approximative.</p>
    <div className="settings-actions"><button type="button" disabled={busy || !address.trim()} onClick={() => void probe()}>{busy ? 'Vérification…' : 'Consulter les modèles'}</button><button type="submit">Enregistrer le fournisseur OpenAI</button></div>
    {status && <p role="status" className="settings-note">{status}</p>}
  </form>
}
