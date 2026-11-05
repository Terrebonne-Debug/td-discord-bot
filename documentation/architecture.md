# Architecture

## Arborescence de `src/`

```
src/
├── index.ts                  point d'entrée : un simple amorçage
├── bot/
│   ├── bot.ts                Bot : façade, statics utilitaires, câblage des événements
│   ├── commands.ts           Commands : source unique des définitions (enregistrement, aide, modal)
│   ├── commands/             patron Commande
│   │   ├── command.ts            interface Command
│   │   ├── command-dispatcher.ts répartiteur (routage par nom et par customId)
│   │   ├── question-command.ts   /q
│   │   ├── version-command.ts    /version
│   │   ├── help-command.ts       /aide et /help
│   │   └── feature-request-command.ts /feature-request + son modal
│   └── conversation/         patron Stratégie
│       ├── conversation-strategy.ts interface ConversationStrategy
│       ├── conversation-service.ts  algorithme partagé (verrou, historique, modèle, mémoire)
│       ├── slash-conversation.ts    variante /q
│       └── mention-conversation.ts  variante message mentionné
├── config/                   ConfigLoader : lecture et validation de l'environnement
├── crypto/                   MemoryCipher : AES-256-GCM pour les tours en base
├── deepseek/                 DeepSeek : client et appels au modèle
├── errors/                   classes d'erreur (MemoryUnavailableError)
├── github/                   GitHubIssues : création d'issues via l'API REST
├── logging/                  LoggerFactory + ArchiveSweeper : journaux et archives
├── memory/                   MemoryStore : mémoire des canaux
├── models/                   une interface ou un type par fichier, par domaine
├── startup/                  Launcher : démarrage, enregistrement des commandes, arrêt
├── utils/                    Errors : formatage des rejets pour les journaux
└── version/                  BuildInfoReader : version npm + commit git
```

## Patrons de conception

### Commande (`src/bot/commands/`)

Chaque commande slash est une classe derrière l'interface `Command` :

```ts
export interface Command {
  readonly names: readonly string[];          // noms, alias compris
  handle(interaction: InteractionLike): Promise<void>;
  handleSubmit?(modal: ModalSubmitLike): Promise<boolean>; // modals possédés
}
```

Le `CommandDispatcher` route les interactions : entrées de discussion par nom,
soumissions de modal par `handleSubmit`, inconnues ignorées, échecs journalisés
sans jamais faire tomber la boucle d'événements. Ajouter une commande = créer
une classe + l'instancier dans le constructeur de `Bot` : rien d'autre ne
change (ouvert/fermé).

### Stratégie (`src/bot/conversation/`)

`/q` et la mention d'un message partagent exactement le même algorithme
(validation → verrou → historique → modèle → mémoire → réponse → erreurs) ;
seules l'extraction du prompt, la livraison et la gestion d'erreur diffèrent.
`ConversationService` porte l'algorithme, paramétré par une
`ConversationStrategy` avec deux implémentations :

- `SlashConversation` — option de commande, `deferReply`, `editReply`/`followUp` ;
- `MentionConversation` — `stripBotMention`, `reply`/`send`.

Les injections `ask` (le modèle) et `createIssue` (le créateur d'issue) sont
déjà des stratégies par valeur : des fonctions injectées au constructeur.

### Injection de dépendances

Tout est injecté au constructeur (client Discord, mémoire, modèle, journal,
créateur d'issue, version) : les tests pilotent le flux complet avec des faux
objets (`test/helpers/fakes.ts`) sans toucher au réseau. Aucun module ne
fabrique ses dépendances autrement que par défaut de constructeur.

Chaque fichier de `src/` est **une classe** : aucune fonction libre ni
constante éparpillée — les utilitaires sont des méthodes (souvent privées et
statiques) de la classe propriétaire, et le point d'entrée d'un module est sa
classe (`ConfigLoader.load()`, `LoggerFactory`, `ArchiveSweeper`) plutôt
qu'un objet pré-construit à l'import.

## Flux d'une requête

```
Événement Discord ──► Bot.handleInteraction ──► CommandDispatcher
                                                    │ nom de commande
                                                    ▼
                                              Commande.handle
                                                    │
                        /q ──► ConversationService.handle(SlashConversation)
                                                    │
                1. prepare()    validation + réponse en cas d'entrée invalide
                2. beginWork()  deferReply + indicateur de frappe
                3. respond()    verrou → historique → modèle → mémoire → envoi
                4. reportBusy() si la conversation était déjà occupée
                5. reportError() + journal en cas d'échec
```

Un message mentionné suit le même chemin via
`Bot.handleMessage` → `ConversationService.handle(MentionConversation)`.

## Cycle de vie

`Launcher.start()` connecte la mémoire, instancie `Bot`, ouvre la session
Discord, enregistre les commandes (guilde ou globales selon
`DISCORD_GUILD_ID`) et installe les gestionnaires SIGINT/SIGTERM : le client
est détruit, la mémoire fermée et les journaux purgés exactement une fois,
même si deux signaux arrivent ensemble.
