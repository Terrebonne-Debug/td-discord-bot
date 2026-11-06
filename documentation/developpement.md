# Développement

## Prérequis

- Node.js 24 ou plus récent (TypeScript exécuté nativement, sans compilation) ;
- MongoDB via `docker compose up -d` (facultatif : repli RAM) ;
- jetons Discord et DeepSeek dans `.env`.

## Conventions de code

- **Français partout** : chaînes, journaux, commentaires et titres de tests.
- **Aucun littéral en dur** : toutes les chaînes, limites et valeurs par
  défaut vivent dans `src/constants.ts` (groupées par thème) ; les tests et
  les scripts importent les mêmes constantes que le code de production.
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
npm run lint          # vérifier lint et mise en forme (biome check)
npm run fix           # corriger automatiquement lint et mise en forme
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

Le workflow `.github/workflows/ci.yml` (runner auto-hébergé `mkII`) découpe le
flot en six jobs :

1. `basics` — `npm ci` puis `npm run check` (types) ;
2. `lint` — `biome check` en vérification seule, **auto-cicatrisant** : en
   cas d'échec (hook contourné, autre machine), il applique `npm run fix`,
   re-vérifie dans le même run et pousse un commit « style : … » — le job ne
   passe au rouge que si le code est encore cassé après correction, donc
   jamais de fenêtre rouge ni de run supplémentaire ;
3. `secrets` — gitleaks balaye l'historique git à la recherche de jetons ou
   clés oubliés ; les faux positifs se déclarent dans un `.gitleaks.toml` ;
4. `security` — balayage CVE des dépendances avec osv-scanner (version
   épinglée) contre la base OSV ; les faux positifs se déclarent dans un
   `osv-scanner.toml` ;
5. `tests` (après `basics`) — suite complète avec un MongoDB isolé, les seuils
   de couverture et un test de fumée du démarrage (le point d'entrée doit
   échouer proprement sur un jeton invalide).

Les changements ne touchant que `documentation/**` ou `*.md` ne déclenchent
pas la CI (`paths-ignore`).

**Node est configuré une seule fois** : les `setup-node` lisent `.nvmrc` à la
racine, où la version est épinglée **exactement** (`24.15.0`, la même que
celle des machines de développement) — le cache d'outils du runner
auto-hébergé persiste entre les jobs et les exécutions, donc la distribution
n'est téléchargée qu'une fois, les jobs suivants affichent « Found in
cache ». Changer de version de Node se fait par un changement volontaire de
`.nvmrc` (un commit), jamais par une publication de correctif Node.js.

**Jamais de boucle lint** : le hook `.githooks/pre-commit` corrige et
ré-indexe la mise en forme (le commit passe toujours), et le job `lint` se
répare tout seul dans le même run quand quelque chose lui échappe.
Activation unique du hook : `git config core.hooksPath .githooks`.

## Secrets

- `.env` est gitignoré et créé en mode `600` ; `.env.example` ne contient que
  des valeurs fictives ;
- les jetons ne sont jamais journalisés (voir
  [journalisation.md](journalisation.md)) ;
- un jeton exposé doit être révoqué immédiatement (portail Discord, clé
  DeepSeek) ;
- en production, préférer l'injection depuis un gestionnaire de secrets.
