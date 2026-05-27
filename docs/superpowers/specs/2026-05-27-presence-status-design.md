# Statut de présence — Design (F8)

**Date** : 2026-05-27
**Statut** : design validé

## Objectif

Chaque joueur a un statut de présence visible des autres : `available`, `away`, `brb` (je reviens), `dnd` (ne pas déranger). Bascule automatique vers `inactive` après 5 min sans activité. Retour à `available` au prochain input (souris, clavier, mouvement).

## Modèle

Nouveau champ sur `PlayerState` :

```ts
presence: 'available' | 'away' | 'brb' | 'dnd' | 'inactive';
// + lastActivityAt: number      // server-tracked timestamp for inactive auto-detect
```

`presence` est persisté dans `RoomState.players` (en mémoire serveur, comme le reste — non sauvé sur disque, reset au join).

## Protocole

**Client → Serveur** :
```
'presence_set' { presence: 'available' | 'away' | 'brb' | 'dnd' }  // explicit choice
'presence_activity'                                                 // heartbeat ping
```

**Serveur → Room broadcast** :
- Quand un joueur change son `presence` (via `presence_set` ou via auto-inactivité), broadcast `player_update` (event existant) avec le nouveau `presence`.

## Permissions / Logique

- Chaque joueur ne contrôle QUE son propre statut.
- `presence_activity` ne change pas le statut directement : il met à jour `lastActivityAt`. Le serveur, toutes les 30 s, scanne les joueurs : si `Date.now() - lastActivityAt > 5min` ET `presence === 'available'` → bascule vers `inactive` + broadcast.
- Si le joueur a explicitement choisi `away`/`brb`/`dnd`, l'auto-inactivité **ne l'override pas**. Seul `available → inactive` automatique.
- À la réception d'un `presence_activity` (ou `player_move`, qui counts as activity), si le joueur est `inactive`, le serveur le repasse automatiquement à `available` et broadcast.

## UX

- **Sélecteur de statut** dans le HUD : un petit dropdown à côté du pseudo (en haut-gauche). 4 options manuelles + l'auto-inactif est read-only.
- **Indicateur** : pastille colorée à gauche du pseudo dans la VideoBar tile :
  - 🟢 `available`
  - 🟡 `away` / `brb`
  - 🔴 `dnd`
  - ⚪ `inactive`
- **Sur le personnage Phaser** : suffixe au label si `presence !== 'available'`. Ex : `Marie · 💤` (inactive), `Marie · ☕ BRB` (brb), `Marie · 🚫 DND` (dnd), `Marie · 👋` (away).
- **Hover sur la pastille** : tooltip avec le label textuel français complet.

## Détection d'activité client

Le client ping `presence_activity` au serveur dès qu'il détecte :
- mouvement souris (debounce 10 s — on n'envoie pas un ping par mouseMove)
- keypress (debounce 10 s)
- focus de la fenêtre
- envoi de chat
- mouvement Phaser (player_move existant compte côté serveur)

L'idée : sans saturer le réseau, signaler « je suis là » au moins toutes les 10 s s'il y a une activité. Au-delà de 5 min sans aucun signal → auto-inactive.

## Architecture code

**Serveur** :
- `server/src/types.ts` : étendre `PlayerState` avec `presence` + `lastActivityAt`.
- `server/src/rooms/RoomManager.ts` : `addPlayer` initialise `presence: 'available'` + `lastActivityAt: Date.now()`. Nouvelle méthode `setPresence(slug, playerId, presence)` et `markActivity(slug, playerId)`.
- `server/src/socket/handlers.ts` : handlers `presence_set` + `presence_activity` + ajouter `markActivity` dans `player_move` et `chat_message` existants. Ajouter un `setInterval(30_000)` au démarrage qui scanne et auto-bascule vers `inactive`.

**Client** :
- `client/src/types.ts` : mirror.
- `client/src/network/SocketManager.ts` : emit helpers + le `player_update` existant transporte déjà `presence` (via spread du payload).
- `client/src/stores/gameStore.ts` : `localPresence: Presence` + setter.
- `client/src/react/HUD.tsx` : nouveau composant `<PresenceSelector />` (dropdown 4 statuts) intégré près du pseudo.
- `client/src/react/components/VideoBar.tsx` : ajouter la pastille colorée à gauche du nom dans `LocalTile` et `RemoteTile`.
- `client/src/phaser/entities/RemotePlayer.ts` + `Player.ts` : `setPresence(p)` qui maj le suffixe du label.
- `client/src/hooks/useActivityHeartbeat.ts` (nouveau) : hook qui écoute mousemove/keydown/focus avec debounce 10s et appelle `socketManager.sendActivity()`. Monté une fois dans HUD.

## Tests

- `server/src/rooms/presence.test.ts` :
  - `setPresence` met à jour le statut + bump lastActivityAt.
  - `markActivity` met à jour lastActivityAt.
  - Auto-inactif : si `available` et lastActivity > 5 min → bascule. Si déjà `away`/`brb`/`dnd`, pas de changement.
  - Retour auto à `available` au markActivity si étais `inactive`.
- Pas de test client (mostly UI).

## Hors scope (YAGNI)

- Statut custom textuel (« en réunion », « focus mode »).
- Statut auto basé sur le calendrier ou la cam/micro.
- Notification quand quelqu'un passe disponible.
