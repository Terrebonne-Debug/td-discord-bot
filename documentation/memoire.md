# Mémoire

La mémoire de conversation vit dans MongoDB (collection `channel_memories`) et
survit aux redémarrages.

## Périmètre

- **Canaux publics** : chaque canal a une mémoire partagée par tous ses
  membres, indexée par identifiant de canal. Les `MAX_HISTORY_TURNS` derniers
  échanges (10 par défaut) sont conservés ; au-delà, les plus anciens sont
  tronqués automatiquement (`$slice`).
- **Messages privés** : le bot répond **sans rien mémoriser** — aucune lecture
  ni écriture en base pour les MP.

## Chiffrement au repos

Avec `MEMORY_ENCRYPTION_KEY` définie (64 hexadécimaux, `openssl rand -hex 32`),
chaque entrée est scellée individuellement en **AES-256-GCM** :

- le JSON `{ role, content }` est chiffré ;
- les données authentifiées supplémentaires sont **l'identifiant du canal** :
  une entrée copiée dans le document d'un autre canal ne se déchiffre plus ;
- une entrée altérée, une mauvaise clé ou un mauvais canal sont détectés et
  l'entrée est ignorée avec un avertissement — jamais une erreur de
  conversation.

Sans clé, la mémoire reste en clair et un avertissement est journalisé au
démarrage. Les entrées en clair antérieures à l'activation restent lisibles ;
les nouvelles sont chiffrées et les anciennes sortent d'elles-mêmes par la
rotation des tours.

**Changer la clé** rend les entrées existantes illisibles : elles sont ignorées
(avec avertissement) jusqu'à leur rotation naturelle, à moins de les
ré-encrypter à la main.

### Modèle de menace

Le chiffrement protège contre l'accès à la **base seule** (mongosh, Compass,
sauvegardes, dumps). Il ne protège pas contre un accès au processus ou à
l'hôte : la clé vit dans `.env` et en mémoire.

### Déchiffrement manuel

Pour lire ce que le bot retient d'un canal (avec la clé) :

```bash
node scripts/decrypt-memory.ts <channelId>
```

Lecture seule : les entrées historiques en clair sont affichées telles
quelles, les entrées chiffrées sans clé valide sont signalées à leur place.

## Expiration

Un index TTL est créé au démarrage : un canal inactif voit sa mémoire supprimée
`MEMORY_TTL_DAYS` jours (30 par défaut) après sa dernière activité.
L'expiration s'applique rétroactivement aux documents déjà présents (purge par
le balayage de fond de MongoDB).

## Repli

Sans MongoDB joignable au démarrage, le bot continue avec une mémoire **RAM
volatile** (perdue au redémarrage) et un avertissement dans les journaux. Le
mode RAM reste en clair : la menace visée par le chiffrement est la base, pas
la mémoire du processus.
