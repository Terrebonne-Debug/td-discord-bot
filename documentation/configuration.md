# Configuration

Toute la configuration vient de l'environnement (fichier `.env`, chargé par
`dotenv`). `ConfigLoader.load()` la lit et la valide au démarrage : une valeur
requise manquante, un jeton d'exemple ou une valeur invalide font échouer le
démarrage avec un message explicite. Les clés et jetons ne sont jamais
journalisés.

## Discord

| Variable | Défaut | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | requis | Jeton du bot Discord |
| `DISCORD_GUILD_ID` | vide | Enregistre les commandes slash dans cette guilde seulement. Vide : enregistrement global (jusqu'à une heure de propagation) |

## DeepSeek

| Variable | Défaut | Description |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | requise | Clé API DeepSeek |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/anthropic` | Point d'accès compatible Anthropic |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | Nom du modèle |
| `DEEPSEEK_THINKING` | `enabled` | `enabled` ou `disabled` |
| `DEEPSEEK_EFFORT` | `max` | `low`, `medium`, `high` ou `max` (si réflexion activée) |
| `DEEPSEEK_MAX_TOKENS` | `8192` | Jetons de réponse, réflexion comprise |
| `DEEPSEEK_TEMPERATURE` | vide | De `0` à `2` ; ignorée quand la réflexion est activée |
| `DEEPSEEK_TIMEOUT_MS` | `180000` | Délai d'expiration des requêtes |

## Comportement du bot

| Variable | Défaut | Description |
| --- | --- | --- |
| `SYSTEM_PROMPT` | prompt français intégré | Personnalité et consignes du bot |
| `MAX_HISTORY_TURNS` | `10` | Tours conservés par canal |
| `MAX_PROMPT_CHARS` | `4000` | Longueur maximale d'un prompt |

## MongoDB et mémoire

| Variable | Défaut | Description |
| --- | --- | --- |
| `MONGODB_URI` | vide | URI MongoDB. Vide ou injoignable : mémoire RAM volatile |
| `MONGODB_DB` | `td-discord-bot` | Nom de la base |
| `MONGODB_TIMEOUT_MS` | `5000` | Délai de sélection du serveur |
| `MEMORY_TTL_DAYS` | `30` | Expiration des mémoires inactives (voir [memoire.md](memoire.md)) |
| `MEMORY_ENCRYPTION_KEY` | vide | 64 hexadécimaux (32 octets) pour le chiffrement au repos. Génération : `openssl rand -hex 32`. Vide : mémoire en clair, avec avertissement au démarrage |

## Journaux

| Variable | Défaut | Description |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` ou `error` |
| `LOG_DIR` | `./logs` | Dossier des fichiers journaux |
| `LOG_FILE_ENABLED` | `true` | Sortie fichier (rotation + archives) |
| `LOG_MAX_SIZE_MB` | `10` | Taille maximale avant rotation |
| `LOG_RETENTION_DAYS` | `14` | Rétention des archives gzip |

## GitHub

| Variable | Défaut | Description |
| --- | --- | --- |
| `GITHUB_TOKEN` | vide | Jeton avec permission « Issues : write » sur le dépôt, pour `/feature-request`. Vide : la commande répond qu'elle n'est pas configurée |
| `GITHUB_REPOSITORY` | `Terrebonne-Debug/td-discord-bot` | Dépôt `propriétaire/nom` des issues |

Le gabarit complet se trouve dans `.env.example`.
