# Journalisation

Les journaux sont structurés et ne contiennent **jamais le contenu des
messages**, uniquement des métadonnées : longueurs, identifiants de
canal/utilisateur, durées, niveaux. Les clés et jetons n'y figurent jamais.

## Destinations

- **Console** : format lisible dans un terminal (horodatage, niveau, message,
  champs), JSON sinon.
- **Fichiers** (`LOG_DIR`, `./logs` par défaut) : `bot-AAAA-MM-JJ.log`, JSON,
  rotation quotidienne et dès que `LOG_MAX_SIZE_MB` est atteint.

## Archivage et rétention

Un balayage (`ArchiveSweeper`) tourne au démarrage puis chaque jour :

1. les rotations terminées (`bot-AAAA-MM-JJ.log.N`, ou le journal d'un jour
   précédent) sont compressées en `.gz` et l'original est supprimé ;
2. les archives plus vieilles que `LOG_RETENTION_DAYS` jours sont supprimées ;
3. le fichier actif du jour n'est jamais touché.

Lire une archive : `zcat logs/bot-2026-11-02.log.1.gz`.

## Niveaux

`LOG_LEVEL` filtre : `debug` (détail opérationnel : historique chargé, tours
enregistrés, connexions), `info` (cycle de vie : démarrage, connexion,
réponses du modèle, arrêt), `warn` (dégradations : repli RAM, tour non
enregistré, conversation occupée), `error` (échecs de traitement, avec champs
structurés `key`, `isDM`…).

## Arrêt

À l'arrêt (SIGINT/SIGTERM), le bot détruit le client, ferme la mémoire,
journalise « Arrêt terminé » puis purge les journaux (`flush`) avant de
sortir — la dernière ligne n'est jamais perdue.
