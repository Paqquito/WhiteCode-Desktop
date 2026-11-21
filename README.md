# WhiteCode Desktop

WhiteCode Desktop est l’interface graphique du moteur WhiteCode. Elle permet de travailler dans un dépôt, de reprendre une conversation et de vérifier les actions proposées par l’assistant.

## Premier lancement

Installez Git, Node.js avec npm et Bun 1.4.2. Clonez ces trois dépôts dans **le même dossier**. Le desktop utilise le moteur compilé dans `WhiteCode` et récupère son module GitLab dans `WhiteCode-Extensions`.

```sh
git clone https://github.com/Paqquito/WhiteCode.git
git clone https://github.com/Paqquito/WhiteCode-Desktop.git
git clone https://github.com/Paqquito/WhiteCode-Extensions.git
cd WhiteCode
bun install --frozen-lockfile
bun scripts/build.ts --identity identity/whitecode.identity.json --profile public
cd ../WhiteCode-Desktop
npm ci --include=dev
npm start
```

Ouvrez **Paramètres → Fournisseur**. Choisissez votre serveur compatible, une API compatible OpenAI, Ollama ou llama.cpp. Renseignez les paramètres demandés, puis choisissez votre modèle pour la première conversation.

Aux lancements suivants, exécutez simplement `npm start` depuis `WhiteCode-Desktop`. Si votre moteur compilé se trouve ailleurs, créez un fichier `.env.local` ici et indiquez `DESKTOP_ENGINE_DIR=C:/dev/mon-moteur`. Le chemin doit désigner le dossier qui contient `dist/manifest.json`.

## Extensions et personnalisation

Installez les extensions à partir de **Plugins et skills**. Les prérequis de Bureautique et Outlook sont détaillés dans le [catalogue WhiteCode-Extensions](https://github.com/Paqquito/WhiteCode-Extensions#readme).

Le fichier d’identité du moteur détermine le nom, les couleurs, l’icône et les modules du desktop. Pour une autre distribution, compilez le moteur avec son identité et indiquez ce même fichier dans `DESKTOP_IDENTITY` lors de la construction du desktop. Voir le [format des modules natifs](MODULES.md) et le [format des panneaux et connecteurs](PLUGIN_PANELS.md).

## Vérifier ou distribuer le desktop

`npx tsc --noEmit` vérifie les types. `npm test` reconstruit le moteur et l’interface et lance la suite de tests. Les tests de documents nécessitent LibreOffice. `LIBREOFFICE_PATH` permet de désigner une installation portable.

Sous Windows x64, `npm run package:windows` prépare l’application dans `release/`. Distribuez le dossier entier. Pour produire un installeur par utilisateur, indiquez le chemin de `ISCC.exe` dans `INNO_SETUP_COMPILER`.

## Licence

Le desktop est sous [licence MIT](LICENSE). Les [notices des dépendances](THIRD_PARTY_NOTICES.txt) accompagnent l’application. Electron fournit aussi sa licence et les crédits de Chromium. Après une mise à jour des dépendances, régénérez les notices avec `bun ../WhiteCode-Extensions/scripts/dependency-notices.ts . @anthropic-ai/sdk`.
