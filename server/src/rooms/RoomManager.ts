import { randomUUID } from 'node:crypto';
import { KanbanStore } from '../kanban/KanbanStore.js';
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
import { WORKSTATIONS, workstationIdForPointIn } from '../workstations.js';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'room';
}

const CHAT_HISTORY_CAP = 200;

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
    const kanbanStore = new KanbanStore({ roomSlug: slug, persist: true });
    // fire-and-forget; getCards returns empty until load resolves
    void kanbanStore.load();
    const workstationManager = new WorkstationManager(WORKSTATIONS);
    const workstations = new Map(
      workstationManager.getAllStates().map((s) => [s.id, s]),
    );
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
    });
    return { slug, adminToken };
  }

  ensureRoom(slug: string, name: string): RoomState {
    const existing = this.rooms.get(slug);
    if (existing) return existing;
    const adminToken = randomUUID();
    const kanbanStore = new KanbanStore({ roomSlug: slug, persist: true });
    // fire-and-forget; getCards returns empty until load resolves
    void kanbanStore.load();
    const workstationManager = new WorkstationManager(WORKSTATIONS);
    const workstations = new Map(
      workstationManager.getAllStates().map((s) => [s.id, s]),
    );
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
  ): PlayerState | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    const playerId = isValidClientKey(clientKey) ? clientKey : randomUUID();
    // If the same key is already in the room (e.g. opened a 2nd tab), drop
    // the previous record so the new socket fully replaces it.
    room.players.delete(playerId);
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
      workstationId: null,
    };
    room.players.set(playerId, player);
    if (!room.hostPlayerId) room.hostPlayerId = playerId;
    return player;
  }

  removePlayer(slug: string, playerId: string): PlayerState | undefined {
    const room = this.rooms.get(slug);
    if (!room) return undefined;
    const player = room.players.get(playerId);
    if (!player) return undefined;
    room.players.delete(playerId);
    if (room.hostPlayerId === playerId) {
      const next = room.players.values().next();
      room.hostPlayerId = next.done ? null : next.value.playerId;
      room.isRecording = false;
    }
    return player;
  }

  removeBySocket(socketId: string): { slug: string; player: PlayerState } | undefined {
    for (const room of this.rooms.values()) {
      for (const player of room.players.values()) {
        if (player.socketId === socketId) {
          room.players.delete(player.playerId);
          if (room.hostPlayerId === player.playerId) {
            const next = room.players.values().next();
            room.hostPlayerId = next.done ? null : next.value.playerId;
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

    player.x = x;
    player.y = y;
    player.direction = direction;
    player.isMoving = isMoving;
    // Recalculer workstationId à partir des nouvelles coords.
    player.workstationId = workstationIdForPointIn(WORKSTATIONS, x, y) ?? null;
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
