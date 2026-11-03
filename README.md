# td-discord-bot

Un petit bot Discord qui dialogue avec DeepSeek via son API compatible
Anthropic.

Les valeurs par défaut reprennent la configuration de la session Claude Code
qui a créé ce projet :

- endpoint : `https://api.deepseek.com/anthropic`
- modèle : `deepseek-v4-flash`
- réflexion (thinking) : activée
- effort : `max`
- température : non définie, donc la valeur par défaut de l'API DeepSeek
  s'applique

Tout se modifie dans `.env`, sans toucher au code.

## Fonctionnalités

- Mentionnez le bot dans un salon de serveur, ou envoyez-lui un MP.
- Utilisez la commande slash `/q prompt:<question>`.
- Mémorise les `MAX_HISTORY_TURNS` derniers échanges par salon dans MongoDB.
- En MP, le bot répond sans rien mémoriser.
- Découpe les réponses longues en plusieurs messages Discord.
- Supprime toutes les mentions dans les réponses du modèle, pour qu'il ne
  puisse pas ping `@everyone`.
- N'autorise qu'une requête en cours par salon, ce qui évite les réponses
  entrelacées.

## Prérequis

- Node.js 24 ou plus récent — le code est en TypeScript et Node l'exécute
  nativement (type stripping), sans étape de compilation
- Un jeton de bot Discord
- Une clé API DeepSeek
- MongoDB, fourni ici via Docker Compose (facultatif : sans base, le bot
  fonctionne avec une mémoire volatile)

## Installation

1. Installez les dépendances :

   ```bash
   npm install
   ```

2. Démarrez MongoDB :

   ```bash
   docker compose up -d
   ```

   Le conteneur écoute uniquement sur `127.0.0.1` et ne s'expose pas au
   réseau.

3. Créez le fichier de secrets local si `.env` n'existe pas déjà :

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

   Éditez `.env` et renseignez `DISCORD_TOKEN` et `DEEPSEEK_API_KEY`.
   N'écrasez pas un `.env` existant qui contient déjà de vraies clés.

4. Créez et invitez le bot Discord :

   1. Créez une application sur <https://discord.com/developers/applications>.
   2. Ouvrez **Bot**, créez un jeton et mettez-le dans `DISCORD_TOKEN`.
   3. Sous **Privileged Gateway Intents**, activez **Message Content Intent**.
      Le bot en a besoin pour les messages déclenchés par mention.
   4. Invitez le bot avec les scopes `bot` et `applications.commands` et
      accordez-lui au minimum **View Channels**, **Send Messages**,
      **Read Message History** et **Use Application Commands**.
   5. Facultatif mais recommandé : mettez l'ID de votre serveur dans
      `DISCORD_GUILD_ID`. Les commandes slash de guilde apparaissent
      immédiatement ; les commandes globales peuvent mettre jusqu'à une heure.

5. Démarrez le bot :

   ```bash
   npm start
   ```

## Utilisation

| Déclencheur | Comportement |
| --- | --- |
| `@nom-du-bot comment ça marche ?` | Répond dans le même salon |
| MP envoyé au bot | Répond dans le MP, sans mémoire |
| `/q prompt:comment ça marche ?` | Répond via une commande slash |

Les prompts et les réponses générées sont envoyés à l'API DeepSeek.
Considérez que les conversations avec le bot quittent votre serveur Discord.

## TypeScript

Le projet est entièrement écrit en TypeScript (`src/` et `test/`), avec
`strict` activé, et exécuté directement par Node.js 24 sans build : les
imports conservent leur extension `.ts` et `tsc` ne sert qu'à vérifier les
types (`npm run check`). Seule la syntaxe TypeScript effaçable est utilisée
(pas d'enum, pas de namespace), ce que garantit `erasableSyntaxOnly`.

## Mémoire

La mémoire est stockée dans MongoDB et survit aux redémarrages du bot.

- **Canaux publics** : chaque canal a une mémoire partagée par tous ses
  membres et toujours active, dans la collection `channel_memories`, indexée
  par identifiant de canal.
- **Expiration** : un canal inactif voit sa mémoire supprimée
  `MEMORY_TTL_DAYS` jours après sa dernière activité (30 jours par défaut) —
  l'historique ne dépasse donc jamais cette durée.
- **Messages privés** : le bot répond en MP **sans rien mémoriser** — aucun
  échange privé n'est enregistré ni lu en base de données.
- **Chiffrement au repos** : avec `MEMORY_ENCRYPTION_KEY` définie, chaque
  entrée est scellée en AES-256-GCM (clé de 32 octets hors de la BD, données
  authentifiées liées au canal) : un accès en lecture à la base ne montre que
  de l'hexadécimal. Sans la clé, la mémoire reste en clair et un avertissement
  est journalisé au démarrage. Les entrées en clair antérieures restent
  lisibles ; les nouvelles sont chiffrées et les anciennes sortent d'elles-mêmes
  par la rotation des `MAX_HISTORY_TURNS`.

  Générer la clé : `openssl rand -hex 32`, puis la reporter dans `.env`.
  **Changer la clé rend les entrées existantes illisibles** : elles sont alors
  ignorées (avec un avertissement) jusqu'à leur rotation naturelle, à moins de
  les ré-encrypter à la main.

  Pour lire ce que le bot retient d'un canal (avec la clé) :
  `node scripts/decrypt-memory.ts <channelId>`.

Si MongoDB est injoignable au démarrage, le bot continue avec une mémoire
volatile (perdue au redémarrage).

## Journaux

Les logs sont structurés (JSON dans les fichiers) et ne contiennent **jamais
le contenu des messages**, uniquement des métadonnées : longueurs,
identifiants de canal/utilisateur, durées, niveaux.

- **Console** : format lisible dans un terminal, JSON sinon.
- **Fichiers** (`LOG_DIR`, défaut `./logs`) : `bot-AAAA-MM-JJ.log`, rotation
  quotidienne et dès que `LOG_MAX_SIZE_MB` est atteint. Un balayage quotidien
  (et au démarrage) compresse en `.gz` les rotations terminées et supprime
  les archives plus vieilles que `LOG_RETENTION_DAYS` jours. Le fichier actif
  du jour n'est jamais touché.

Lire une archive : `zcat logs/bot-2026-11-02.log.1.gz`.

## Configuration

| Variable | Défaut | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | requis | Jeton du bot Discord |
| `DEEPSEEK_API_KEY` | requise | Clé API DeepSeek |
| `DISCORD_GUILD_ID` | vide | Enregistre les commandes slash uniquement dans cette guilde. Vide : enregistrement global. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/anthropic` | Endpoint DeepSeek compatible Anthropic |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | Nom du modèle |
| `DEEPSEEK_THINKING` | `enabled` | `enabled` ou `disabled` |
| `DEEPSEEK_EFFORT` | `max` | `low`, `medium`, `high` ou `max` quand la réflexion est activée |
| `DEEPSEEK_MAX_TOKENS` | `8192` | Nombre maximal de jetons de réponse, réflexion comprise |
| `DEEPSEEK_TEMPERATURE` | vide | Facultatif, de `0` à `2` ; ignoré quand la réflexion est activée |
| `DEEPSEEK_TIMEOUT_MS` | `180000` | Délai d'expiration des requêtes en millisecondes |
| `SYSTEM_PROMPT` | intégré | Personnalité/consignes du bot |
| `MAX_HISTORY_TURNS` | `10` | Nombre d'échanges utilisateur/assistant conservés par canal |
| `MAX_PROMPT_CHARS` | `4000` | Longueur maximale acceptée d'un prompt |
| `MONGODB_URI` | vide | URI MongoDB. Vide ou connexion impossible : mémoire volatile (perdue au redémarrage) |
| `MONGODB_DB` | `td-discord-bot` | Nom de la base MongoDB |
| `MONGODB_TIMEOUT_MS` | `5000` | Délai de sélection du serveur MongoDB |
| `MEMORY_TTL_DAYS` | `30` | Supprime les mémoires de canaux N jours après leur dernière activité |
| `MEMORY_ENCRYPTION_KEY` | vide | 64 caractères hexadécimaux (32 octets) chiffrant la mémoire au repos. Vide : mémoire en clair, avec avertissement |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |
| `LOG_DIR` | `./logs` | Dossier des fichiers journalisés |
| `LOG_FILE_ENABLED` | `true` | Active la sortie fichier (rotation + archives) |
| `LOG_MAX_SIZE_MB` | `10` | Taille maximale d'un fichier avant rotation |
| `LOG_RETENTION_DAYS` | `14` | Rétention des archives compressées |

Pour des réponses plus rapides et moins chères, mettez
`DEEPSEEK_THINKING=disabled`. Pour réduire la latence tout en gardant la
réflexion, essayez `DEEPSEEK_EFFORT=high` ou `medium`.

La documentation DeepSeek indique actuellement `deepseek-flash` comme nom
natif du modèle ; `deepseek-v4-flash` reste accepté et correspond à la
configuration de cette session. Modifiez `DEEPSEEK_MODEL` si vous préférez
l'alias natif.

## Gestion des secrets

- `.env` est listé dans `.gitignore` et créé avec le mode `600`.
- `.env.example` documente chaque variable avec des valeurs fictives
  uniquement.
- Les jetons sont lus depuis l'environnement et ne sont jamais affichés par
  le bot.
- L'URI MongoDB peut contenir des identifiants : gardez-la dans `.env` et ne
  la journalisez pas.
- Ne mettez pas de secrets dans `README.md`, les fichiers sources ou
  l'historique de commandes.
- Si un jeton ou une clé est exposé, révoquez-le immédiatement : réinitialisez
  le jeton du bot Discord et révoquez/régénérez la clé API DeepSeek.
- En production, injectez `DISCORD_TOKEN` et `DEEPSEEK_API_KEY` depuis un
  gestionnaire de secrets plutôt que de les garder dans un fichier sur disque.

Vérifiez ce que git s'apprête à versionner avant de committer :

```bash
git status --short
git check-ignore -v .env
```

## Scripts

```bash
npm start             # lancer le bot
npm run check         # vérifier les types de src/ et test/ (tsc --noEmit)
npm test              # tests unitaires, fonctionnels et bout en bout
npm run test:coverage # idem, avec un seuil de couverture de 100 %
```

## Tests et CI

Les tests utilisent le lanceur intégré à Node (`node --test`) et ne nécessitent
aucun compte Discord ni clé DeepSeek :

- `test/unit` : configuration, appels DeepSeek, mémoire, helpers du bot.
- `test/functional` : parcours complets du bot et du démarrage avec des
  dépendances injectées (client, mémoire, modèle, signaux).
- `test/e2e` : vrai client `discord.js` face à une passerelle Discord simulée,
  vrai SDK Anthropic face à un endpoint DeepSeek simulé, et vraie base
  MongoDB. Ces tests vérifient la mémoire partagée des canaux, l'absence de
  toute écriture côté MP et la persistance entre instances.

La base des tests est lue dans `MONGODB_TEST_URI` (par défaut
`mongodb://127.0.0.1:27017`) ; chaque test crée puis supprime sa propre base.
Pour lancer les tests localement :

```bash
docker compose up -d
npm test
npm run test:coverage
```

Le workflow `.github/workflows/ci.yml` s'exécute sur le runner auto-hébergé
portant les étiquettes `self-hosted`, `Linux`, `X64` et `discord-bot`
(le runner `mkII` du dépôt). Il exécute d'abord les vérifications de base
(`npm ci`, `npm run check`), puis les tests complets avec un conteneur
MongoDB isolé sur `127.0.0.1:27018` et des seuils de couverture à 100 %
(lignes, fonctions et branches) sur `src/**`, hors `src/index.ts` (simple
point d'entrée). En parallèle, un job balaye les dépendances du
`package-lock.json` avec [osv-scanner](https://google.github.io/osv-scanner/)
(image `ghcr.io/google/osv-scanner`, version épinglée) : toute vulnérabilité
connue (CVE/GHSA) fait échouer la CI, sauf exception déclarée dans un
`osv-scanner.toml` à la racine.

## Dépannage

- **« Used disallowed intents »** : activez le Message Content Intent dans le
  portail développeur Discord.
- **Commandes slash absentes** : renseignez `DISCORD_GUILD_ID` pour un
  enregistrement immédiat, ou ré-invitez le bot avec le scope
  `applications.commands`.
- **DeepSeek 401** : `DEEPSEEK_API_KEY` est fausse ou a été révoquée.
- **DeepSeek 400** : vérifiez `DEEPSEEK_MODEL` ; l'endpoint configuré ne prend
  peut-être pas en charge ce nom de modèle.
- **Le bot ignore les pings dans les serveurs** : il lui faut le
  **Message Content Intent** et la permission de lire et d'envoyer des
  messages dans ce salon.
- **MongoDB injoignable** : démarrez-le avec `docker compose up -d`, puis
  vérifiez `docker compose logs mongo`. Sans base, le bot fonctionne mais
  avec une mémoire volatile.
- **`/q` absente en MP** : `/q` est soumise à `DISCORD_GUILD_ID` et n'est
  pas disponible en MP quand cette variable est définie. Un MP mentionnant
  le bot reste toutefois pris en charge sans mémoire.

## Références API

- <https://api-docs.deepseek.com/>
- <https://api-docs.deepseek.com/guides/anthropic_api>
