import { randomUUID } from 'node:crypto';
import { KanbanStore } from '../kanban/KanbanStore.js';
import { KanbanStorePocketBase } from '../kanban/KanbanStorePocketBase.js';
import { DmStore } from '../dm/DmStore.js';
import { DmStorePocketBase } from '../dm/DmStorePocketBase.js';
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
import { DEFAULT_APPEARANCE } from '../types.js';
import { config } from '../config.js';
import { WorkstationManager } from '../workstations/WorkstationManager.js';
import { WorkstationManagerPocketBase } from '../workstations/WorkstationManagerPocketBase.js';
import { WORKSTATIONS, workstationIdForPointIn } from '../workstations.js';
import { KartManager } from '../karts/KartManager.js';
import { KARTS } from '../karts.js';
import { RaceManager } from '../race/RaceManager.js';
import { loadLeaderboard } from '../race/leaderboardStore.js';
import { CIRCUIT_ID } from '../circuit.js';
import { aabbOverlap, computeKnockback } from '../karts/collisionPush.js';
import { KART_HALF_W, KART_HALF_H, PLAYER_HALF } from '../karts.js';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'room';
}

const CHAT_HISTORY_CAP = 200;

/** Hydrate (best-effort) le leaderboard persistant d'une room dans son RaceManager. */
function hydrateLeaderboard(slug: string, raceManager: RaceManager): void {
  void loadLeaderboard(slug, CIRCUIT_ID)
    .then((entries) => {
      for (const e of entries) raceManager.seedBest(e);
    })
    .catch(() => { /* dégradation silencieuse → leaderboard en mémoire */ });
}

const VALID_PRESENCES: ReadonlySet<string> = new Set<Presence>([
  'available', 'away', 'brb', 'dnd', 'inactive',
]);

function defaultInteractiveObjects(): InteractiveObject[] {
  return [
    {
      id: 'screen-meeting-1',
      type: 'screen',
      x: 13 * 32,
      y: 24 * 32,
      data: {},
    },
    {
      id: 'whiteboard-lounge-1',
      type: 'whiteboard',
      x: 8 * 32,
      y: 36 * 32,
      data: { strokes: [] },
    },
    {
      id: 'kanban-ideas-1',
      type: 'kanban',
      x: 10 * 32,        // tile (10, 36) — 2 tiles east of the whiteboard
      y: 36 * 32,
      data: {},
    },
    {
      id: 'note-agenda-1',
      type: 'note',
      x: 15 * 32,
      y: 12 * 32,
      data: {
        title: 'Agenda du live',
        content: 'À remplir par l\'hôte.',
      },
    },
  ];
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();

  createRoom(name: string): { slug: string; adminToken: string } {
    const cleanName = name.trim().slice(0, 60) || 'Untitled Room';
    let slug = slugify(cleanName);
    let suffix = 0;
    while (this.rooms.has(slug)) {
      suffix += 1;
      slug = `${slugify(cleanName)}-${suffix}`;
    }
    const adminToken = randomUUID();
    const kanbanStore = config.kanbanBackend === 'pocketbase'
      ? new KanbanStorePocketBase({ roomSlug: slug })
      : new KanbanStore({ roomSlug: slug, persist: true });
    void kanbanStore.load();
    const dmStore = config.dmBackend === 'pocketbase'
      ? new DmStorePocketBase({ roomSlug: slug })
      : new DmStore({ roomSlug: slug, persist: true });
    void dmStore.load();
    const workstationManager = config.workstationBackend === 'pocketbase'
      ? new WorkstationManagerPocketBase(WORKSTATIONS, { roomSlug: slug })
      : new WorkstationManager(WORKSTATIONS, { roomSlug: slug, persist: true });
    const workstations = new Map(
      workstationManager.getAllStates().map((s) => [s.id, s]),
    );
    // Lance le load et resync la Map miroir une fois résolu.
    void workstationManager.load().then(() => {
      for (const s of workstationManager.getAllStates()) {
        workstations.set(s.id, s);
      }
    });
    const kartManager = new KartManager(KARTS);
    const karts = new Map(
      kartManager.getAllStates().map((k) => [k.id, k]),
    );
    const raceManager = new RaceManager();
    hydrateLeaderboard(slug, raceManager);
    this.rooms.set(slug, {
      slug,
      name: cleanName,
      adminToken,
      players: new Map(),
      createdAt: Date.now(),
      chatHistory: [],
      interactiveObjects: defaultInteractiveObjects(),
      kanbanStore,
      hostPlayerId: null,
      isRecording: false,
      workstations,
      workstationManager,
      karts,
      kartManager,
      raceManager,
      dmStore,
    });
    return { slug, adminToken };
  }

  ensureRoom(slug: string, name: string): RoomState {
    const existing = this.rooms.get(slug);
    if (existing) return existing;
    const adminToken = randomUUID();
    const kanbanStore = config.kanbanBackend === 'pocketbase'
      ? new KanbanStorePocketBase({ roomSlug: slug })
      : new KanbanStore({ roomSlug: slug, persist: true });
    void kanbanStore.load();
    const dmStore = config.dmBackend === 'pocketbase'
      ? new DmStorePocketBase({ roomSlug: slug })
      : new DmStore({ roomSlug: slug, persist: true });
    void dmStore.load();
    const workstationManager = config.workstationBackend === 'pocketbase'
      ? new WorkstationManagerPocketBase(WORKSTATIONS, { roomSlug: slug })
      : new WorkstationManager(WORKSTATIONS, { roomSlug: slug, persist: true });
    const workstations = new Map(
      workstationManager.getAllStates().map((s) => [s.id, s]),
    );
    // Lance le load et resync la Map miroir une fois résolu.
    void workstationManager.load().then(() => {
      for (const s of workstationManager.getAllStates()) {
        workstations.set(s.id, s);
      }
    });
    const kartManager = new KartManager(KARTS);
    const karts = new Map(
      kartManager.getAllStates().map((k) => [k.id, k]),
    );
    const raceManager = new RaceManager();
    hydrateLeaderboard(slug, raceManager);
    const room: RoomState = {
      slug,
      name,
      adminToken,
      players: new Map(),
      createdAt: Date.now(),
      chatHistory: [],
      interactiveObjects: defaultInteractiveObjects(),
      kanbanStore,
      hostPlayerId: null,
      isRecording: false,
      workstations,
      workstationManager,
      karts,
      kartManager,
      raceManager,
      dmStore,
    };
    this.rooms.set(slug, room);
    return room;
  }

  pushChat(slug: string, msg: ChatMessage): void {
    const room = this.rooms.get(slug);
    if (!room) return;
    room.chatHistory.push(msg);
    if (room.chatHistory.length > CHAT_HISTORY_CAP) {
      room.chatHistory.splice(0, room.chatHistory.length - CHAT_HISTORY_CAP);
    }
  }

  /** Purge les messages (chat + DM) plus vieux que ttlMs, dans toutes les rooms. */
  pruneOldMessages(ttlMs: number, now: number = Date.now()): void {
    const cutoff = now - ttlMs;
    for (const room of this.rooms.values()) {
      if (room.chatHistory.length) {
        room.chatHistory = room.chatHistory.filter((m) => m.timestamp >= cutoff);
      }
      void room.dmStore.prune(ttlMs, now);
    }
  }

  getInteractiveObject(slug: string, objectId: string): InteractiveObject | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    return room.interactiveObjects.find((o) => o.id === objectId);
  }

  getRoom(slug: string): RoomState | undefined {
    return this.rooms.get(slug);
  }

  getPublicInfo(slug: string): PublicRoomInfo | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    return { slug: room.slug, name: room.name, playerCount: room.players.size };
  }

  listRooms(): RoomState[] {
    return Array.from(this.rooms.values());
  }

  addPlayer(
    slug: string,
    socketId: string,
    name: string,
    appearance: Appearance = DEFAULT_APPEARANCE,
    // Stable per-browser identity sent by the client. If present and well-shaped,
    // we adopt it as the playerId so that author-owned resources (e.g. Kanban
    // cards) remain editable by the same browser across reconnects. Falls back
    // to a fresh UUID when missing or invalid.
    clientKey?: string,
    // Position de spawn souhaitée (dernière position connue, envoyée par le
    // client). Utilisée si valide, sinon on retombe sur le spawn par défaut.
    spawn?: { x: number; y: number },
    // Email du compte connecté (PocketBase). Seul config.hostEmail devient hôte.
    email?: string,
  ): PlayerState | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    const playerId = isValidClientKey(clientKey) ? clientKey : randomUUID();
    // If the same key is already in the room (e.g. opened a 2nd tab), drop
    // the previous record so the new socket fully replaces it.
    room.players.delete(playerId);
    const valid = (n: number): boolean => Number.isFinite(n) && n >= 0 && n <= 100000;
    const useSpawn = !!spawn && valid(spawn.x) && valid(spawn.y);
    const player: PlayerState = {
      playerId,
      socketId,
      name,
      appearance,
      x: useSpawn ? spawn!.x : config.defaultSpawn.x,
      y: useSpawn ? spawn!.y : config.defaultSpawn.y,
      direction: 'down',
      isMoving: false,
      isGhost: false,
      joinedAt: Date.now(),
      presence: 'available',
      lastActivityAt: Date.now(),
      workstationId: null,
      kartId: null,
      boosting: false,
    };
    room.players.set(playerId, player);
    // Hôte = uniquement le compte config.hostEmail (plus de "premier arrivé").
    if (email && email.toLowerCase() === config.hostEmail) {
      room.hostPlayerId = playerId;
    }
    return player;
  }

  removePlayer(slug: string, playerId: string): PlayerState | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    const player = room.players.get(playerId);
    if (!player) return undefined;
    if (player.kartId) {
      room.kartManager.move(playerId, player.x, player.y);
      room.kartManager.dismount(playerId);
      const k = room.kartManager.getState(player.kartId);
      if (k) room.karts.set(player.kartId, k);
      player.kartId = null;
      player.boosting = false;
    }
    room.raceManager.reset(playerId);
    room.players.delete(playerId);
    if (room.hostPlayerId === playerId) {
      // Pas de transfert au "suivant" : seul config.hostEmail peut être hôte.
      room.hostPlayerId = null;
      room.isRecording = false;
    }
    return player;
  }

  removeBySocket(socketId: string): { slug: string; player: PlayerState } | undefined {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          if (player.kartId) {
            room.kartManager.move(player.playerId, player.x, player.y);
            room.kartManager.dismount(player.playerId);
            const k = room.kartManager.getState(player.kartId);
            if (k) room.karts.set(player.kartId, k);
            player.kartId = null;
            player.boosting = false;
          }
          room.raceManager.reset(player.playerId);
          room.players.delete(player.playerId);
          if (room.hostPlayerId === player.playerId) {
            room.hostPlayerId = null; // seul config.hostEmail peut être hôte
            room.isRecording = false;
          }
          return { slug: room.slug, player };
        }
      }
    }
    return undefined;
  }

  promoteToHost(slug: string, playerId: string): void {
    const room = this.rooms.get(slug);
    if (!room) return;
    if (!room.players.has(playerId)) return;
    room.hostPlayerId = playerId;
  }

  setRecording(slug: string, playerId: string, on: boolean): boolean {
    const room = this.rooms.get(slug);
    if (!room) return false;
    if (room.hostPlayerId !== playerId) return false;
    room.isRecording = on;
    return true;
  }

  updatePlayerPosition(
    slug: string,
    playerId: string,
    x: number,
    y: number,
    direction: Direction,
    isMoving: boolean,
  ): PlayerState | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    const player = room.players.get(playerId);
    if (!player) return undefined;

    // Bloquer les moves dans une zone verrouillée non autorisée.
    // Le joueur reste à sa position précédente (rubber-band côté client).
    if (room.workstationManager.isInsideAnyLockedWorkstation(playerId, x, y)) {
      // On met quand même à jour la direction + isMoving pour la fluidité visuelle.
      player.direction = direction;
      player.isMoving = isMoving;
      return player;   // x, y inchangés → le serveur répond avec l'ancienne position
    }

    const prevX = player.x;
    const prevY = player.y;

    player.x = x;
    player.y = y;
    player.direction = direction;
    player.isMoving = isMoving;
    // Recalculer workstationId à partir des nouvelles coords.
    player.workstationId = workstationIdForPointIn(WORKSTATIONS, x, y) ?? null;
    // F11 — si le joueur est sur un kart, garder sa position synchrone côté manager.
    if (player.kartId) {
      room.kartManager.move(playerId, x, y);
      const k = room.kartManager.getState(player.kartId);
      if (k) room.karts.set(player.kartId, k);
    }

    // F11 — collision push : si le joueur en kart chevauche un autre joueur, le pousser.
    if (player.kartId) {
      const kartBox = { x, y, halfW: KART_HALF_W, halfH: KART_HALF_H };
      let cancelled = false;
      const pendingPushes: Array<{ p: PlayerState; tx: number; ty: number }> = [];
      for (const other of room.players.values()) {
        if (other.playerId === playerId) continue;
        const playerBox = { x: other.x, y: other.y, halfW: PLAYER_HALF, halfH: PLAYER_HALF };
        if (!aabbOverlap(kartBox, playerBox)) continue;
        const { dx, dy } = computeKnockback(direction);
        const tx = other.x + dx;
        const ty = other.y + dy;
        if (room.workstationManager.isInsideAnyLockedWorkstation(other.playerId, tx, ty)) {
          cancelled = true;
          break;
        }
        pendingPushes.push({ p: other, tx, ty });
      }
      if (cancelled) {
        // Rembobiner : le kart et le joueur reviennent à leur position précédente.
        player.x = prevX;
        player.y = prevY;
        const k = room.kartManager.getKartByDriver(playerId);
        if (k) {
          room.kartManager.move(playerId, prevX, prevY);
          room.karts.set(k.id, room.kartManager.getState(k.id)!);
        }
        return player;
      }
      for (const { p, tx, ty } of pendingPushes) {
        p.x = tx;
        p.y = ty;
        p.workstationId = workstationIdForPointIn(WORKSTATIONS, tx, ty) ?? null;
      }
    }

    return player;
  }

  toggleGhost(slug: string, playerId: string): PlayerState | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    const player = room.players.get(playerId);
    if (!player) return undefined;
    player.isGhost = !player.isGhost;
    return player;
  }

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
}

// Loose UUID-shape check: 32 hex chars with 4 dashes. We don't strictly enforce
// v4 since the value is client-generated and only needs to be stable + unique
// enough that collisions across browsers are negligible.
function isValidClientKey(key: unknown): key is string {
  return typeof key === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
}

export const roomManager = new RoomManager();
