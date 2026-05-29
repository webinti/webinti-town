import { randomUUID } from 'node:crypto';
import { DEFAULT_APPEARANCE } from '../types.js';
import { config } from '../config.js';
function slugify(name) {
    const base = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32);
    return base || 'room';
}
const CHAT_HISTORY_CAP = 200;
function defaultInteractiveObjects() {
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
    rooms = new Map();
    createRoom(name) {
        const cleanName = name.trim().slice(0, 60) || 'Untitled Room';
        let slug = slugify(cleanName);
        let suffix = 0;
        while (this.rooms.has(slug)) {
            suffix += 1;
            slug = `${slugify(cleanName)}-${suffix}`;
        }
        const adminToken = randomUUID();
        this.rooms.set(slug, {
            slug,
            name: cleanName,
            adminToken,
            players: new Map(),
            createdAt: Date.now(),
            chatHistory: [],
            interactiveObjects: defaultInteractiveObjects(),
            hostPlayerId: null,
            isRecording: false,
        });
        return { slug, adminToken };
    }
    ensureRoom(slug, name) {
        const existing = this.rooms.get(slug);
        if (existing)
            return existing;
        const adminToken = randomUUID();
        const room = {
            slug,
            name,
            adminToken,
            players: new Map(),
            createdAt: Date.now(),
            chatHistory: [],
            interactiveObjects: defaultInteractiveObjects(),
            hostPlayerId: null,
            isRecording: false,
        };
        this.rooms.set(slug, room);
        return room;
    }
    pushChat(slug, msg) {
        const room = this.rooms.get(slug);
        if (!room)
            return;
        room.chatHistory.push(msg);
        if (room.chatHistory.length > CHAT_HISTORY_CAP) {
            room.chatHistory.splice(0, room.chatHistory.length - CHAT_HISTORY_CAP);
        }
    }
    getInteractiveObject(slug, objectId) {
        const room = this.rooms.get(slug);
        if (!room)
            return undefined;
        return room.interactiveObjects.find((o) => o.id === objectId);
    }
    getRoom(slug) {
        return this.rooms.get(slug);
    }
    getPublicInfo(slug) {
        const room = this.rooms.get(slug);
        if (!room)
            return undefined;
        return { slug: room.slug, name: room.name, playerCount: room.players.size };
    }
    listRooms() {
        return Array.from(this.rooms.values());
    }
    addPlayer(slug, socketId, name, appearance = DEFAULT_APPEARANCE) {
        const room = this.rooms.get(slug);
        if (!room)
            return undefined;
        const playerId = randomUUID();
        const player = {
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
        };
        room.players.set(playerId, player);
        if (!room.hostPlayerId)
            room.hostPlayerId = playerId;
        return player;
    }
    removePlayer(slug, playerId) {
        const room = this.rooms.get(slug);
        if (!room)
            return undefined;
        const player = room.players.get(playerId);
        if (!player)
            return undefined;
        room.players.delete(playerId);
        if (room.hostPlayerId === playerId) {
            const next = room.players.values().next();
            room.hostPlayerId = next.done ? null : next.value.playerId;
            room.isRecording = false;
        }
        return player;
    }
    removeBySocket(socketId) {
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
    promoteToHost(slug, playerId) {
        const room = this.rooms.get(slug);
        if (!room)
            return;
        if (!room.players.has(playerId))
            return;
        room.hostPlayerId = playerId;
    }
    setRecording(slug, playerId, on) {
        const room = this.rooms.get(slug);
        if (!room)
            return false;
        if (room.hostPlayerId !== playerId)
            return false;
        room.isRecording = on;
        return true;
    }
    updatePlayerPosition(slug, playerId, x, y, direction, isMoving) {
        const room = this.rooms.get(slug);
        if (!room)
            return undefined;
        const player = room.players.get(playerId);
        if (!player)
            return undefined;
        player.x = x;
        player.y = y;
        player.direction = direction;
        player.isMoving = isMoving;
        return player;
    }
    toggleGhost(slug, playerId) {
        const room = this.rooms.get(slug);
        if (!room)
            return undefined;
        const player = room.players.get(playerId);
        if (!player)
            return undefined;
        player.isGhost = !player.isGhost;
        return player;
    }
}
export const roomManager = new RoomManager();
//# sourceMappingURL=RoomManager.js.map