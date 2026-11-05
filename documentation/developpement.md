# Développement

## Prérequis

- Node.js 24 ou plus récent (TypeScript exécuté nativement, sans compilation) ;
- MongoDB via `docker compose up -d` (facultatif : repli RAM) ;
- jetons Discord et DeepSeek dans `.env`.

## Conventions de code

- **Français partout** : chaînes, journaux, commentaires et titres de tests.
- **JSDoc balisée sur tout** : `@class NomClasse`, `@constructor` +
  `@param {Type}`, `@method` + `@returns`, `@static`, `@function`,
  `@interface`, `@type`, `@throws`.
- **Une classe par fichier** dans `src/` (sous-dossiers par domaine), une
  interface par fichier dans `src/models/`, **aucune fonction libre** : les
  utilitaires sont des méthodes statiques de la classe propriétaire
  (`Bot.splitMessage`, `Errors.messageOf`) et les helpers internes des
  membres privés statiques (`MemoryStore.#normalizeTurns`,
  `ArchiveSweeper.#gzipFile`…). Les classes d'erreur vivent dans
  `src/errors/`.
- **Injection de dépendances au constructeur** : tests et production suivent le
  même câblage, jamais d'import de singleton (le point d'entrée d'un module
  est sa classe : `ConfigLoader.load()`, `LoggerFactory`, `ArchiveSweeper`).
- **TypeScript strict** : `strict`, `erasableSyntaxOnly` (pas d'enum ni de
  namespace), `verbatimModuleSyntax` (imports de types explicites), imports
  avec extension `.ts`.

## Scripts

```bash
npm start             # lancer le bot (node src/index.ts)
npm run check         # vérifier les types de src/, test/ et scripts/ (tsc --noEmit)
npm test              # tests unitaires, fonctionnels et bout en bout
npm run test:coverage # idem, avec un seuil de couverture de 100 %
```

## Tests

- `test/unit` — configuration, chiffrement, journalisation, mémoire,
  répartiteur, service de conversation, commandes ;
- `test/functional` — flux complets du bot et du démarrage avec dépendances
  injectées (`test/helpers/fakes.ts`) ;
- `test/e2e` — vrai client `discord.js` face à une passerelle Discord simulée,
  vrai SDK Anthropic face à un point d'accès DeepSeek simulé, vraie base
  MongoDB (isolée, créée puis supprimée par test).

La couverture exigée par la CI est de **100 % lignes, fonctions et branches**
sur `src/**` (hors `src/index.ts`). Les fakes sont des objets simples qui
implémentent les interfaces de `src/models/` : aucune bibliothèque de mock.

## CI

Le workflow `.github/workflows/ci.yml` (runner auto-hébergé `mkII`) roule en
**un seul job**, dans un ordre qui échoue vite :

1. **Node.js** — un seul `setup-node`, piloté par `.nvmrc` à la racine (la
   version est configurée une fois, dans le dépôt) ; le cache d'outils du
   runner évite le téléchargement dès la deuxième exécution ;
2. `npm ci` puis `npm run check` (types) ;
3. balayage CVE des dépendances avec osv-scanner (version épinglée) contre la
   base OSV : toute vulnérabilité connue fait échouer la CI ; les faux
   positifs se déclarent dans un `osv-scanner.toml` ;
4. suite complète avec un MongoDB isolé et les seuils de couverture.

## Secrets

- `.env` est gitignoré et créé en mode `600` ; `.env.example` ne contient que
  des valeurs fictives ;
- les jetons ne sont jamais journalisés (voir
  [journalisation.md](journalisation.md)) ;
- un jeton exposé doit être révoqué immédiatement (portail Discord, clé
  DeepSeek) ;
- en production, préférer l'injection depuis un gestionnaire de secrets.
