# Modules natifs du desktop

Le build lit la section `desktop` de l’identité validée par le moteur. Les modules natifs ont accès au processus Electron principal. La personne qui construit la distribution en choisit le code et la révision. Le catalogue de plugins installables reste accessible dans les paramètres.

```json
{
  "desktop": {
    "modules": ["gitlab"],
    "extensionCatalogs": [
      { "repository": "https://git.example/team/plugins.git", "ref": "v1.0.0" }
    ]
  }
}
```

Le build cherche chaque identifiant dans `../WhiteCode-Extensions/modules`. L’option répétable `--modules <dossier>` ajoute des dossiers. Une absence ou un doublon arrête la construction. Une identité sans modules produit le desktop seul. Le nom du produit, le profil utilisateur et l’accent proviennent des variables d’identité documentées dans SPEC-CAD-002.

## Contrat de la version 1

Dans chaque dossier de module, `module.json` déclare les points d’entrée et les ressources facultatives.

```json
{ "apiVersion": 1, "main": "main.ts", "renderer": "renderer.tsx", "assets": ["notice.txt"] }
```

- Le processus principal appelle l’export `register(host)` au démarrage. `host.directory` est le dossier privé du module sous le profil du produit. `host.registerIpc(nom, handler)` déclare une opération accessible à l’interface de confiance. Le module valide les arguments et gère les autorisations liées aux écritures.
- Le rendu exporte `views` avec `label`, et éventuellement les composants React `Settings` et `Panel`. Ils reçoivent `call(méthode, arguments)`. Le panneau reçoit aussi le dossier du projet et la fonction de fermeture. Les jetons et les requêtes authentifiées restent dans le processus principal.
- Les ressources déclarées sont copiées sous `dist/modules/<identifiant>/`. Les chemins doivent rester dans le dossier du module.
- Les interfaces TypeScript sont dans [le contrat de modules](packages/desktop-modules/index.d.ts). Le module GitLab du dépôt WhiteCode-Extensions illustre les deux points d’entrée.
- Les catalogues additionnels sont lus via Git et son gestionnaire d’identifiants. Une erreur est affichée avec le catalogue et un lancement ultérieur réessaie. Après une première installation réussie, l’utilisateur peut supprimer la source ou choisir une autre référence.
