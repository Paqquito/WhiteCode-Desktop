# WhiteCode Desktop

Application de bureau de WhiteCode, l'agent de programmation en marque blanche. L'interface Electron pilote l'exécutable du moteur par son protocole public JSONL : réponses progressives, outils, permissions, questions, annulation, reprise des conversations et restauration des fichiers.

## Marque blanche

Le nom, les dossiers, les variables d'environnement, le schéma d'URL, la couleur d'accent et l'icône viennent du **fichier d'identité** du moteur (spécification SPEC-CAD-002). Sans identité particulière, c'est `identity/whitecode.identity.json` : noir, blanc et gris, et un carré noir comme icône.

- Le nom du produit et la couleur sont figés dans le bundle de l'interface au build (`__BRAND__`).
- L'icône `ICON` de l'identité accepte le PNG et le SVG. En son absence, le build génère un carré noir.
- `dist/distribution.json` porte les noms techniques lus par le processus principal.

## Démarrer

Prérequis : Node.js avec npm, Bun 1.4.2, le catalogue WhiteCode-Extensions (pour le module GitLab par défaut) et le dépôt du moteur `WhiteCode` à côté de celui-ci (ou désigné par `DESKTOP_ENGINE_DIR`).

```bash
# Dans le dépôt du moteur
bun install --frozen-lockfile
bun scripts/build.ts --identity identity/whitecode.identity.json --profile public

# Dans ce dépôt
npm ci --include=dev --no-audit --no-fund
npm start
```

Pour une autre marque, construisez le moteur avec son identité, puis le desktop avec `DESKTOP_IDENTITY=<chemin du fichier d'identité>`.

## Modules et distribution Windows

L’identité WhiteCode active le module GitLab du dépôt voisin WhiteCode-Extensions. Ses réglages permettent de vérifier le compte et son panneau affiche les demandes de fusion ouvertes. Pour compiler sans module natif, utilisez une identité avec une liste de modules vide. Le format, les catalogues additionnels et les points d’entrée sont décrits dans [MODULES.md](MODULES.md).

Sur Windows x64, après le build du moteur et du desktop avec la même identité, lancez `npm run package:windows`. Le dossier créé sous `release/` contient l’exécutable de bureau, le moteur et le terminal natif. Distribuez le dossier entier. Si `INNO_SETUP_COMPILER` désigne `ISCC.exe`, la commande produit aussi un installeur par utilisateur. Les profils se trouvent dans `%APPDATA%\<slug>-desktop` et le moteur utilise les emplacements de l’identité.

## Fournisseurs

Aucun fournisseur n'est configuré par défaut. Paramètres → Fournisseur propose :

- un serveur d'inférence compatible avec le protocole Messages du moteur (adresse et jeton facultatif) ;
- une API compatible OpenAI (Chat Completions), par un pont local ;
- Ollama, par un pont local ;
- llama.cpp, avec les modèles GGUF de ce poste.

Les secrets restent dans le processus principal et le coffre du système ; le moteur ne reçoit qu'une clé locale éphémère.

## Plugins et connecteurs

Le catalogue par défaut est [WhiteCode-Extensions](https://github.com/Paqquito/WhiteCode-Extensions). Un plugin peut apporter des skills, des agents, un connecteur MCP HTTPS (`connector.json`) et un panneau déclaratif (`panel.json`) : voir [PLUGIN_PANELS.md](PLUGIN_PANELS.md). Les écritures déclarées par un connecteur demandent toujours une confirmation humaine.

## Vérifications

```bash
npx tsc --noEmit
npm test
```

`npm test` reconstruit le moteur et l'interface puis lance toute la suite, sans en ignorer. Git et LibreOffice sont nécessaires (`LIBREOFFICE_PATH` peut désigner une installation portable).
