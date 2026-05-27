# Postes de travail revendiquables — Design (F6, v2)

**Date** : 2026-05-27 (rewrite après screenshots)
**Statut** : design validé, coordonnées des postes à calibrer en test

## ⚠️ Changement de cap par rapport à v1

Le design initial parlait de "bureaux" multi-occupants avec isolation audio automatique. Après screenshots de l'utilisateur, la mécanique réelle est différente :

- Chaque rectangle sur la map est un **poste de travail individuel** (un siège).
- Les postes se **revendiquent** explicitement (claim) et se **libèrent** (release).
- Un poste revendiqué est **verrouillé** (seul le claimer + ses invités peuvent y entrer).
- Mécanique d'**invitation** : le claimer invite d'autres user, qui marchent à pied jusqu'au poste pour le rejoindre.
- **Audio inchangé** : reste proximité comme aujourd'hui (pas d'isolation audio par poste).
- **Bulle 💬** : persistante au-dessus de toute personne assise dans un poste revendiqué + s'anime quand elle parle (LiveKit `activeSpeakers`).

## Modèle

### `Workstation` (zone)

Chaque poste est défini par une zone rectangulaire pixel + un id stable :

```ts
// server/src/workstations.ts + miroir client
export interface Workstation {
  id: string;            // ex: 'poste-1', 'poste-2'
  name: string;          // ex: 'Poste 1' (affichage du toast)
  minX: number;          // pixel, inclusive
  minY: number;
  maxX: number;
  maxY: number;
}

export const WORKSTATIONS: readonly Workstation[] = [
  // À calibrer au pixel près. Estimation initiale basée sur le screenshot :
  // - Open space (salle marron en haut): 12 postes, 2 rangées de 6
  // - Petite salle blanche en haut-droite: 1 poste partagé (4 sièges)
  // - 3 petits bureaux rouges en bas: 1 poste chacun
  // Total ≈ 16 postes
  //
  // Format placeholder, à remplacer par les coords réelles via mode debug :
  // { id: 'poste-1', name: 'Poste 1', minX: 384, minY: 96, maxX: 448, maxY: 160 },
];

export function workstationIdForPoint(x: number, y: number): string | null {
  for (const w of WORKSTATIONS) {
    if (x >= w.minX && x <= w.maxX && y >= w.minY && y <= w.maxY) return w.id;
  }
  return null;
}
```

### État serveur : `WorkstationState`

```ts
// server/src/types.ts
export interface WorkstationState {
  id: string;                       // matches Workstation.id
  claimedBy: string | null;         // playerId du revendicateur, ou null
  claimedByName: string | null;     // snapshot pour l'affichage
  invitedPlayerIds: string[];       // les invités autorisés à entrer
  claimedAt: number | null;         // pour debug / audit
}
```

`RoomState` est étendu :

```ts
export interface RoomState {
  // ...existing fields...
  workstations: Map<string, WorkstationState>;   // key = workstation.id
}
```

À l'instanciation de la room, `workstations` est peuplé avec un `WorkstationState` par entrée de `WORKSTATIONS` (`claimedBy: null`).

**Pas persisté sur disque** (volontaire — un restart serveur libère tous les postes).

### Sur `PlayerState`

```ts
export interface PlayerState {
  // ...existing...
  workstationId: string | null;     // calculated server-side from x/y position
}
```

Le serveur recalcule `workstationId` à chaque `updatePlayerPosition` via `workstationIdForPoint(x, y)`. Diffusé via `player_update`.

Différence vs. `claimedBy` : `workstationId` est simplement "où je suis assis géographiquement" ; `claimedBy` est "qui a verrouillé ce poste". On peut être dans un poste sans l'avoir claimé (si on est invité OU si le poste est libre).

## Verrouillage physique

Quand un poste est revendiqué, le serveur autorise à y entrer **uniquement** :
- Le claimer (`workstation.claimedBy === playerId`)
- Les invités (`workstation.invitedPlayerIds.includes(playerId)`)

Tout autre joueur ne peut PAS entrer dans la zone. **Implémentation** : un check côté serveur dans `updatePlayerPosition` qui rejette les positions à l'intérieur d'un poste verrouillé pour un joueur non-autorisé. Le client est aussi averti pour éviter le rubber-banding visuel (le joueur "rebondit" sur la frontière de la zone).

**Côté client** : on ajoute un collider Phaser dynamique pour les postes verrouillés non accessibles à nous, transformant la zone en "mur" pour notre personnage.

## Protocole réseau

### Client → Serveur

```ts
'workstation:claim'     { workstationId: string }
'workstation:release'   { workstationId: string }
'workstation:invite'    { workstationId: string; targetPlayerId: string }
'workstation:uninvite'  { workstationId: string; targetPlayerId: string }
```

Validations serveur :
- `claim` : la zone doit être libre (`claimedBy === null`) ET le joueur doit être physiquement dans la zone (proximité).
- `release` : le joueur doit être le claimer.
- `invite` / `uninvite` : le joueur doit être le claimer. Le target doit exister dans la room.

### Serveur → Room

```ts
'workstation:state'      { workstationId, claimedBy, claimedByName, invitedPlayerIds, claimedAt }
'workstation:initial'    { workstations: WorkstationState[] }   // au join
'workstation:invite'     { fromPlayerId: string; fromPlayerName: string; workstationId: string; workstationName: string }   // emit unicast au target
```

À chaque mutation d'un poste (claim, release, invite, uninvite), le serveur broadcast `workstation:state` à toute la room. Au join, le serveur émet un seul `workstation:initial` au nouveau client.

L'invitation envoie un event ciblé au target pour déclencher un toast côté UI.

### Pas de persistance disque

Aucun `KanbanStore`-like ici — c'est en mémoire. Restart serveur = tous les postes libres. Acceptable car les claims sont éphémères par nature (le contraire serait étrange — les gens ne veulent pas qu'un poste reste verrouillé en leur absence après crash).

## UX

### Proximity prompt

Sur la map, quand un joueur est proche d'un poste (cf. la mécanique de prompt existante pour whiteboard/note/kanban), afficher un panneau flottant à l'écran (similaire à ce qui est visible dans le screenshot) :

- **Poste libre** : "Poste N" + bouton "Revendiquer cet espace" (vert).
- **Poste revendiqué par toi** : "Poste N · revendiqué" + bouton "Libérer l'espace" (rouge).
- **Poste revendiqué par autre** : "Poste N · revendiqué par X" + bouton "Demander à rejoindre" (gris/désactivé v1, ou actif v1.1).
  - v1 : pas de "demander à rejoindre" — juste informer "occupé par X". L'invitation se fait uniquement DEPUIS le claimer vers un autre user.

### Visuel sur la map

Contour pixel autour de la zone :
- **Vert** (libre, à revendiquer) : couleur `rgba(34, 197, 94, 0.5)`, épaisseur 2px.
- **Bleu** (revendiqué par toi) : couleur `rgba(59, 130, 246, 0.7)`, épaisseur 2px.
- **Rouge** (revendiqué par autre) : couleur `rgba(239, 68, 68, 0.5)`, épaisseur 2px.

Le contour est dessiné par Phaser (`Graphics`) au-dessus du tileset.

### Bulle 💬 au-dessus du personnage

Conditions d'apparition :
- Le joueur est physiquement dans un poste (`workstationId !== null`) ET ce poste est revendiqué (`claimedBy !== null`) — soit par lui-même soit par quelqu'un qu'il a invité.

État :
- **Persistante** : dès que les conditions sont remplies, la 💬 apparaît au-dessus du label nom (offset y = -54).
- **Animée** : quand LiveKit `activeSpeakers` indique que ce joueur parle, la bulle pulse (scale 1.0 → 1.3 → 1.0 toutes les 600ms) ET sa couleur de fond passe de blanc à indigo.

Pour propager l'état "en train de parler" aux autres clients (même hors zone), on relaie via Socket.IO :

```ts
'speaking_state'   { speaking: boolean }   // client → server
// rebroadcast room-wide → tous les clients reçoivent
```

Throttle client : un event toutes les 500 ms max. Rate-limit serveur : 5/sec/socket.

### Invitation UX

Quand un joueur est claimer, le HUD du poste affiche un bouton supplémentaire "Inviter quelqu'un". Click → modal de sélection (liste des joueurs présents dans la room, hors soi et hors déjà invités). Sélection → click "Inviter" → emit `workstation:invite`.

Le target reçoit un toast persistant 30 s : « Tim t'invite à son poste 4 » avec boutons « Aller au poste » et « Ignorer ». 
- "Aller au poste" : ferme le toast. Le user marche à pied. Une fois sur place, le serveur l'autorise à entrer car il est dans `invitedPlayerIds`.
- "Ignorer" : ferme le toast sans rien faire. Pas de message au claimer (le claimer peut juste voir qu'il n'est jamais venu).

Une fois sur place, le HUD du claimer affiche le invité dans une mini-liste « Avec : X, Y ». Le claimer peut « Désinviter » un participant (sortie immédiate du système ; l'utilisateur n'est pas physiquement téléporté mais perd le droit d'être dans la zone, donc à sa prochaine update de position, s'il est encore dedans, il est rejeté).

## Activity tracking — pas requis

F6 n'a pas besoin de l'activity heartbeat (c'est F8 — presence). Mais si F8 est déployé en parallèle, on peut considérer un poste claimé pendant > N min sans activité comme automatiquement libéré. **Hors scope v1** — l'utilisateur libère explicitement.

## Mode debug pour calibrer les coordonnées

Pour pouvoir caler les pixels au plus juste, ajout d'un **mode debug toggleable** côté client :

- Touche `Shift + D` dans le jeu → affiche en console + en HUD overlay les coordonnées pixel + tile du joueur en temps réel.
- Affiche aussi la grille des zones `WORKSTATIONS` actuelles (rectangles colorés transparents) pour voir si elles couvrent bien les sièges visibles.
- L'utilisateur peut alors me dire "le poste 1 va de (384, 96) à (448, 160)" et je remplis le tableau.

## Architecture code

### Nouveaux fichiers

```
server/src/workstations.ts                    # définition WORKSTATIONS + helper
server/src/workstations/WorkstationManager.ts # logique claim/release/invite + permissions
server/src/workstations/WorkstationManager.test.ts  # vitest TDD
client/src/workstations.ts                    # miroir (lecture seule)
client/src/react/components/WorkstationPanel.tsx  # panneau flottant "Revendiquer/Libérer"
client/src/react/components/WorkstationInviteModal.tsx  # modal pour inviter quelqu'un
client/src/react/components/WorkstationInviteToast.tsx  # toast reçu par l'invité
client/src/phaser/WorkstationOverlay.ts       # dessine les contours colorés
```

### Modifiés

| Fichier | Changement |
|---------|------------|
| `server/src/types.ts` | + `WorkstationState`, `workstationId` sur `PlayerState` |
| `server/src/rooms/RoomManager.ts` | initialiser `workstations` Map, recalculer `workstationId` dans `updatePlayerPosition`, rejeter les mouvements vers zones verrouillées |
| `server/src/socket/handlers.ts` | + 4 handlers `workstation:*`, émettre `workstation:initial` au join |
| `client/src/types.ts` | mirror `WorkstationState` + champ optionnel |
| `client/src/stores/gameStore.ts` | + `workstations: Map<string, WorkstationState>`, setters |
| `client/src/network/SocketManager.ts` | + 4 emits + 2 listeners (state, invite) |
| `client/src/phaser/scenes/GameScene.ts` | monter `WorkstationOverlay`, gérer la détection proximité poste → affichage `WorkstationPanel`, bulle 💬 au-dessus des occupants |
| `client/src/react/HUD.tsx` | monter `<WorkstationPanel />` + `<WorkstationInviteToast />` |

## Permissions / Sanity

| Action | Contrainte |
|--------|-----------|
| `claim` | poste libre + joueur physiquement dans la zone |
| `release` | joueur === claimer |
| `invite` | joueur === claimer ET target existe ET target pas déjà invité |
| `uninvite` | joueur === claimer ET target dans invitedPlayerIds |
| Entrer dans zone verrouillée | joueur === claimer OU dans invitedPlayerIds |

## Tests prévus

- `server/src/workstations.test.ts` : `workstationIdForPoint` retourne le bon id pour des points dans/hors zone, frontières inclusives.
- `server/src/workstations/WorkstationManager.test.ts` :
  - claim OK / déjà claimé → rejette / pas dans la zone → rejette
  - release par claimer OK / par autre rejette
  - invite par claimer OK / par autre rejette / target inexistant rejette
  - mouvement dans zone verrouillée : claimer OK, invité OK, autre rejette (retourne ancienne position)
  - release auto-clear les invités

## Hors scope v1 (YAGNI)

- "Demander à rejoindre" depuis l'extérieur (v1 = invitation seulement DEPUIS le claimer).
- Libération auto par inactivité (v1.1 si F8 dispo).
- Persistance disque (volontaire — restart libère tout).
- Capacité max par poste (le claimer décide combien il invite, pas de limite serveur dure).
- Postes non-rectangulaires.
- Effet visuel "porte qui se ferme" lors du claim.
- Présence physique (sit on chair animation).

## Coordonnées des postes (à calibrer en test)

```ts
export const WORKSTATIONS: readonly Workstation[] = [
  // Format final attendu : { id, name, minX, minY, maxX, maxY }
  // À remplir après calibration via le mode debug "Shift+D" en jeu.
  // 16 postes attendus selon le screenshot :
  //   12 dans l'open space marron (haut, 2 rangées de 6)
  //   1 dans la salle blanche (haut-droite)
  //   3 dans les 3 petits bureaux rouges (bas-droite)
];
```
