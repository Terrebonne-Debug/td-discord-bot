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
- Mémorise les `MAX_HISTORY_TURNS` derniers échanges par salon (en mémoire
  uniquement).
- Découpe les réponses longues en plusieurs messages Discord.
- Supprime toutes les mentions dans les réponses du modèle, pour qu'il ne
  puisse pas ping `@everyone`.
- N'autorise qu'une requête en cours par salon, ce qui évite les réponses
  entrelacées.

## Prérequis

- Node.js 20 ou plus récent
- Un jeton de bot Discord
- Une clé API DeepSeek

## Installation

1. Installez les dépendances :

   ```bash
   npm install
   ```

2. Créez le fichier de secrets local si `.env` n'existe pas déjà :

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

   Éditez `.env` et renseignez `DISCORD_TOKEN` et `DEEPSEEK_API_KEY`.
   N'écrasez pas un `.env` existant qui contient déjà de vraies clés.

3. Créez et invitez le bot Discord :

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

4. Démarrez le bot :

   ```bash
   npm start
   ```

## Utilisation

| Déclencheur | Comportement |
| --- | --- |
| `@nom-du-bot comment ça marche ?` | Répond dans le même salon |
| MP envoyé au bot | Répond dans le MP |
| `/q prompt:comment ça marche ?` | Répond via une commande slash |

L'historique de conversation est partagé par tous les membres d'un même salon
et est perdu au redémarrage du processus. Utilisez les MP pour une
conversation privée.

Les prompts et les réponses générées sont envoyés à l'API DeepSeek.
Considérez que les conversations avec le bot quittent votre serveur Discord.

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
| `MAX_HISTORY_TURNS` | `10` | Nombre d'échanges utilisateur/assistant conservés par salon |
| `MAX_PROMPT_CHARS` | `4000` | Longueur maximale acceptée d'un prompt |

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
npm start       # lancer le bot
npm run check   # vérifier la syntaxe des fichiers source
```

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

## Références API

- <https://api-docs.deepseek.com/>
- <https://api-docs.deepseek.com/guides/anthropic_api>
