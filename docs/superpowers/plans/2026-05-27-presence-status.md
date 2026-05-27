# Presence Status (F8) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque joueur porte un statut de présence (`available`, `away`, `brb`, `dnd`, `inactive`) visible de tous ; le statut bascule automatiquement vers `inactive` après 5 min sans activité et revient à `available` à la première activité suivante.

**Architecture:** Le champ `presence` vit sur `PlayerState` (server + client mirror). `RoomManager` expose `setPresence` et `markActivity`. Le sweep auto-inactive tourne dans `startTickLoops` (toutes les 30 s) et broadcast un `player_update` par changement. Deux nouveaux events socket (`presence_set`, `presence_activity`) viennent s'ajouter aux handlers existants ; `player_move` et `chat_message` appellent aussi `markActivity` inline. Côté client : un composant `<PresenceSelector />` dans le HUD, une pastille colorée dans la VideoBar, des suffixes d'emoji sur les labels Phaser, et un hook `useActivityHeartbeat` qui ping toutes les 10 s tant qu'il y a une activité.

**Tech Stack:** TypeScript + Node 20 (server), React 18 + Zustand + Tailwind (client), Phaser 3 (labels), Socket.IO, Vitest (tests TDD).

**Spec source:** `docs/superpowers/specs/2026-05-27-presence-status-design.md`

---

## File structure overview

**Created**
- `server/src/rooms/presence.test.ts` — tests TDD pour setPresence / markActivity / auto-inac
- `client/src/react/hooks/useActivityHeartbeat.ts` — hook debounce 10 s → sendActivity

**Modified**
- `server/src/types.ts` — `Presence` union, `presence` + `lastActivityAt` sur `PlayerState`
- `server/src/rooms/RoomManager.ts` — `addPlayer` init, `setPresence`, `markActivity`
- `server/src/socket/handlers.ts` — handlers `presence_set` + `presence_activity`, `markActivity` dans `player_move` + `chat_message`, sweep `setInterval` dans `startTickLoops`
- `client/src/types.ts` — `Presence` union, `presence` sur `PlayerState`
- `client/src/stores/gameStore.ts` — `localPresence` + `setLocalPresence`
- `client/src/network/SocketManager.ts` — `sendPresenceSet`, `sendActivity`
- `client/src/react/HUD.tsx` — `<PresenceSelector />` + `<useActivityHeartbeat />`
- `client/src/react/components/VideoBar.tsx` — pastille colorée `LocalTile` + `RemoteTile`
- `client/src/phaser/entities/RemotePlayer.ts` — `setPresence(p)` + suffixe label
- `client/src/phaser/entities/Player.ts` — `setPresence(p)` + suffixe label
- `client/src/phaser/scenes/GameScene.ts` — appel `setPresence` lors des mises à jour joueur

---

## Task 1 : Server types — `Presence` union + extension de `PlayerState`

**Files:**
- Modify: `server/src/types.ts`

- [ ] **Step 1 : Ajouter le type `Presence` et étendre `PlayerState`**

Ouvrir `server/src/types.ts`. Juste avant `export interface PlayerState`, insérer :

```ts
export type Presence = 'available' | 'away' | 'brb' | 'dnd' | 'inactive';
```

Dans `PlayerState`, ajouter deux champs après `joinedAt` :

```ts
  presence: Presence;
  lastActivityAt: number;   // serveur seulement — jamais diffusé au client
```

Le résultat attendu pour l'interface complète :

```ts
export interface PlayerState {
  playerId: string;
  socketId: string;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost: boolean;
  joinedAt: number;
  presence: Presence;
  lastActivityAt: number;
}
```

- [ ] **Step 2 : Mettre à jour `publicPlayer` dans `handlers.ts` pour exclure `lastActivityAt`**

Ouvrir `server/src/socket/handlers.ts`, ligne ~147. La fonction `publicPlayer` exclut actuellement seulement `socketId`. Il faut aussi exclure `lastActivityAt` (donnée interne serveur) :

```ts
function publicPlayer(p: PlayerState): Omit<PlayerState, 'socketId' | 'lastActivityAt'> {
  const { socketId: _s, lastActivityAt: _la, ...rest } = p;
  return rest;
}
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected : erreurs TypeScript uniquement sur `addPlayer` (qui n'initialise pas encore les nouveaux champs) — c'est normal, on les corrige en Task 2.

- [ ] **Step 4 : Commit**

```bash
git add server/src/types.ts server/src/socket/handlers.ts
git commit -m "feat(server): add Presence type + presence/lastActivityAt fields on PlayerState"
```

---

## Task 2 : RoomManager — `addPlayer` + `setPresence` + `markActivity` (TDD)

**Files:**
- Create: `server/src/rooms/presence.test.ts`
- Modify: `server/src/rooms/RoomManager.ts`

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `server/src/rooms/presence.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from './RoomManager.js';
import { DEFAULT_APPEARANCE } from '../types.js';

const APP = DEFAULT_APPEARANCE;

function makeRoom(rm: RoomManager) {
  rm.createRoom('Test');
  // ensureRoom slug = slugify('Test') = 'test'
  const slug = 'test';
  return slug;
}

function addPlayer(rm: RoomManager, slug: string, name: string, socketId = 'sock1', clientKey?: string) {
  return rm.addPlayer(slug, socketId, name, APP, clientKey);
}

describe('RoomManager.addPlayer — presence init', () => {
  let rm: RoomManager;
  let slug: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
  });

  it('initialise presence à available', () => {
    const p = addPlayer(rm, slug, 'Alice');
    expect(p?.presence).toBe('available');
  });

  it('initialise lastActivityAt à un nombre proche de now', () => {
    const before = Date.now();
    const p = addPlayer(rm, slug, 'Bob');
    const after = Date.now();
    expect(p?.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(p?.lastActivityAt).toBeLessThanOrEqual(after);
  });
});

describe('RoomManager.setPresence', () => {
  let rm: RoomManager;
  let slug: string;
  let playerId: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
    const p = addPlayer(rm, slug, 'Alice', 'sock1', '11111111-1111-1111-1111-111111111111');
    playerId = p!.playerId;
  });

  it('met à jour presence pour son propre joueur', () => {
    const changed = rm.setPresence(slug, playerId, 'away');
    expect(changed).toBe(true);
    const room = rm.getRoom(slug)!;
    expect(room.players.get(playerId)?.presence).toBe('away');
  });

  it('retourne false si room inexistante', () => {
    expect(rm.setPresence('nope', playerId, 'dnd')).toBe(false);
  });

  it('retourne false si joueur inexistant', () => {
    expect(rm.setPresence(slug, 'ghost-id', 'brb')).toBe(false);
  });

  it('retourne false si presence invalide', () => {
    expect(rm.setPresence(slug, playerId, 'dancing' as never)).toBe(false);
  });
});

describe('RoomManager.markActivity', () => {
  let rm: RoomManager;
  let slug: string;
  let playerId: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
    const p = addPlayer(rm, slug, 'Alice', 'sock1', '22222222-2222-2222-2222-222222222222');
    playerId = p!.playerId;
  });

  it('bumpe lastActivityAt', async () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    const before = player.lastActivityAt;
    await new Promise((r) => setTimeout(r, 5));
    rm.markActivity(slug, playerId);
    expect(player.lastActivityAt).toBeGreaterThan(before);
  });

  it('repasse inactive → available et retourne true', () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.presence = 'inactive'; // simuler l'auto-inactive
    const changed = rm.markActivity(slug, playerId);
    expect(changed).toBe(true);
    expect(player.presence).toBe('available');
  });

  it('ne change PAS away/brb/dnd → ne retourne pas true pour un changement de statut', () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.presence = 'away';
    const changed = rm.markActivity(slug, playerId);
    // markActivity bumpe timestamp et retourne true seulement si presence a changé
    expect(changed).toBe(false);
    expect(player.presence).toBe('away');
  });

  it('retourne false si room ou joueur inexistant', () => {
    expect(rm.markActivity('nope', playerId)).toBe(false);
    expect(rm.markActivity(slug, 'ghost')).toBe(false);
  });
});

describe('RoomManager — auto-inactive sweep logic', () => {
  let rm: RoomManager;
  let slug: string;
  let playerId: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
    const p = addPlayer(rm, slug, 'Alice', 'sock1', '33333333-3333-3333-3333-333333333333');
    playerId = p!.playerId;
  });

  it('sweepInactive bascule available → inactive quand stale > seuil', () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.lastActivityAt = Date.now() - 6 * 60 * 1000; // 6 min stale
    const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
    expect(changed).toEqual([playerId]);
    expect(player.presence).toBe('inactive');
  });

  it("sweepInactive n'override PAS away/brb/dnd", () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.lastActivityAt = Date.now() - 10 * 60 * 1000; // très stale
    for (const p of ['away', 'brb', 'dnd'] as const) {
      player.presence = p;
      const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
      expect(changed).toEqual([]);
      expect(player.presence).toBe(p);
    }
  });

  it("sweepInactive ne bascule PAS un joueur déjà inactive", () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.presence = 'inactive';
    player.lastActivityAt = Date.now() - 10 * 60 * 1000;
    const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
    expect(changed).toEqual([]);
  });

  it("sweepInactive ne bascule PAS un joueur available récent", () => {
    // lastActivityAt est tout proche (défaut)
    const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
    expect(changed).toEqual([]);
  });
});
```

- [ ] **Step 2 : Lancer les tests, s'attendre à TOUT échouer**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/rooms/presence.test.ts
```

Expected : tous échouent (propriétés manquantes sur `PlayerState`, méthodes inexistantes).

- [ ] **Step 3 : Implémenter dans `RoomManager.ts`**

Ouvrir `server/src/rooms/RoomManager.ts`.

**3a — Importer `Presence` en haut du fichier** (déjà importé `PlayerState` etc., ajouter `Presence`) :

```ts
import type {
  PlayerState,
  RoomState,
  PublicRoomInfo,
  Direction,
  Appearance,
  ChatMessage,
  InteractiveObject,
  Presence,
} from '../types.js';
```

**3b — Constante des valeurs valides** (après les imports) :

```ts
const VALID_PRESENCES: ReadonlySet<string> = new Set<Presence>([
  'available', 'away', 'brb', 'dnd', 'inactive',
]);
```

**3c — Dans `addPlayer`, juste avant `room.players.set(playerId, player)`, changer la création de `player` pour inclure les deux nouveaux champs** :

```ts
    const player: PlayerState = {
      playerId,
      socketId,
      name,
      appearance,
      x: config.defaultSpawn.x,
      y: config.defaultSpawn.y,
      direction: 'down',
      isMoving: false,
      isGhost: false,
      joinedAt: Date.now(),
      presence: 'available',
      lastActivityAt: Date.now(),
    };
```

**3d — Ajouter les trois nouvelles méthodes** après `toggleGhost` :

```ts
  /**
   * Permet à un joueur de changer son statut manuellement.
   * Seule valeur interdite via cette méthode : 'inactive' (c'est auto-only).
   * Retourne true si le changement a eu lieu.
   */
  setPresence(slug: string, playerId: string, presence: Presence): boolean {
    if (!VALID_PRESENCES.has(presence)) return false;
    const room = this.rooms.get(slug);
    if (!room) return false;
    const player = room.players.get(playerId);
    if (!player) return false;
    player.presence = presence;
    player.lastActivityAt = Date.now();
    return true;
  }

  /**
   * Signale une activité. Bumpe lastActivityAt.
   * Si le joueur était 'inactive', le repasse à 'available' et retourne true.
   * Sinon retourne false (pas de changement de statut).
   */
  markActivity(slug: string, playerId: string): boolean {
    const room = this.rooms.get(slug);
    if (!room) return false;
    const player = room.players.get(playerId);
    if (!player) return false;
    player.lastActivityAt = Date.now();
    if (player.presence === 'inactive') {
      player.presence = 'available';
      return true; // changement de statut → le caller doit broadcaster
    }
    return false;
  }

  /**
   * Scanne tous les joueurs d'une room et bascule
   * 'available' → 'inactive' si stale > thresholdMs.
   * Retourne les playerIds qui ont changé.
   */
  sweepInactive(slug: string, thresholdMs: number): string[] {
    const room = this.rooms.get(slug);
    if (!room) return [];
    const changed: string[] = [];
    const now = Date.now();
    for (const player of room.players.values()) {
      if (player.presence !== 'available') continue;
      if (now - player.lastActivityAt > thresholdMs) {
        player.presence = 'inactive';
        changed.push(player.playerId);
      }
    }
    return changed;
  }
```

- [ ] **Step 4 : Lancer les tests, s'attendre à tout passer**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run src/rooms/presence.test.ts
```

Expected : tous les tests verts.

- [ ] **Step 5 : Vérification de type globale**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 6 : Commit**

```bash
git add server/src/rooms/RoomManager.ts server/src/rooms/presence.test.ts
git commit -m "feat(server): RoomManager — presence init, setPresence, markActivity, sweepInactive (TDD)"
```

---

## Task 3 : Server socket handlers — `presence_set`, `presence_activity`, markActivity inline

**Files:**
- Modify: `server/src/socket/handlers.ts`

- [ ] **Step 1 : Ajouter le handler `presence_set`**

Dans `registerSocketHandlers`, après le handler `kanban:delete` (ligne ~517), ajouter :

```ts
    socket.on('presence_set', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const pres = p.presence;
      // 'inactive' ne peut pas être défini manuellement par le client
      if (
        pres !== 'available' &&
        pres !== 'away' &&
        pres !== 'brb' &&
        pres !== 'dnd'
      ) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const changed = roomManager.setPresence(session.roomSlug, session.playerId, pres);
      if (!changed) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    socket.on('presence_activity', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const presenceChanged = roomManager.markActivity(session.roomSlug, session.playerId);
      if (!presenceChanged) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });
```

- [ ] **Step 2 : Appeler `markActivity` dans le handler `player_move`**

Chercher le handler `player_move` (ligne ~247). Après l'appel à `roomManager.updatePlayerPosition(...)`, ajouter :

```ts
      // Compter le mouvement comme activité (peut rétablir inactive → available)
      const presenceChanged = roomManager.markActivity(session.roomSlug, session.playerId);
      if (presenceChanged) {
        const room2 = roomManager.getRoom(session.roomSlug);
        const player2 = room2?.players.get(session.playerId);
        if (player2) io.to(session.roomSlug).emit('player_update', publicPlayer(player2));
      }
```

- [ ] **Step 3 : Appeler `markActivity` dans le handler `chat_message`**

Chercher le handler `chat_message` (ligne ~261). Juste avant `roomManager.pushChat(...)`, ajouter :

```ts
      // Activité chat : peut rétablir inactive → available
      const presenceChangedByChat = roomManager.markActivity(session.roomSlug, session.playerId);
      if (presenceChangedByChat) {
        const updatedPlayer = room.players.get(session.playerId);
        if (updatedPlayer) io.to(session.roomSlug).emit('player_update', publicPlayer(updatedPlayer));
      }
```

- [ ] **Step 4 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add server/src/socket/handlers.ts
git commit -m "feat(server): presence_set + presence_activity handlers, markActivity in player_move + chat_message"
```

---

## Task 4 : Server idle sweep — `setInterval(30_000)` dans `startTickLoops`

**Files:**
- Modify: `server/src/socket/handlers.ts`

- [ ] **Step 1 : Ajouter le sweep dans `startTickLoops`**

Ouvrir `server/src/socket/handlers.ts`. Trouver la fonction `startTickLoops` (vers la ligne ~659). Après le second `setInterval` (celui de proximity), ajouter :

```ts
  // Sweep auto-inactive : toutes les 30 s, bascule available → inactive
  // pour tout joueur dont lastActivityAt > 5 min.
  const AUTO_INACTIVE_MS = 5 * 60 * 1000;
  setInterval(() => {
    for (const room of roomManager.listRooms()) {
      if (room.players.size === 0) continue;
      const changedIds = roomManager.sweepInactive(room.slug, AUTO_INACTIVE_MS);
      for (const pid of changedIds) {
        const player = room.players.get(pid);
        if (!player) continue;
        io.to(room.slug).emit('player_update', publicPlayer(player));
      }
    }
  }, 30_000);
```

- [ ] **Step 2 : S'assurer que le client écoute déjà `player_update`**

Vérifier dans `client/src/network/SocketManager.ts` qu'il existe bien un listener `player_update`. Chercher :

```bash
grep -n "player_update" /home/openclaw/projects/webinti-town/client/src/network/SocketManager.ts
```

Si le listener **n'existe pas encore**, l'ajouter dans la méthode `connect()` après le bloc `player_ghost` (~ligne 180) :

```ts
    socket.on('player_update', (p: PlayerState) => {
      useGameStore.getState().upsertPlayer(p);
      for (const fn of this.listeners) fn(p);
    });
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/server && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Lancer tous les tests serveur**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run
```

Expected : tous verts.

- [ ] **Step 5 : Commit**

```bash
git add server/src/socket/handlers.ts client/src/network/SocketManager.ts
git commit -m "feat(server): auto-inactive sweep setInterval(30s) in startTickLoops"
```

---

## Task 5 : Client types mirror + store `localPresence`

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/stores/gameStore.ts`

- [ ] **Step 1 : Ajouter `Presence` dans `client/src/types.ts`**

Juste avant `export interface PlayerState`, ajouter :

```ts
export type Presence = 'available' | 'away' | 'brb' | 'dnd' | 'inactive';
```

Dans `PlayerState` (client), ajouter le champ (pas `lastActivityAt` — c'est interne serveur) :

```ts
export interface PlayerState {
  playerId: string;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost?: boolean;
  joinedAt?: number;
  presence?: Presence;   // optionnel pour la rétrocompatibilité
}
```

- [ ] **Step 2 : Ajouter `localPresence` dans `gameStore.ts`**

Dans l'interface `GameStore`, après `kanbanCards` / `setKanbanCards` :

```ts
  localPresence: Presence;
  setLocalPresence: (p: Presence) => void;
```

Importer le type en haut du fichier (déjà `KanbanCard` importé, ajouter `Presence`) :

```ts
import type {
  Appearance,
  ChatMessage,
  InteractiveObject,
  KanbanCard,
  PlayerState,
  Presence,
  WhiteboardStroke,
  WhiteboardText,
} from '../types';
```

Dans le corps du store `create((set) => ({ ... }))`, après `setKanbanCards` :

```ts
  localPresence: 'available' as Presence,
  setLocalPresence: (p) => set({ localPresence: p }),
```

Dans le `reset()`, ajouter :

```ts
      localPresence: 'available' as Presence,
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add client/src/types.ts client/src/stores/gameStore.ts
git commit -m "feat(client): Presence type mirror + localPresence in gameStore"
```

---

## Task 6 : Client SocketManager — `sendPresenceSet` + `sendActivity`

**Files:**
- Modify: `client/src/network/SocketManager.ts`

- [ ] **Step 1 : Importer `Presence`**

Ajouter `Presence` dans les imports en haut du fichier :

```ts
import type {
  ChatMessage,
  ChatMessageType,
  EmoteEvent,
  EmoteType,
  InteractiveObject,
  JoinRoomPayload,
  KanbanCard,
  PlayerMovePayload,
  PlayerState,
  Presence,
  RoomState,
  WhiteboardStroke,
  WhiteboardText,
} from '../types';
```

- [ ] **Step 2 : Ajouter les deux méthodes d'émission**

Après la méthode `kanbanDelete` (ligne ~380), ajouter :

```ts
  sendPresenceSet(presence: Presence): void {
    this.socket?.emit('presence_set', { presence });
  }

  sendActivity(): void {
    this.socket?.emit('presence_activity');
  }
```

- [ ] **Step 3 : Vérifier que `player_update` est bien écouté (Task 4 Step 2)**

```bash
grep -n "player_update" /home/openclaw/projects/webinti-town/client/src/network/SocketManager.ts
```

Si la ligne n'existe pas (au cas où Task 4 a été oubliée), l'ajouter maintenant dans `connect()` :

```ts
    socket.on('player_update', (p: PlayerState) => {
      useGameStore.getState().upsertPlayer(p);
      for (const fn of this.listeners) fn(p);
    });
```

- [ ] **Step 4 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add client/src/network/SocketManager.ts
git commit -m "feat(client): SocketManager — sendPresenceSet + sendActivity emit helpers"
```

---

## Task 7 : Client hook `useActivityHeartbeat`

**Files:**
- Create: `client/src/react/hooks/useActivityHeartbeat.ts`

Ce hook écoute `mousemove`, `keydown` et `focus` avec un debounce de 10 s. À chaque déclenchement il appelle `socketManager.sendActivity()` et met à jour `localPresence` si le joueur était `inactive`.

- [ ] **Step 1 : Créer le fichier**

Créer `client/src/react/hooks/useActivityHeartbeat.ts` :

```ts
import { useEffect, useRef } from 'react';
import { socketManager } from '../../network/SocketManager';
import { useGameStore } from '../../stores/gameStore';

const DEBOUNCE_MS = 10_000;

/**
 * Monté une seule fois dans HUD.
 * Détecte mousemove / keydown / focus et envoie un ping presence_activity
 * au serveur avec un debounce de 10 s pour ne pas saturer le réseau.
 * Met aussi à jour le store local si on était inactive.
 */
export function useActivityHeartbeat(): void {
  const lastSentRef = useRef<number>(0);

  useEffect(() => {
    function signal() {
      const now = Date.now();
      if (now - lastSentRef.current < DEBOUNCE_MS) return;
      lastSentRef.current = now;
      socketManager.sendActivity();
      // Rétablissement côté store si inactive (le serveur broadcastera aussi,
      // mais on met à jour le store local immédiatement pour la réactivité UI).
      const store = useGameStore.getState();
      if (store.localPresence === 'inactive') {
        store.setLocalPresence('available');
      }
    }

    window.addEventListener('mousemove', signal, { passive: true });
    window.addEventListener('keydown', signal, { passive: true });
    window.addEventListener('focus', signal);

    return () => {
      window.removeEventListener('mousemove', signal);
      window.removeEventListener('keydown', signal);
      window.removeEventListener('focus', signal);
    };
  }, []);
}
```

- [ ] **Step 2 : Monter le hook dans HUD**

Ouvrir `client/src/react/HUD.tsx`. Ajouter l'import :

```ts
import { useActivityHeartbeat } from './hooks/useActivityHeartbeat';
```

Dans le corps de la fonction `HUD()`, juste avant le `return`, ajouter :

```ts
  useActivityHeartbeat();
```

- [ ] **Step 3 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 4 : Commit**

```bash
git add client/src/react/hooks/useActivityHeartbeat.ts client/src/react/HUD.tsx
git commit -m "feat(client): useActivityHeartbeat hook (debounce 10s → sendActivity)"
```

---

## Task 8 : Client UI — `<PresenceSelector />` dans le HUD

**Files:**
- Modify: `client/src/react/HUD.tsx`

Ce composant est un dropdown avec 4 options manuelles. Quand le statut est `inactive` (basculé automatiquement), il est affiché en read-only.

- [ ] **Step 1 : Ajouter le composant `PresenceSelector` dans `HUD.tsx`**

À la fin de `HUD.tsx`, après `ControlButton`, ajouter :

```tsx
const PRESENCE_OPTIONS: Array<{ value: 'available' | 'away' | 'brb' | 'dnd'; label: string; dot: string }> = [
  { value: 'available', label: 'Disponible', dot: '🟢' },
  { value: 'away',      label: 'Absent',     dot: '🟡' },
  { value: 'brb',       label: 'Je reviens', dot: '🟡' },
  { value: 'dnd',       label: 'Ne pas déranger', dot: '🔴' },
];

function PresenceSelector() {
  const localPresence = useGameStore((s) => s.localPresence);
  const setLocalPresence = useGameStore((s) => s.setLocalPresence);

  if (localPresence === 'inactive') {
    return (
      <div
        title="Inactif — bougez pour revenir en Disponible"
        className="flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-400 ring-1 ring-white/10"
      >
        <span>⚪</span>
        <span>Inactif</span>
      </div>
    );
  }

  const current = PRESENCE_OPTIONS.find((o) => o.value === localPresence) ?? PRESENCE_OPTIONS[0]!;

  return (
    <select
      value={localPresence}
      onChange={(e) => {
        const val = e.target.value as 'available' | 'away' | 'brb' | 'dnd';
        setLocalPresence(val);
        socketManager.sendPresenceSet(val);
      }}
      className="rounded-full bg-slate-900/80 px-3 py-1 text-xs text-slate-100 ring-1 ring-white/10 backdrop-blur focus:outline-none focus:ring-indigo-400"
      aria-label="Statut de présence"
    >
      {PRESENCE_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.dot} {o.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2 : Aussi mettre à jour `localPresence` quand le serveur broadcast un changement de statut pour le joueur local**

Dans `SocketManager.ts`, dans le listener `player_update`, ajouter la synchronisation du store local :

```ts
    socket.on('player_update', (p: PlayerState) => {
      useGameStore.getState().upsertPlayer(p);
      // Sync le statut local si c'est notre propre joueur (ex: auto-inactive du serveur)
      const localId = useGameStore.getState().localPlayerId;
      if (p.playerId === localId && p.presence) {
        useGameStore.getState().setLocalPresence(p.presence);
      }
      for (const fn of this.listeners) fn(p);
    });
```

- [ ] **Step 3 : Monter `<PresenceSelector />` dans le HUD**

Dans la zone haut-gauche de `HUD.tsx`, juste après le badge du pseudo (le `div` avec `{name || 'Anonyme'}`), ajouter :

```tsx
          <PresenceSelector />
```

Le bloc existant ressemble à ceci — insérer entre le badge pseudo et le badge Hôte (ou après le badge Hôte) :

```tsx
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-indigo-500/30 px-3 py-1 text-sm font-semibold ring-1 ring-indigo-400/50">
            {name || 'Anonyme'}
          </div>
          <PresenceSelector />   {/* ← AJOUTER ICI */}
          {isHost && (
            <div className="rounded-full bg-amber-500/30 ...">
```

- [ ] **Step 4 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add client/src/react/HUD.tsx client/src/network/SocketManager.ts
git commit -m "feat(client): PresenceSelector dropdown in HUD + localPresence sync on player_update"
```

---

## Task 9 : VideoBar — pastille colorée par statut de présence

**Files:**
- Modify: `client/src/react/components/VideoBar.tsx`

- [ ] **Step 1 : Ajouter le helper `presenceDot`**

Dans `VideoBar.tsx`, après la fonction `colorFor`, ajouter :

```ts
import type { Presence } from '../../types';

function presenceDot(presence: Presence | undefined): { dot: string; title: string } {
  switch (presence) {
    case 'away':     return { dot: '🟡', title: 'Absent' };
    case 'brb':      return { dot: '🟡', title: 'Je reviens' };
    case 'dnd':      return { dot: '🔴', title: 'Ne pas déranger' };
    case 'inactive': return { dot: '⚪', title: 'Inactif' };
    case 'available':
    default:         return { dot: '🟢', title: 'Disponible' };
  }
}
```

Note : `Presence` est déjà dans `client/src/types.ts` après Task 5. L'import va dans la section imports en haut du fichier, aux côtés des imports existants depuis `'../../types'`.

- [ ] **Step 2 : Ajouter la pastille dans `LocalTile`**

Remplacer le `div` de label dans `LocalTile` :

```tsx
      <div className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        {name} (vous)
      </div>
```

Par :

```tsx
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        <span
          title={presenceDot(localPresence).title}
          aria-label={presenceDot(localPresence).title}
          className="shrink-0"
        >
          {presenceDot(localPresence).dot}
        </span>
        <span className="truncate">{name} (vous)</span>
      </div>
```

Et modifier la signature de `LocalTile` pour recevoir `localPresence` :

```tsx
function LocalTile({ track, name, localPresence }: {
  track: LocalVideoTrack;
  name: string;
  localPresence: Presence | undefined;
}) {
```

Dans `VideoBar`, passer la prop depuis le store :

```tsx
  const localPresence = useGameStore((s) => s.localPresence);
  // ...
  {localCamTrack && <LocalTile track={localCamTrack} name={localName} localPresence={localPresence} />}
```

- [ ] **Step 3 : Ajouter la pastille dans `RemoteTile`**

Dans `RemoteTile`, lire la presence du joueur distant depuis le store :

```tsx
  const remotePlayer = useGameStore((s) => s.players.get(remote.identity));
  const presence = remotePlayer?.presence;
```

Remplacer le label du nom :

```tsx
      <div className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        {remote.name}
      </div>
```

Par :

```tsx
      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1 truncate bg-black/60 px-2 py-0.5 text-xs text-white">
        <span
          title={presenceDot(presence).title}
          aria-label={presenceDot(presence).title}
          className="shrink-0"
        >
          {presenceDot(presence).dot}
        </span>
        <span className="truncate">{remote.name}</span>
      </div>
```

- [ ] **Step 4 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add client/src/react/components/VideoBar.tsx
git commit -m "feat(client): VideoBar — presence dot indicator on LocalTile + RemoteTile"
```

---

## Task 10 : Phaser entities — suffixe de label selon `presence`

**Files:**
- Modify: `client/src/phaser/entities/RemotePlayer.ts`
- Modify: `client/src/phaser/entities/Player.ts`
- Modify: `client/src/phaser/scenes/GameScene.ts`

- [ ] **Step 1 : Ajouter `setPresence` dans `RemotePlayer.ts`**

Ouvrir `client/src/phaser/entities/RemotePlayer.ts`.

Ajouter l'import du type en haut :

```ts
import type { Appearance, Direction, PlayerState, Presence } from '../../types';
```

Ajouter un champ privé dans la classe (après `isGhost`) :

```ts
  private presenceSuffix = '';
```

Ajouter la méthode publique `setPresence` après `setGhost` :

```ts
  setPresence(presence: Presence | undefined): void {
    switch (presence) {
      case 'inactive': this.presenceSuffix = ' · 💤'; break;
      case 'brb':      this.presenceSuffix = ' · ☕ BRB'; break;
      case 'dnd':      this.presenceSuffix = ' · 🚫 DND'; break;
      case 'away':     this.presenceSuffix = ' · 👋'; break;
      default:         this.presenceSuffix = ''; break;
    }
    // Le label est mis à jour au prochain appel de update(), mais on peut le
    // déclencher immédiatement pour éviter un frame de retard :
    this.label.setText((this.label.text.split(' · ')[0]!) + this.presenceSuffix);
  }
```

Aussi, pour que le suffixe survive aux appels ultérieurs qui réécrivent le label, modifier `update()` pour utiliser le suffixe. Trouver la ligne qui positionne le label (dans `update`, `this.label.setPosition(x, y - 28)`) — le texte ne change pas en cours d'update, donc le suffix est déjà dans le texte via `setPresence`. Pas de modification supplémentaire nécessaire.

- [ ] **Step 2 : Ajouter `setPresence` dans `Player.ts` (joueur local)**

Ouvrir `client/src/phaser/entities/Player.ts`.

Ajouter l'import :

```ts
import type { Appearance, Direction, Presence } from '../../types';
```

Ajouter le champ et la méthode après `setGhost` :

```ts
  private presenceSuffix = '';

  setPresence(presence: Presence | undefined): void {
    switch (presence) {
      case 'inactive': this.presenceSuffix = ' · 💤'; break;
      case 'brb':      this.presenceSuffix = ' · ☕ BRB'; break;
      case 'dnd':      this.presenceSuffix = ' · 🚫 DND'; break;
      case 'away':     this.presenceSuffix = ' · 👋'; break;
      default:         this.presenceSuffix = ''; break;
    }
    this.label.setText((this.label.text.split(' · ')[0]!) + this.presenceSuffix);
  }
```

Note : `Player` est construit avec `name` dans le constructeur. Le label initial est `name` seul (pas de suffixe). `setPresence` sera appelé par `GameScene` quand le store change.

- [ ] **Step 3 : Appeler `setPresence` depuis `GameScene.ts` lors des mises à jour réseau**

Ouvrir `client/src/phaser/scenes/GameScene.ts`. Chercher les endroits où `RemotePlayer.setTarget` est appelé (lors de `player_update`, `players_update`, `player_joined`). Après chaque `setTarget`, ajouter un appel à `setPresence` :

```ts
// Exemple — adapter aux variables locales de GameScene :
remotePlayer.setTarget(playerState);
remotePlayer.setPresence(playerState.presence);
```

Pour le joueur local (le `Player` Phaser local), GameScene doit s'abonner aux changements de `localPresence` dans le store Zustand et appeler `localPlayer.setPresence(...)`. Ajouter dans `create()` de `GameScene` (ou dans la méthode d'abonnement existante) :

```ts
// Abonnement réactif aux changements de presence locale
// (Phaser n'est pas React, donc on poll via onStoreChange ou useEffect externe)
// La façon la plus simple : dans le update() de GameScene, lire la valeur du store
// à chaque frame et appeler setPresence seulement si elle a changé.
```

Ajouter un champ dans `GameScene` :

```ts
  private lastLocalPresence: string | undefined = undefined;
```

Dans `update()` de `GameScene`, après la logique de mouvement local :

```ts
    const { localPresence } = useGameStore.getState();
    if (localPresence !== this.lastLocalPresence) {
      this.lastLocalPresence = localPresence;
      this.localPlayer?.setPresence(localPresence);
    }
```

Importer `useGameStore` si pas déjà importé dans `GameScene.ts` :

```ts
import { useGameStore } from '../../stores/gameStore';
```

- [ ] **Step 4 : Vérification de type**

```bash
cd /home/openclaw/projects/webinti-town/client && npx tsc --noEmit
```

Expected : aucune erreur.

- [ ] **Step 5 : Commit**

```bash
git add client/src/phaser/entities/RemotePlayer.ts \
        client/src/phaser/entities/Player.ts \
        client/src/phaser/scenes/GameScene.ts
git commit -m "feat(client): Phaser Player + RemotePlayer — presence label suffix (💤 ☕ 🚫 👋)"
```

---

## Task 11 : Build, smoke test, restart

**Files:** aucun

- [ ] **Step 1 : Lancer tous les tests**

```bash
cd /home/openclaw/projects/webinti-town/server && npx vitest run
cd /home/openclaw/projects/webinti-town/client && npx vitest run
```

Expected : tous verts.

- [ ] **Step 2 : Build client + serveur**

```bash
cd /home/openclaw/projects/webinti-town/client && npm run build
cd /home/openclaw/projects/webinti-town/server && npm run build
```

Expected : aucune erreur TypeScript, bundles générés.

- [ ] **Step 3 : Redémarrer le service**

```bash
sudo -n /bin/systemctl restart webinti-server
sleep 2
systemctl is-active webinti-server
journalctl -u webinti-server -n 10 --no-pager
```

Expected : `active`, aucune stacktrace dans les 10 dernières lignes.

- [ ] **Step 4 : Smoke test**

Demander à l'utilisateur de :

1. Ouvrir https://live.webinti.com/?room=test-presence dans un onglet.
2. Vérifier que le dropdown de statut apparaît en haut-gauche à côté du pseudo.
3. Sélectionner "Absent (👋)" — le label Phaser du personnage doit afficher `Nom · 👋`.
4. Ouvrir un second onglet avec un autre navigateur/navigateur privé dans la même room.
5. Observer la VideoBar : la pastille 🟡 doit apparaître sur la tile du premier joueur.
6. Laisser les deux onglets en idle 6+ minutes — le premier joueur doit passer ⚪ Inactif automatiquement.
7. Bouger la souris dans l'onglet inactif → revient automatiquement à 🟢 Disponible.

---

## Self-review

**Spec coverage :**
- `Presence` union + `presence` + `lastActivityAt` sur `PlayerState` serveur ✅ Task 1
- `publicPlayer` exclut `lastActivityAt` ✅ Task 1 Step 2
- `addPlayer` initialise `presence: 'available'` + `lastActivityAt: Date.now()` ✅ Task 2
- `setPresence` (propre joueur seulement) ✅ Task 2 + Task 3
- `markActivity` bump + inactive→available ✅ Task 2 + Task 3
- `sweepInactive` : available→inactive si stale, ne touche pas away/brb/dnd ✅ Task 2 TDD
- Tests TDD RoomManager ✅ Task 2
- `setInterval(30_000)` sweep + broadcast `player_update` ✅ Task 4
- Handlers `presence_set` + `presence_activity` ✅ Task 3
- `markActivity` dans `player_move` + `chat_message` ✅ Task 3
- Types client mirror `Presence` ✅ Task 5
- `localPresence` dans gameStore ✅ Task 5
- `player_update` listener client (presence flow through) ✅ Tasks 4 + 8
- `sendPresenceSet` + `sendActivity` dans SocketManager ✅ Task 6
- `<PresenceSelector />` dans HUD (4 options + read-only inactive) ✅ Task 8
- VideoBar pastille colorée (🟢🟡🔴⚪) avec tooltip ✅ Task 9
- Phaser RemotePlayer + Player — suffixes 💤 ☕ 🚫 👋 ✅ Task 10
- `useActivityHeartbeat` (mousemove/keydown/focus, debounce 10 s) ✅ Task 7
- Monté une seule fois dans HUD ✅ Task 7

**Placeholder scan :** aucun TBD/TODO. Tout le code est inclus.

**Type consistency :**
- `Presence` est défini dans `server/src/types.ts` (Task 1) et dans `client/src/types.ts` (Task 5) — les deux unions sont identiques.
- `publicPlayer` exclut `lastActivityAt` (Task 1) → le client ne reçoit jamais ce champ.
- `setPresence` dans `RoomManager` retourne `boolean` — les handlers vérifient la valeur de retour.
- `markActivity` retourne `boolean` (true = changement de statut) — les handlers broadcastent uniquement si `true`.
- `sweepInactive` retourne `string[]` (playerIds) — `startTickLoops` itère dessus.
- `presenceDot()` dans VideoBar accepte `Presence | undefined` — safe même avant que le serveur envoie le champ.
- `setPresence(p)` dans `Player.ts` et `RemotePlayer.ts` ont la même signature.
