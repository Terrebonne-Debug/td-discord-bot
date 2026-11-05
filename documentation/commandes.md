# Commandes

Cinq commandes slash sont enregistrées (guilde ou globales selon
`DISCORD_GUILD_ID`), définies une seule fois dans `src/bot/commands.ts` —
l'enregistrement Discord, le texte d'aide et le modal de `/feature-request`
dérivent de la même source.

## `/q <question>`

Pose une question au modèle. En guilde, la mémoire partagée du canal (les
`MAX_HISTORY_TURNS` derniers échanges) est jointe à la requête ; en MP, le bot
répond sans rien mémoriser ni relire. Une seule requête en vol par
conversation : la suivante reçoit « Je travaille encore sur la question
précédente dans ce canal. Réessaie bientôt. »

Validation : prompt vide → « Pose ta question. » ; au-delà de
`MAX_PROMPT_CHARS` → « Garde tes questions sous N caractères. » Les longues
réponses sont découpées en plusieurs messages ; les mentions sont neutralisées
dans les réponses.

## `/version`

Affiche le numéro de version (`package.json`) et le hash court du dernier
commit (git), lus une fois au démarrage. Sans dépôt git ni package.json, les
valeurs dégradent en « inconnue »/« inconnu ».

## `/aide` et `/help`

Exactement le même comportement : la liste des commandes disponibles,
dérivée des mêmes définitions que l'enregistrement.

## `/feature-request`

Ouvre un formulaire Discord (modal) : un **titre** court (200 caractères) et
une **description** (4000 caractères). À la soumission, une issue GitHub est
créée sur `GITHUB_REPOSITORY` : titre tronqué à 200 caractères (limite GitHub :
256), corps signé du pseudo Discord du demandeur.

Comportements :

- `GITHUB_TOKEN` absent → réponse éphémère « non configuré », aucun formulaire ;
- champs vides → « Le titre et la description sont requis. » ;
- succès → « Demande créée : URL de l'issue » ;
- échec de l'API → « Impossible de créer la demande pour le moment. Réessaie
  plus tard. » + erreur journalisée.

Les modals inconnus et les commandes résiduelles (par exemple une ancienne
`/memo`) sont ignorés silencieusement.

## Mentions et messages privés

- `@bot question` dans un salon → même flux que `/q`, avec la mémoire du canal.
- MP envoyé au bot → réponse sans aucune mémoire, aucune écriture en base.
- Messages des autres bots et messages système : ignorés.
- En guilde, un message sans mention est ignoré.

## Erreurs du modèle

Les échecs DeepSeek sont traduits pour l'utilisateur : délai dépassé, clé
rejetée, solde insuffisant, débit limité, indisponibilité — chaque cas a son
message dédié ; les autres échecs donnent un message générique invitant à
consulter les journaux.
