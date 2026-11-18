# Contrat de plugin : connecteur et panneau, version 1

Un paquet de plugin peut ajouter un `connector.json` et un `panel.json`, à côté de son `extension.json` ou de son manifeste hérité `.claude-plugin/plugin.json`. Le paquet est téléchargé depuis un commit Git, validé avant installation, puis activé par l'utilisateur. Le plugin de test `src/main/extensions/fixtures/tickets/` est un exemple complet.

## Connecteur

`connector.json` définit un identifiant stable, un nom, un libellé et une adresse MCP HTTPS. Les comptes statiques déclarent leurs secrets (nom, libellé, en-tête et format ancré), une vérification de compte facultative et des liens relatifs au site annoncé par un compte vérifié. Le rendu ne reçoit jamais la valeur enregistrée d'un secret.

Les endpoints MCP, compte et outils sont des adresses HTTPS et doivent partager la même origine. Les redirections sont refusées. Les secrets d'un autre plugin ne sont pas ajoutés aux requêtes de ce connecteur.

`tools.endpoint` contient `{tool}` et `tools.names` liste les appels directs autorisés. `writeTools` énumère les écritures qui doivent toujours demander confirmation, depuis un panneau comme depuis une session MCP. Le serveur métier garde la responsabilité de vérifier les autorisations réelles.

Une entrée `prepare` concerne une écriture déclarée, désigne un outil de lecture direct et peut fusionner des champs de sa réponse dans la proposition. Une valeur absente ou `null` signifie qu'il n'y a pas de proposition à fusionner : elle laisse les champs manuels intacts. L'outil de préparation ne peut pas figurer dans `writeTools`. Une erreur de préparation bloque l'appel final ; les avertissements sont montrés avec la proposition à confirmer. Un refus humain empêche l'écriture.

## Panneau

`panel.json` contient `version: 1`, `id`, `connector`, `title`, une à huit `views`, un `search` facultatif et un `detail`. Chaque requête indique un outil direct et ses arguments JSON. Une vue décrit le chemin de sa liste et les champs de chaque ligne. Le détail peut contenir des champs, des formulaires et des blocs.

Les textes utilisent des gabarits tels que `#{record.id} {record.subject}`. Les arguments utilisent un objet dédié :

```json
{ "issue_ids": [{ "$path": "record.id" }], "note": { "$path": "form.note" } }
```

Les racines disponibles sont `selection`, `record`, `item` et `form`. Un chemin lit uniquement des propriétés propres, sans prototype ; une donnée obligatoire absente provoque une erreur lisible. Les saisies utilisateur restent littérales, même si elles contiennent des accolades ou du HTML. Aucun `eval`, HTML injecté ou script de panneau n'est exécuté.

Les blocs sont `text`, `fields`, `list`, `group` et `action`. Les actions peuvent préparer un texte dans la conversation, sélectionner une fiche, ouvrir un lien de connecteur ou ouvrir une URL HTTPS sur clic. Un formulaire comporte des champs texte, multiligne, case à cocher ou choix parmi des chaînes annoncées par le service. Les erreurs conservent la saisie ; une action réussie recharge la fiche.

Un connecteur désactivé dans l'application refuse aussi les appels directs de ses panneaux. Après un délai dépassé ou une réponse invalide à une écriture, le résultat reste non confirmé : consulter l'état dans le service avant de réessayer, pour éviter une opération en double.

Les déclarations refusent les champs inconnus et les outils non déclarés. Un paquet apporte au plus un connecteur et un panneau dans cette version. Deux plugins actifs ne peuvent pas apporter le même identifiant de connecteur ou de panneau. L'activation des outils pour le modèle prend effet au prochain message ; les panneaux suivent la liste des plugins actifs.

## Limites et vérifications

- Fichiers JSON de plugin : 2 Mio maximum ; réponses HTTP JSON : 8 Mio maximum.
- Huit secrets et 64 outils au plus par connecteur ; valeurs de secret enregistrées limitées à 4 096 caractères.
- Chemins de données limités à neuf segments ; profondeur des arguments et des blocs bornée.
- Listes principales : 500 lignes maximum. Blocs de détail : budget global de 1 000 blocs et lignes, y compris les listes imbriquées. Un message indique la limitation.
- Le canal du moteur garde ses limites globales de 16 serveurs, 64 outils et 128 Kio de catalogue par conversation.
- Les panneaux déclaratifs n'apportent pas encore OAuth, terminal, téléchargement de pièce jointe, HTML enrichi ni visualisation 3D.

Les tests de `src/main/extensions/` et `PluginPanelBlocks.test.tsx` couvrent ces frontières et les parcours principaux. Les tests de migration utilisent des catalogues Git et des coffres temporaires, sans modifier le profil utilisateur. Un vrai serveur et ses droits doivent être vérifiés lors de la recette de distribution.
