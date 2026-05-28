# F11 — Karts

**Statut :** design validé 2026-05-28
**Auteur :** webinti
**Issue déclenchante :** traverser la map à pied (160 px/s) est lent ; on veut un véhicule pour aller plus vite, avec une dimension fun et sociale.

## 1. Vue d'ensemble

Cinq karts sont stationnés en permanence à un **parking d'entrée** situé en pixel `(44, 356)` (tile `(1, 11)` en grille 32 px). Les karts sont alignés en rangée horizontale, espacés de 40 px, donc :

| ID       | Position parking |
|----------|------------------|
| kart-1   | (44,  356)       |
| kart-2   | (84,  356)       |
| kart-3   | (124, 356)       |
| kart-4   | (164, 356)       |
| kart-5   | (204, 356)       |

Un joueur s'approche d'un kart (distance ≤ 32 px), un prompt visuel apparaît, il presse `E` → il monte. Sa vitesse de déplacement passe de **160 px/s à 320 px/s**. Maintenir `Shift` → **boost à 480 px/s pendant 2 s**, suivi d'un **cooldown de 15 s** avant qu'un nouveau boost soit possible. Re-presser `E` → il descend ; le kart reste exactement là où il l'a laissé.

Si un kart n'a pas de conducteur et n'a pas bougé pendant **5 minutes**, il rentre automatiquement à sa position de parking d'origine (slot fixe par `id`).

## 2. Architecture

### 2.1 Types partagés (`shared` ou miroirs `server`/`client`)

```ts
export interface KartState {
  id: string;             // 'kart-1' … 'kart-5'
  x: number;              // position courante (pixels)
  y: number;
  parkingX: number;       // position de retour automatique
  parkingY: number;
  driverId: string | null;
  lastMovedAt: number;    // epoch ms — réinitialisé à chaque move ou dismount
}

export interface PlayerState {
  // … champs existants
  kartId: string | null;  // null si à pied
}

export interface RoomState {
  // … champs existants
  karts: Map<string, KartState>;
}
```

### 2.2 Serveur — `KartManager` (par room)

Modelé sur `WorkstationManager`. Méthodes :

- `init()` — crée 5 karts à leurs positions de parking respectives, `driverId: null`, `lastMovedAt: Date.now()`
- `mount(playerId, kartId)` — vérifie qu'aucun autre joueur n'occupe ce kart, qu'on est à ≤ 32 px du kart, que `player.kartId === null`. Si OK, set `driverId = playerId` + `player.kartId = kartId`. Émet `kart:state` à la room.
- `dismount(playerId)` — détache : `driverId = null`, `player.kartId = null`, met à jour `lastMovedAt = now` (point de départ du timer d'inactivité). Émet `kart:state`.
- `move(playerId, x, y)` — appelé en cascade depuis `player_move` quand `player.kartId !== null`. Met à jour `kart.x, kart.y, lastMovedAt = now`. La position du **joueur** reste collée à celle du kart (offset Y -4 px côté visuel).
- `sweepIdle()` — tick toutes les 30 s. Pour chaque kart avec `driverId === null && now - lastMovedAt > 5*60*1000` et `(x, y) !== (parkingX, parkingY)` → repositionne au parking, émet `kart:state`.

### 2.3 Serveur — validation anti-triche

Dans le handler `player_move` existant, si `player.kartId !== null`, le cap de vitesse (currently 160 px/frame * tolerance) **passe à 480**. Pas de validation du boost lui-même (trop fragile à valider sur 2-3 frames) ; on relâche juste le plafond. Risque accepté : un client modifié peut rouler en continu à 480, ce qui n'est pas critique (pas d'avantage compétitif au sens fort).

### 2.4 Serveur — collision push

Quand un kart en mouvement entre en collision avec un autre joueur (calcul AABB sur le sprite du kart 28×20 + sprite joueur 24×24) :

1. Vecteur knockback = direction du kart × 24 px
2. `targetX = otherPlayer.x + dx`, `targetY = otherPlayer.y + dy`
3. Si la nouvelle position est dans un mur ou un workstation occupé par autrui → on annule, le kart est physiquement bloqué (comme contre un mur).
4. Sinon → le serveur applique la nouvelle position sur l'autre joueur et broadcast un `player_update`. Le client voit son sprite glisser (interpolation 100 ms).

Pas de dégâts, pas d'animation supplémentaire.

### 2.5 Serveur — règles d'accès

- Un kart **ne peut pas** entrer dans un workstation rectangle occupé par un autre joueur (même règle que `canEnter` à pied). Bloqué par collision.
- Un joueur **en kart** ne peut **pas** revendiquer (`claim`) un workstation — le handler `workstation:claim` rejette si `player.kartId !== null`. Il faut descendre d'abord.
- La salle de conférence (zone audio cachée) est traversable en kart sans effet audio particulier (la zone audio reste basée sur la position, pas sur le moyen de transport).

### 2.6 Client — `KartOverlay` et input

- Nouveau `client/src/phaser/KartOverlay.ts`, parallèle à `WorkstationOverlay`. Dessine les 5 sprites de kart à `depth: 8` (juste sous les joueurs à 9). À chaque frame, lit `state.karts` du store et redessine.
- Sprite kart : **Phaser Graphics procédural**, 28×20 px vue de dessus. Corps jaune `0xfacc15`, contour noir `0x000000`, 2 petits cercles noirs aux 4 coins pour les roues, un petit triangle noir à l'avant pour indiquer la direction.
- Quand un joueur monte (`player.kartId === <id>` côté store), son sprite Player/RemotePlayer est rendu avec un offset Y `-4 px` et `depth: 10` (au-dessus du kart).
- Input proximité : GameScene calcule chaque frame `nearestKartId` (kart libre à ≤ 32 px du player). Affiche un prompt "E pour monter" similaire à celui des workstations. Sur `E` → emit `kart:mount`.
- Input boost : touche `Shift`. Tant que `Shift` est appuyée et qu'on a du "fuel" (jauge), `Player.speed` côté client passe à 480 et un `kart:boost_start` est émis vers le serveur (qui relâche le cap pour 2 s). Jauge de boost = 100 % au plein, vide en 2 s, recharge en 15 s.
- Trail de boost : 3 cercles oranges `0xf97316` qui s'estompent (alpha 0.6 → 0) derrière le kart sur 200 ms. Visible par tous (rendu local sur le `RemotePlayer`/`Player` quand `boost === true`).

### 2.7 Vitesse côté client

Dans `Player.ts` (et `RemotePlayer.ts` pour le rendu) :

```ts
get effectiveSpeed(): number {
  if (this.kartId === null) return 160;
  return this.boosting ? 480 : 320;
}
```

Le `kartId` et le `boosting` viennent du store (synchronisés via `kart:state` et `player_update`).

## 3. Boost — UX et anti-spam

- **Affichage jauge :** rectangle horizontal 24×3 px sous le sprite du kart, visible **uniquement par le conducteur** (overlay local). Vert `0x22c55e` quand pleine, vide pendant cooldown, repasse au vert quand rechargée.
- **Trail :** 3 cercles orange qui suivent la trajectoire récente du kart pendant la phase de boost. Visible par tous les joueurs de la room.
- **Anti-spam :** un nouveau boost ne peut démarrer que si la jauge est à 100 %. Le cooldown est de **15 s** après la fin du boost, soit un cycle minimal de **2 s boost + 15 s cooldown = 17 s entre 2 boosts consécutifs**. La recharge de la jauge est linéaire sur ces 15 s (0 % → 100 %).
- **Émissions :** `kart:boost_start` au départ du boost, `kart:boost_end` à la fin (épuisement ou relâche). Pas de synchro fine de la jauge serveur-client — chacun calcule la sienne.

## 4. Edge cases

- **Déconnexion en kart :** sur `socket disconnect`, le serveur appelle `dismount(playerId)`. Le kart reste à sa position, `lastMovedAt = now`. Donc retour parking dans 5 min.
- **Boost interrompu par dismount :** le boost se reset côté client (jauge à 100 %), la vitesse repasse à 160 immédiatement.
- **Persistance :** **aucune** persistance (ni JSON ni PocketBase). Au restart serveur, les 5 karts respawn au parking. C'est volontaire — état éphémère.
- **Sprite z-order :** kart `depth: 8`, joueur sur kart `depth: 10`, prompt "E pour monter" `depth: 20`.
- **Plusieurs joueurs claim le même kart en simultané :** premier `kart:mount` arrivé au serveur gagne, les autres reçoivent le `kart:state` mis à jour et leur prompt disparaît.
- **Kart bloqué dans un coin par un mur :** comportement normal de collision, on tourne pour sortir. Pas de "reset" forcé.
- **Boost désactivé si on n'est pas sur un kart :** `Shift` à pied n'a aucun effet sur la vitesse (160 reste 160). On peut éventuellement remapper plus tard si on veut un `Shift+pas` pour les piétons.

## 5. Décisions explicites (YAGNI)

Ces choses ne sont **pas** dans le scope F11 :

- Pas de système de "klaxon" / son de kart.
- Pas de skins de kart différents par joueur.
- Pas de course / chronomètre. → **Extension future F12 (circuit à côté de la map)** : piste dédiée hors zone bureaux, ligne de départ/arrivée, comptage de tours, classement live. Sera brainstormé séparément après livraison de F11. Architecturalement, F11 doit laisser la porte ouverte (positions et boost dispo dans toute zone "kart-friendly", pas seulement le bureau).
- Pas de durabilité / panne / dégâts.
- Pas d'interdiction de kart par zone (le push des joueurs est l'unique mécanique d'interaction).
- Pas de UI pour voir qui pilote quel kart à distance — c'est lisible visuellement (sprite joueur sur sprite kart).

## 6. Fichiers à créer/modifier

**Nouveaux :**
- `server/src/KartManager.ts` (+ tests TDD)
- `shared/src/types/Kart.ts` (ou miroirs client/server selon la convention du repo)
- `client/src/phaser/KartOverlay.ts`
- `client/src/karts.ts` (mirroir lecture-seule des positions de parking, parallèle à `client/src/workstations.ts`)

**Modifiés :**
- `server/src/RoomManager.ts` — wire `KartManager`, init au join, sweepIdle dans `startTickLoops`
- `server/src/socket/handlers.ts` (ou équivalent) — handlers `kart:mount`, `kart:dismount`, `kart:boost_start`, `kart:boost_end` ; relâche cap vitesse dans `player_move` ; rejet `workstation:claim` si `kartId !== null`
- `server/src/types/PlayerState.ts` — ajouter `kartId: string | null`
- `server/src/types/RoomState.ts` — ajouter `karts: Map<string, KartState>`
- `client/src/store/gameStore.ts` — slice `karts: Map<string, KartState>`, `localKartId`, helpers
- `client/src/SocketManager.ts` — emits `sendKartMount`, `sendKartDismount`, `sendKartBoostStart/End` + subscribers `onKartState`
- `client/src/phaser/entities/Player.ts` + `RemotePlayer.ts` — `effectiveSpeed`, rendu offset Y quand sur kart, trail de boost
- `client/src/phaser/scenes/GameScene.ts` — instancie `KartOverlay`, proximity check, prompt "E", input handlers
- `client/src/react/HUD.tsx` — éventuel petit indicateur "🛺 Sur un kart" (optionnel, à voir au moment du build)

## 7. Tests (TDD côté serveur)

- `KartManager.init()` crée 5 karts aux bonnes positions, tous libres
- `mount` rejette si kart déjà occupé / joueur déjà en kart / trop loin
- `dismount` libère et réinitialise `lastMovedAt`
- `move` met à jour position et timestamp
- `sweepIdle` repositionne les karts libres et immobiles depuis >5 min, ignore les autres
- Cap vitesse `player_move` accepte 480 si en kart, rejette si à pied
- `workstation:claim` rejeté si conducteur de kart
- Collision push : repositionne la cible si position libre, bloque le kart sinon

Côté client : tests d'unité sur `Player.effectiveSpeed` selon `kartId` + `boosting`.

## 8. Calibration parking

Position d'origine confirmée par l'utilisateur : pixel `(44, 356)`, tile `(1, 11)`. Les 5 karts sont posés en rangée horizontale à `y = 356`, `x ∈ {44, 84, 124, 164, 204}`. À ajuster si certaines positions chevauchent un mur ou un meuble — vérification visuelle à l'implémentation, ajustements mineurs autorisés sans nouveau spec.
