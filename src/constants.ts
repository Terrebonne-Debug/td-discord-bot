/**
 * Constantes partagées de tout le projet : limites, messages utilisateur,
 * messages de journalisation, noms d'environnement, valeurs par défaut et
 * identifiants de protocole. Source unique de vérité — les tests et les
 * scripts importent les mêmes constantes que le code de production.
 */

/** Limites et durées propres à Discord. */
export const Discord: {
  messageLimit: number;
  typingIntervalMs: number;
  maxSlashOptionLength: number;
} = {
  messageLimit: 2000,
  typingIntervalMs: 8_000,
  maxSlashOptionLength: 6000,
};

/** Bornes des formulaires et des issues GitHub. */
export const Limits = {
  featureRequestTitle: 200,
  featureRequestDescription: 4000,
  githubIssueTitle: 256,
  truncatedTitleLength: 199,
  memoryEncryptionKeyHexLength: 64,
  memoryEncryptionKeyBytes: 32,
} as const;

/** Messages destinés aux utilisateurs. */
export const Messages = {
  modelReturnedEmpty: 'Le modèle a renvoyé une réponse vide.',
  memoryUnavailable: 'La mémoire de conversation est indisponible.',
  memoryTemporarilyUnavailable:
    'La mémoire de conversation est momentanément indisponible. Réessaie bientôt.',
  pleaseAskQuestion: 'Pose ta question.',
  mentionPrompt: 'Salut ! Mentionne-moi avec une question, ou utilise `/q`.',
  busyConversation:
    'Je travaille encore sur la question précédente dans ce canal. Réessaie bientôt.',
  featureRequestNotConfigured:
    'Les demandes de fonctionnalités ne sont pas configurées (GITHUB_TOKEN manquant).',
  featureRequestTitleAndDescriptionRequired: 'Le titre et la description sont requis.',
  featureRequestCreationFailed:
    'Impossible de créer la demande pour le moment. Réessaie plus tard.',
  githubTokenNotSet: "GITHUB_TOKEN n'est pas défini.",
} as const;

/** Messages paramétrés — purs, ils vivent avec les autres messages. */
export function keepQuestionsUnder(maxPromptChars: number): string {
  return `Garde tes questions sous ${maxPromptChars} caractères.`;
}

/** @function @param {string} url - L'URL de l'issue créée. @returns {string} */
export function featureRequestCreated(url: string): string {
  return `Demande créée : ${url}`;
}

/** @function @param {string} version @param {string} commit @returns {string} */
export function versionReply(version: string, commit: string): string {
  return `**td-discord-bot ${version}**\nCommit : \`${commit}\``;
}

/** Messages de journalisation. */
export const LogMessages = {
  questionReceived: 'Question reçue',
  messageReceived: 'Message reçu',
  replySending: 'Envoi de la réponse',
  historyLoaded: 'Historique chargé',
  modelReplyReceived: 'Réponse du modèle reçue',
  turnSaved: 'Tour enregistré',
  busyIgnored: 'Conversation occupée : requête ignorée',
  mongoConnected: 'MongoDB connecté',
  botStartup: 'Démarrage du bot',
  loggedInAs: (tag: string) => `Connecté en tant que ${tag}.`,
  deepseekSummary: (model: string, base: string, thinking: string, effort?: string) =>
    `DeepSeek : modèle=${model} base=${base} réflexion=${thinking}` +
    (effort ? ` effort=${effort}` : ''),
  memoryMongoSummary: (db: string, ttlDays?: number | null) =>
    `Mémoire : MongoDB base=${db}${ttlDays ? ` ttl=${ttlDays}j` : ''}.`,
  memoryRamFallback: 'Mémoire : repli en RAM (perdue au redémarrage).',
  shutdownReceived: (signal: string) => `Reçu ${signal} ; arrêt en cours.`,
  shutdownComplete: 'Arrêt terminé',
  issueCreated: 'Issue de demande créée',
  startupFailed: (message: string) => `Échec du démarrage du bot : ${message}`,
  commandsRegisteredInGuild: (count: number, guildName: string) =>
    `${count} commandes slash enregistrées dans ${guildName}.`,
  commandsRegisteredGlobally: (count: number) =>
    `${count} commandes slash globales enregistrées (elles peuvent mettre jusqu'à une heure à apparaître).`,
  handleSlashFailed: (commandName: string) => `Échec du traitement de /${commandName}`,
  handleMessageFailed: 'Échec du traitement du message',
  handleSubmitFailed: (customId: string) => `Échec du traitement de la soumission ${customId}`,
  discordClientError: (message: string) => `Erreur du client Discord : ${message}`,
  registerCommandsFailed: (message: string) =>
    `Impossible d'enregistrer les commandes slash : ${message}`,
  shutdownFailed: (error: unknown) => `Échec de l'arrêt : ${String(error)}`,
  featureRequestIssueFailed: (message: string) =>
    `Impossible de créer l'issue de demande : ${message}`,
  turnNotSaved: (message: string) =>
    `Impossible d'enregistrer le tour de conversation : ${message}`,
  memoryFallbackNoUri:
    "MONGODB_URI n'est pas défini ; la mémoire de conversation reste en RAM et sera perdue au redémarrage.",
  mongoUnavailable: (error: unknown) =>
    `MongoDB est indisponible (${String(error)}) ; repli sur la mémoire en RAM, perdue au redémarrage.`,
  memoryStoredInPlaintext:
    "MEMORY_ENCRYPTION_KEY n'est pas défini ; la mémoire des canaux est stockée en clair.",
  encryptedTurnSkippedNoKey: (key: string) =>
    `Tour chiffré ignoré : MEMORY_ENCRYPTION_KEY non configuré (clé ${key}).`,
  encryptedTurnSkippedDecryptionFailed: (key: string) =>
    `Tour chiffré ignoré : déchiffrement impossible (clé ${key}).`,
  ttlIndexFailed: (collection: string, error: unknown) =>
    `Impossible de créer l'index TTL sur ${collection} : ${String(error)}`,
} as const;

/** Clés des champs structurés des journaux. */
export const LogFields = {
  source: 'source',
  isDM: 'isDM',
  promptChars: 'promptChars',
  chunks: 'chunks',
  key: 'key',
  ms: 'ms',
  chars: 'chars',
  turns: 'turns',
  mode: 'mode',
  dbName: 'dbName',
  lockKey: 'lockKey',
  signal: 'signal',
  url: 'url',
  userId: 'userId',
  created: 'created',
  enabled: 'enabled',
} as const;

/** Messages d'erreur DeepSeek destinés aux utilisateurs. */
export const DeepSeekErrors = {
  timeout: 'DeepSeek a mis trop de temps à répondre. Réessaie bientôt.',
  badRequest:
    'DeepSeek a rejeté la requête. Vérifie DEEPSEEK_MODEL et les autres réglages DeepSeek.',
  unauthorized: 'DeepSeek a rejeté la clé API. Vérifie DEEPSEEK_API_KEY dans .env.',
  insufficientBalance: 'Le compte DeepSeek a un solde insuffisant.',
  forbidden: 'DeepSeek a refusé la requête. Vérifie les permissions de la clé API.',
  notFound: "Le point d'accès ou le modèle DeepSeek configuré est introuvable.",
  rateLimited: 'DeepSeek limite le débit des requêtes. Réessaie bientôt.',
  unavailable: 'DeepSeek est momentanément indisponible. Réessaie bientôt.',
  generic: 'La requête DeepSeek a échoué. Consulte les journaux du bot et réessaie.',
} as const;

/** Noms des variables d'environnement. */
export const EnvVars = {
  discordToken: 'DISCORD_TOKEN',
  discordGuildId: 'DISCORD_GUILD_ID',
  deepseekApiKey: 'DEEPSEEK_API_KEY',
  deepseekBaseUrl: 'DEEPSEEK_BASE_URL',
  deepseekModel: 'DEEPSEEK_MODEL',
  deepseekThinking: 'DEEPSEEK_THINKING',
  deepseekEffort: 'DEEPSEEK_EFFORT',
  deepseekMaxTokens: 'DEEPSEEK_MAX_TOKENS',
  deepseekTemperature: 'DEEPSEEK_TEMPERATURE',
  deepseekTimeoutMs: 'DEEPSEEK_TIMEOUT_MS',
  systemPrompt: 'SYSTEM_PROMPT',
  maxHistoryTurns: 'MAX_HISTORY_TURNS',
  maxPromptChars: 'MAX_PROMPT_CHARS',
  mongodbUri: 'MONGODB_URI',
  mongodbDb: 'MONGODB_DB',
  mongodbTimeoutMs: 'MONGODB_TIMEOUT_MS',
  memoryTtlDays: 'MEMORY_TTL_DAYS',
  memoryEncryptionKey: 'MEMORY_ENCRYPTION_KEY',
  logLevel: 'LOG_LEVEL',
  logDir: 'LOG_DIR',
  logFileEnabled: 'LOG_FILE_ENABLED',
  logMaxSizeMb: 'LOG_MAX_SIZE_MB',
  logRetentionDays: 'LOG_RETENTION_DAYS',
  githubToken: 'GITHUB_TOKEN',
  githubRepository: 'GITHUB_REPOSITORY',
  mongodbTestUri: 'MONGODB_TEST_URI',
} as const;

/** Valeurs par défaut de la configuration. */
export const Defaults = {
  deepseekBaseUrl: 'https://api.deepseek.com/anthropic',
  deepseekModel: 'deepseek-v4-flash',
  thinking: 'enabled',
  effort: 'max',
  maxTokens: 8192,
  timeoutMs: 180_000,
  systemPrompt:
    "Tu es un bot Discord utile propulsé par DeepSeek. Réponds clairement et de façon concise, avec du Markdown qui s'affiche bien dans Discord.",
  maxHistoryTurns: 10,
  maxPromptChars: 4000,
  mongodbDb: 'td-discord-bot',
  mongodbTimeoutMs: 5000,
  memoryTtlDays: 30,
  logLevel: 'info',
  logDir: './logs',
  logFileEnabled: true,
  logMaxSizeMb: 10,
  logRetentionDays: 14,
  githubRepository: 'Terrebonne-Debug/td-discord-bot',
} as const;

/** Constantes GitHub. */
export const Github = {
  apiBaseUrl: 'https://api.github.com',
  acceptHeader: 'application/vnd.github+json',
  contentHeader: 'Content-Type',
  jsonContentType: 'application/json',
  authorizationPrefix: 'Bearer ',
} as const;

/** Identifiants et libellés des commandes slash et du modal. */
export const Commands = {
  question: 'q',
  version: 'version',
  help: 'aide',
  helpAlias: 'help',
  featureRequest: 'feature-request',
  featureRequestModalTitle: 'Demande de fonctionnalité',
  titleField: 'titre',
  descriptionField: 'description',
  helpIntro: '**Commandes disponibles**',
} as const;

/** Constantes de la mémoire. */
export const Memory = {
  channelCollection: 'channel_memories',
} as const;

/** Constantes de chiffrement. */
export const Crypto = {
  algorithm: 'aes-256-gcm',
} as const;

/** Constantes de journalisation. */
export const Logging = {
  dateFormat: 'en-CA',
  filenamePattern: 'bot-%DATE%.log',
  dailyDatePattern: 'YYYY-MM-DD',
  timestampFormat: 'YYYY-MM-DD HH:mm:ss',
  gzipExtension: '.gz',
  sweepIntervalMs: 24 * 3_600_000,
} as const;

/** Constantes de version. */
export const Version = {
  unknownVersion: 'inconnue',
  unknownCommit: 'inconnu',
  packageFilename: 'package.json',
} as const;

/** Valeurs de protocole et rôles. */
export const Values = {
  roleUser: 'user',
  roleAssistant: 'assistant',
  enabled: 'enabled',
  disabled: 'disabled',
  true: 'true',
  false: 'false',
  mongo: 'mongo',
  memory: 'memory',
  effortLow: 'low',
  effortMedium: 'medium',
  effortHigh: 'high',
  logDebug: 'debug',
  logInfo: 'info',
  logWarn: 'warn',
  logError: 'error',
} as const;

/** Gabarits de messages d'erreur de configuration. */
export function configMissing(name: string): string {
  return `Variable d'environnement requise manquante : ${name}. Voir .env.example.`;
}

/** @function @param {string} name @returns {string} */
export function configPlaceholder(name: string): string {
  return `${name} a encore sa valeur d'exemple. Définis une vraie valeur dans .env.`;
}

/** @function @param {string} name @param {string} raw @returns {string} */
export function configPositiveInt(name: string, raw: string): string {
  return `${name} doit être un entier positif (reçu : ${raw}).`;
}

/** @function @param {string} name @param {number} min @param {number} max @param {string} raw @returns {string} */
export function configNumberRange(name: string, min: number, max: number, raw: string): string {
  return `${name} doit être un nombre de ${min} à ${max} (reçu : ${raw}).`;
}

/** @function @param {string} name @param {string} raw @returns {string} */
export function configBoolean(name: string, raw: string): string {
  return `${name} doit valoir « true » ou « false » (reçu : ${raw}).`;
}
