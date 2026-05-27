import { io, Socket } from 'socket.io-client';
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

interface TypingStatePayload {
  playerId: string;
  typing: boolean;
  t: number;
}

interface WhiteboardStrokePayload {
  objectId: string;
  stroke: WhiteboardStroke;
}
interface WhiteboardTextPayload {
  objectId: string;
  text: WhiteboardText;
}
interface WhiteboardClearPayload {
  objectId: string;
}
interface WhiteboardTextUpdatePayload {
  objectId: string;
  textId: string;
  x: number;
  y: number;
}
interface WhiteboardTextDeletePayload {
  objectId: string;
  textId: string;
}
import { useGameStore } from '../stores/gameStore';
import { playJoin, playLeave, playChat, playApplause } from '../sounds/sounds';

const recentEmotes: Array<{ playerId: string; t: number }> = [];

// In prod build, same-origin (empty string → io defaults to window.location.origin).
// In dev, http://localhost:3001. Override via VITE_SERVER_URL.
const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ??
  (import.meta.env.PROD ? '' : 'http://localhost:3001');

class SocketManager {
  private socket: Socket | null = null;
  private listeners = new Set<(p: PlayerState) => void>();
  private removalListeners = new Set<(id: string) => void>();
  private proximityListeners = new Set<(ids: string[]) => void>();
  private chatListeners = new Set<(msg: ChatMessage) => void>();
  private emoteListeners = new Set<(e: EmoteEvent) => void>();
  private objectListeners = new Set<(obj: InteractiveObject) => void>();
  private whiteboardStrokeListeners = new Set<(p: WhiteboardStrokePayload) => void>();
  private whiteboardTextListeners = new Set<(p: WhiteboardTextPayload) => void>();
  private whiteboardClearListeners = new Set<(p: WhiteboardClearPayload) => void>();
  private whiteboardTextUpdateListeners = new Set<(p: WhiteboardTextUpdatePayload) => void>();
  private whiteboardTextDeleteListeners = new Set<(p: WhiteboardTextDeletePayload) => void>();
  private playerGhostListeners = new Set<(p: { playerId: string; isGhost: boolean }) => void>();
  private kickedListeners = new Set<(reason: string) => void>();
  private typingStateListeners = new Set<(p: TypingStatePayload) => void>();

  connect(): Socket {
    if (this.socket && this.socket.connected) return this.socket;
    const socket = io(SERVER_URL, { transports: ['websocket'], autoConnect: true });
    this.socket = socket;

    socket.on('connect', () => {
      useGameStore.getState().setConnected(true);
    });
    socket.on('disconnect', () => {
      useGameStore.getState().setConnected(false);
    });

    socket.on('room_state', (state: RoomState) => {
      const store = useGameStore.getState();
      store.setLocalPlayerId(state.playerId);
      if (typeof state.roomSlug === 'string') store.setCurrentRoomSlug(state.roomSlug);
      store.setPlayers(state.players);
      if (state.chatHistory) store.setChatHistory(state.chatHistory);
      if (state.interactiveObjects) store.setInteractiveObjects(state.interactiveObjects);
      store.setHost(state.hostPlayerId ?? null);
      const hostName = state.hostPlayerId
        ? state.players.find((p) => p.playerId === state.hostPlayerId)?.name ?? ''
        : '';
      store.setRecording(state.isRecording === true, hostName);
      store.setJoined(true);
    });

    socket.on('host_changed', (payload: { hostPlayerId: string | null }) => {
      useGameStore.getState().setHost(payload?.hostPlayerId ?? null);
    });

    socket.on(
      'recording_state',
      (payload: { isRecording: boolean; hostPlayerId: string | null; hostName: string }) => {
        useGameStore.getState().setRecording(payload?.isRecording === true, payload?.hostName ?? '');
      },
    );

    socket.on('join_error', (e: { message?: string }) => {
      console.error('[join_error]', e?.message ?? 'unknown');
    });

    socket.on('players_update', (players: PlayerState[]) => {
      const store = useGameStore.getState();
      store.setPlayers(players);
      for (const p of players) {
        for (const fn of this.listeners) fn(p);
      }
    });

    socket.on('player_joined', (p: PlayerState) => {
      useGameStore.getState().upsertPlayer(p);
      playJoin();
      for (const fn of this.listeners) fn(p);
    });

    socket.on('player_moved', (p: PlayerState) => {
      useGameStore.getState().upsertPlayer(p);
      for (const fn of this.listeners) fn(p);
    });

    socket.on('proximity_update', (payload: { nearbyPlayerIds?: string[] }) => {
      const ids = Array.isArray(payload?.nearbyPlayerIds) ? payload.nearbyPlayerIds : [];
      for (const fn of this.proximityListeners) fn(ids);
    });

    socket.on('player_left', (payload: { playerId: string }) => {
      const id = payload?.playerId;
      if (!id) return;
      useGameStore.getState().removePlayer(id);
      playLeave();
      for (const fn of this.removalListeners) fn(id);
    });

    socket.on('chat_message', (msg: ChatMessage) => {
      useGameStore.getState().addChatMessage(msg);
      const localId = useGameStore.getState().localPlayerId;
      if (msg.playerId !== localId) playChat();
      for (const fn of this.chatListeners) fn(msg);
    });

    socket.on('emote', (e: EmoteEvent) => {
      const now = Date.now();
      while (recentEmotes.length > 0 && now - recentEmotes[0]!.t > 2000) recentEmotes.shift();
      if (!recentEmotes.some((r) => r.playerId === e.playerId)) {
        recentEmotes.push({ playerId: e.playerId, t: now });
      }
      if (recentEmotes.length >= 2) {
        recentEmotes.length = 0;
        playApplause();
      }
      for (const fn of this.emoteListeners) fn(e);
    });

    socket.on('object_update', (obj: InteractiveObject) => {
      useGameStore.getState().upsertInteractiveObject(obj);
      for (const fn of this.objectListeners) fn(obj);
    });

    socket.on('object_interaction', (payload: unknown) => {
      console.log('[object_interaction]', payload);
    });

    socket.on('whiteboard_stroke', (payload: WhiteboardStrokePayload) => {
      if (!payload || typeof payload.objectId !== 'string' || !payload.stroke) return;
      useGameStore.getState().appendWhiteboardStroke(payload.objectId, payload.stroke);
      for (const fn of this.whiteboardStrokeListeners) fn(payload);
    });

    socket.on('whiteboard_text', (payload: WhiteboardTextPayload) => {
      if (!payload || typeof payload.objectId !== 'string' || !payload.text) return;
      useGameStore.getState().appendWhiteboardText(payload.objectId, payload.text);
      for (const fn of this.whiteboardTextListeners) fn(payload);
    });

    socket.on('player_ghost', (payload: { playerId: string; isGhost: boolean }) => {
      if (!payload || typeof payload.playerId !== 'string') return;
      const store = useGameStore.getState();
      const existing = store.players.get(payload.playerId);
      if (existing) {
        store.upsertPlayer({ ...existing, isGhost: payload.isGhost });
      }
      for (const fn of this.playerGhostListeners) fn(payload);
    });

    socket.on('player_update', (p: PlayerState) => {
      useGameStore.getState().upsertPlayer(p);
      // Sync le statut local si c'est notre propre joueur (ex: auto-inactive du serveur)
      const localId = useGameStore.getState().localPlayerId;
      if (p.playerId === localId && p.presence) {
        useGameStore.getState().setLocalPresence(p.presence);
      }
      for (const fn of this.listeners) fn(p);
    });

    socket.on('kicked', (payload: { reason?: string }) => {
      const reason = payload?.reason ?? 'kicked by host';
      for (const fn of this.kickedListeners) fn(reason);
    });

    socket.on('typing_state', (payload: TypingStatePayload) => {
      if (
        !payload ||
        typeof payload.playerId !== 'string' ||
        typeof payload.typing !== 'boolean' ||
        typeof payload.t !== 'number'
      ) return;
      for (const fn of this.typingStateListeners) fn(payload);
    });

    socket.on('whiteboard_text_update', (payload: WhiteboardTextUpdatePayload) => {
      if (!payload || typeof payload.objectId !== 'string' || typeof payload.textId !== 'string') return;
      if (typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
      useGameStore.getState().updateWhiteboardText(payload.objectId, payload.textId, payload.x, payload.y);
      for (const fn of this.whiteboardTextUpdateListeners) fn(payload);
    });

    socket.on('whiteboard_text_delete', (payload: WhiteboardTextDeletePayload) => {
      if (!payload || typeof payload.objectId !== 'string' || typeof payload.textId !== 'string') return;
      useGameStore.getState().removeWhiteboardText(payload.objectId, payload.textId);
      for (const fn of this.whiteboardTextDeleteListeners) fn(payload);
    });

    socket.on('whiteboard_clear', (payload: WhiteboardClearPayload) => {
      if (!payload || typeof payload.objectId !== 'string') return;
      useGameStore.getState().clearWhiteboard(payload.objectId);
      for (const fn of this.whiteboardClearListeners) fn(payload);
    });

    socket.on('kanban:state', (payload: { cards: KanbanCard[] }) => {
      if (!payload || !Array.isArray(payload.cards)) return;
      useGameStore.getState().setKanbanCards(payload.cards);
    });

    return socket;
  }

  joinRoom(payload: JoinRoomPayload): void {
    this.socket?.emit('join_room', { ...payload, clientKey: getOrCreateClientKey() });
  }

  sendMove(payload: PlayerMovePayload): void {
    this.socket?.emit('player_move', payload);
  }

  sendChat(text: string, type: ChatMessageType): void {
    this.socket?.emit('chat_message', { text, type });
  }

  sendEmote(emoteType: EmoteType): void {
    this.socket?.emit('emote', { emoteType });
  }

  sendTypingStart(): void {
    this.socket?.emit('typing_start');
  }

  interactObject(objectId: string): void {
    this.socket?.emit('interact_object', { objectId });
  }

  sendRecordingState(on: boolean): void {
    this.socket?.emit('recording_state', { on });
  }

  toggleGhost(): void {
    this.socket?.emit('toggle_ghost');
  }

  adminKick(targetPlayerId: string): void {
    this.socket?.emit('admin_kick', { targetPlayerId });
  }

  adminMute(targetPlayerId: string): void {
    this.socket?.emit('admin_mute', { targetPlayerId });
  }

  adminMuteAll(): void {
    this.socket?.emit('admin_mute_all');
  }

  adminCloseRoom(): void {
    this.socket?.emit('admin_close_room');
  }

  updateNote(objectId: string, title: string, content: string): void {
    this.socket?.emit('update_note', { objectId, title, content });
  }

  adminTransferHost(targetPlayerId: string): void {
    this.socket?.emit('admin_transfer_host', { targetPlayerId });
  }

  onPlayerGhost(fn: (p: { playerId: string; isGhost: boolean }) => void): () => void {
    this.playerGhostListeners.add(fn);
    return () => {
      this.playerGhostListeners.delete(fn);
    };
  }

  onTypingState(fn: (p: TypingStatePayload) => void): () => void {
    this.typingStateListeners.add(fn);
    return () => {
      this.typingStateListeners.delete(fn);
    };
  }

  onKicked(fn: (reason: string) => void): () => void {
    this.kickedListeners.add(fn);
    return () => {
      this.kickedListeners.delete(fn);
    };
  }

  onPlayerUpdate(fn: (p: PlayerState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onPlayerRemoved(fn: (id: string) => void): () => void {
    this.removalListeners.add(fn);
    return () => this.removalListeners.delete(fn);
  }

  onProximityUpdate(fn: (ids: string[]) => void): () => void {
    this.proximityListeners.add(fn);
    return () => {
      this.proximityListeners.delete(fn);
    };
  }

  onChatMessage(fn: (msg: ChatMessage) => void): () => void {
    this.chatListeners.add(fn);
    return () => {
      this.chatListeners.delete(fn);
    };
  }

  onEmote(fn: (e: EmoteEvent) => void): () => void {
    this.emoteListeners.add(fn);
    return () => {
      this.emoteListeners.delete(fn);
    };
  }

  onObjectUpdate(fn: (obj: InteractiveObject) => void): () => void {
    this.objectListeners.add(fn);
    return () => {
      this.objectListeners.delete(fn);
    };
  }

  onWhiteboardStroke(fn: (p: WhiteboardStrokePayload) => void): () => void {
    this.whiteboardStrokeListeners.add(fn);
    return () => {
      this.whiteboardStrokeListeners.delete(fn);
    };
  }

  onWhiteboardClear(fn: (p: WhiteboardClearPayload) => void): () => void {
    this.whiteboardClearListeners.add(fn);
    return () => {
      this.whiteboardClearListeners.delete(fn);
    };
  }

  sendWhiteboardStroke(objectId: string, stroke: WhiteboardStroke): void {
    this.socket?.emit('whiteboard_stroke', { objectId, stroke });
  }

  sendWhiteboardText(objectId: string, text: WhiteboardText): void {
    this.socket?.emit('whiteboard_text', { objectId, text });
  }

  onWhiteboardText(fn: (p: WhiteboardTextPayload) => void): () => void {
    this.whiteboardTextListeners.add(fn);
    return () => {
      this.whiteboardTextListeners.delete(fn);
    };
  }

  sendWhiteboardClear(objectId: string): void {
    this.socket?.emit('whiteboard_clear', { objectId });
  }

  sendWhiteboardTextUpdate(objectId: string, textId: string, x: number, y: number): void {
    this.socket?.emit('whiteboard_text_update', { objectId, textId, x, y });
  }

  sendWhiteboardTextDelete(objectId: string, textId: string): void {
    this.socket?.emit('whiteboard_text_delete', { objectId, textId });
  }

  kanbanCreate(title: string, description: string): void {
    this.socket?.emit('kanban:create', { title, description });
  }

  kanbanUpdate(cardId: string, patch: { title?: string; description?: string }): void {
    this.socket?.emit('kanban:update', { cardId, ...patch });
  }

  kanbanMove(cardId: string, column: 'todo' | 'doing' | 'done', position: number): void {
    this.socket?.emit('kanban:move', { cardId, column, position });
  }

  kanbanDelete(cardId: string): void {
    this.socket?.emit('kanban:delete', { cardId });
  }

  sendPresenceSet(presence: Presence): void {
    this.socket?.emit('presence_set', { presence });
  }

  sendActivity(): void {
    this.socket?.emit('presence_activity');
  }

  onWhiteboardTextUpdate(fn: (p: WhiteboardTextUpdatePayload) => void): () => void {
    this.whiteboardTextUpdateListeners.add(fn);
    return () => {
      this.whiteboardTextUpdateListeners.delete(fn);
    };
  }

  onWhiteboardTextDelete(fn: (p: WhiteboardTextDeletePayload) => void): () => void {
    this.whiteboardTextDeleteListeners.add(fn);
    return () => {
      this.whiteboardTextDeleteListeners.delete(fn);
    };
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

/**
 * Returns a stable per-browser UUID, persisted in localStorage. Used by the
 * server to preserve our playerId across reconnects, so we keep ownership of
 * resources we authored (e.g. Kanban cards) even after refresh.
 */
function getOrCreateClientKey(): string {
  const STORAGE_KEY = 'webinti.clientKey';
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const fresh = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-4xxx-yxxx-xxxxxxxxxxxx`
          .replace(/[xy]/g, (c) => {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16);
          });
    window.localStorage.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Private mode / disabled storage: fall back to an ephemeral key.
    return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `${Date.now().toString(16)}-fallback-${Math.random().toString(36).slice(2)}`;
  }
}

export const socketManager = new SocketManager();
