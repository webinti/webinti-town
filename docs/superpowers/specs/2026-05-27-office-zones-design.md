# Zones audio/vidéo par bureau + bulle conversation — Design (F6)

**Date** : 2026-05-27
**Statut** : design validé, en attente des coordonnées exactes des bureaux (screenshot à venir)

## Objectif

Chaque "bureau" de la map est une zone rectangulaire qui isole strictement l'audio, la vidéo (cam) ET le screen share : seules les personnes à l'intérieur du même bureau s'entendent et se voient. Hors zone : silence et noir total côté média. Quand quelqu'un parle dans un bureau, une bulle 💬 apparaît au-dessus de son personnage, visible de toute la map (signal social).

## Concept clé : zone d'appartenance

À tout instant, chaque joueur est :
- **Dans un bureau** : son `officeId` vaut une string (ex : `'bureau-1'`), ou
- **Hors de tout bureau** : `officeId === null`.

Le serveur détermine l'`officeId` à chaque mise à jour de position et le diffuse aux clients via `player_update`. Les clients adaptent leur subscription LiveKit en conséquence.

## Définition des zones

**Source** : constante TypeScript hardcodée serveur **et** miroir client (comme le `CONFERENCE_ZONE` actuel).

```ts
// server/src/officeZones.ts + miroir identique dans client/src/officeZones.ts
export interface OfficeZone {
  id: string;          // unique, ex: 'bureau-1', 'meeting-room'
  name: string;        // display, ex: 'Bureau 1', 'Salle de réunion'
  minX: number;        // pixel coords inclusive
  minY: number;
  maxX: number;
  maxY: number;
}

export const OFFICE_ZONES: readonly OfficeZone[] = [
  // À remplir une fois que l'utilisateur a fourni le screenshot annoté.
  // Format : { id: 'bureau-1', name: 'Bureau 1', minX: ?, minY: ?, maxX: ?, maxY: ? }
];

export function officeIdForPoint(x: number, y: number): string | null {
  for (const z of OFFICE_ZONES) {
    if (x >= z.minX && x <= z.maxX && y >= z.minY && y <= z.maxY) return z.id;
  }
  return null;
}
```

Les zones **ne se chevauchent pas** (postulat — l'utilisateur dessinera des rectangles distincts). Si chevauchement détecté, le premier match dans l'ordre du tableau gagne.

La `CONFERENCE_ZONE` existante devient soit la première entrée du tableau (renommée), soit reste à part en tant que zone spéciale "tout-le-monde-se-parle-au-volume-max" — à trancher au moment du remplissage : le user pourra dire si la salle de réunion remplace ou non la conference zone actuelle.

## Modèle réseau

### `PlayerState` étendu

```ts
// server/src/types.ts
export interface PlayerState {
  // ...existing...
  officeId: string | null;   // computed by server on each position update
}
```

Côté client mirror : `officeId?: string | null` (optionnel pour compat lors de la transition).

Le `publicPlayer` broadcast inclut désormais `officeId` (non sensible).

### Pas de nouvel event

L'`officeId` se propage via les `player_joined` / `player_update` existants. Aucun handler socket nouveau côté logique métier.

### Speaker activity

Pour la bulle 💬, on s'appuie **entièrement sur LiveKit côté client** :
```ts
room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => { /* ... */ })
```
Pas de relais serveur — chaque client filtre les speakers reçus et met à jour les bulles. Économique en bande passante.

## Logique d'isolement (client)

### Subscription LiveKit dynamique

À chaque changement de la liste des joueurs dans MA zone (moi ou un autre bouge), recalculer :

```ts
const myOfficeId = useGameStore.getState().players.get(localPlayerId)?.officeId;
const allowedIdentities = new Set<string>();
if (myOfficeId !== null) {
  for (const [pid, p] of players) {
    if (pid !== localPlayerId && p.officeId === myOfficeId) {
      allowedIdentities.add(pid);
    }
  }
}
await liveKitManager.setSubscribedIdentities([...allowedIdentities]);
```

La méthode `setSubscribedIdentities` existe déjà (Task d'audit antérieure le confirme : `LiveKitManager.setSubscribedIdentities`). Elle subscribe/unsubscribe les tracks audio/vidéo/screen des participants concernés.

Cas spéciaux :
- `myOfficeId === null` (hors zone) → `allowedIdentities` vide → on n'entend ni ne voit personne.
- Seul dans un bureau → également vide.
- Conference zone (si conservée séparément) : court-circuit, abonnement à tous ceux dans la conference zone.

### Détection du `recompute`

Le client recalcule à chaque :
- Changement de notre propre `officeId` (notre `player_update`).
- `player_update` d'un remote dont l'`officeId` a changé OU qui entre/sort de notre zone.
- `player_joined` / `player_left`.

Un `useEffect` dans `HUD.tsx` (ou un nouveau hook `useOfficeSubscriptions`) écoute le store et applique le calcul.

### Atténuation proximité

L'atténuation par distance dans `VideoBar.tsx` (la fonction `computeVolume`) **reste active à l'intérieur du bureau** — c'est OK car les bureaux sont petits (les joueurs sont toujours à portée). Pas de désactivation explicite nécessaire.

## Bulle 💬

### Détection

Un nouveau hook client `useSpeakerBubbles()` :
- S'abonne à `LiveKit.Room` event `ActiveSpeakersChanged`.
- Met à jour un `Map<playerId, isSpeaking: boolean>` dans le `gameStore`.
- Émet aussi un broadcast local (pas réseau) pour notifier Phaser via `GameScene`.

Pour propager aux **autres clients hors bureau** (qui veulent voir la bulle mais n'ont pas la track audio subscribed), on relaie via Socket.IO :

```
'speaking_state' { playerId, speaking: boolean }  // sender → server → room broadcast
```

Le client A est dans un bureau et parle → A détecte qu'il parle (via `RoomEvent.LocalSpeaking` ou son propre `activeSpeakers`) → A émet `speaking_state` au serveur → broadcast à toute la room → tous les clients (même hors bureau) reçoivent et mettent à jour la bulle.

**Throttle** : un event toutes les 500 ms max par client (start ET stop), pour limiter le trafic. Côté serveur, rate-limit 5/sec/socket.

### Affichage Phaser

Dans `RemotePlayer` et `Player`, méthode `setSpeaking(speaking: boolean)` qui :
- Active : crée un `Phaser.GameObjects.Text` avec `'💬'` ou un sprite bubble, depth 12, position relative `(0, -54)` (au-dessus du label).
- Désactive : détruit l'objet.

Visible à tous (pas filtré par zone). Pour soi-même aussi (sur son propre `Player`).

## Permissions / Sanity

- L'`officeId` est **calculé serveur**, jamais accepté du client. Le client ne peut pas tricher pour se mettre dans un bureau où il n'est pas géographiquement.
- `speaking_state` est purement informationnel. Le serveur ne stocke rien, juste relais. Pas d'autorité.
- Rate-limit `speaking_state` : 5/sec/socket, drop silencieux au-delà.

## UX

- **Au passage d'une frontière** : transition brutale (mute/coupure cam d'un coup). Pas d'effet de fondu en v1 — YAGNI.
- **HUD indicateur** (optionnel, à voir au plan) : afficher en haut "Vous êtes dans : *Bureau 3*" ou "Vous êtes hors zone" pour le feedback utilisateur. À discuter au moment du plan — peut être ajouté facilement.
- **Bulle** : pas d'animation complexe v1, juste apparaît/disparaît avec un fade-in CSS subtil (200ms).

## Architecture code

**Nouveaux fichiers** :
- `server/src/officeZones.ts` — définition + helper `officeIdForPoint(x, y)`.
- `client/src/officeZones.ts` — miroir identique.
- `client/src/react/hooks/useOfficeSubscriptions.ts` — gère le `setSubscribedIdentities` LiveKit selon la zone courante.
- `client/src/react/hooks/useSpeakerBubbles.ts` — détecte les speakers LiveKit, relaie via socket, met à jour le store.

**Modifiés** :
- `server/src/types.ts` — `officeId: string | null` sur `PlayerState`.
- `server/src/rooms/RoomManager.ts` — `updatePlayerPosition` recalcule `officeId` à chaque update. `addPlayer` initialise `officeId: null` puis recompute si spawn est dans une zone.
- `server/src/socket/handlers.ts` — `publicPlayer` n'exclut pas `officeId`. Nouveau handler `speaking_state` (rate-limit + broadcast).
- `client/src/types.ts` — `officeId?: string | null` sur `PlayerState`.
- `client/src/stores/gameStore.ts` — pas nécessaire, l'`officeId` arrive via `players: Map`.
- `client/src/livekit/LiveKitManager.ts` — méthode `setSubscribedIdentities` déjà existante. Si elle inclut bien les tracks vidéo + screen + audio (à vérifier), pas de changement. Sinon, l'étendre.
- `client/src/react/HUD.tsx` — monter `useOfficeSubscriptions()` + `useSpeakerBubbles()`.
- `client/src/react/components/VideoBar.tsx` — filtrer `remotes` pour cacher les tuiles des joueurs **hors** de notre bureau (sinon on voit des tuiles d'avatars qu'on ne peut ni entendre ni voir = confusion). Le filtre est `r.officeId === myOfficeId`.
- `client/src/phaser/entities/RemotePlayer.ts` + `Player.ts` — méthode `setSpeaking(b: boolean)` qui (dé)monte un GameObjects.Text « 💬 ».
- `client/src/phaser/scenes/GameScene.ts` — s'abonne au store pour réagir au changement de `speaking` Map.

## Tests

- `server/src/officeZones.test.ts` :
  - `officeIdForPoint` retourne la bonne zone pour des points dans chaque rectangle.
  - retourne `null` hors zone.
  - frontières inclusives.
- `server/src/rooms/RoomManager.officeId.test.ts` :
  - `updatePlayerPosition` recalcule `officeId` correctement (in → in, in → out, out → in).
  - `addPlayer` initialise `officeId` selon le spawn.
- Pas de tests client (UI + LiveKit difficiles à mock proprement, smoke test suffit).

## Hors scope (YAGNI)

- Zones non-rectangulaires (polygones).
- Édition runtime des zones via UI admin.
- Effet audio "porte qui s'ouvre" lors du passage frontière.
- Permissions par bureau (qui peut entrer).
- Capacité max par bureau.
- Nom de la zone affiché au-dessus du personnage.

## Coordonnées des bureaux (à compléter)

```ts
export const OFFICE_ZONES: readonly OfficeZone[] = [
  // TODO: rempli quand l'utilisateur fournit le screenshot annoté.
  // Exemple de format final :
  // { id: 'bureau-1', name: 'Bureau 1', minX: 384, minY: 64, maxX: 608, maxY: 256 },
  // { id: 'bureau-2', name: 'Bureau 2', minX: 640, minY: 64, maxX: 864, maxY: 256 },
];
```
