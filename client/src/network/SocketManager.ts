import { io, Socket } from 'socket.io-client';
import type {
  ChatMessage,
  ChatMessageType,
  EmoteEvent,
  EmoteType,
  InteractiveObject,
  JoinRoomPayload,
  PlayerMovePayload,
  PlayerState,
  RoomState,
  WhiteboardStroke,
} from '../types';

interface WhiteboardStrokePayload {
  objectId: string;
  stroke: WhiteboardStroke;
}
interface WhiteboardClearPayload {
  objectId: string;
}
import { useGameStore } from '../stores/gameStore';
import { playJoin, playLeave, playChat, playApplause } from '../sounds/sounds';

const recentEmotes: Array<{ playerId: string; t: number }> = [];

const SERVER_URL = 'http://localhost:3001';

class SocketManager {
  private socket: Socket | null = null;
  private listeners = new Set<(p: PlayerState) => void>();
  private removalListeners = new Set<(id: string) => void>();
  private proximityListeners = new Set<(ids: string[]) => void>();
  private chatListeners = new Set<(msg: ChatMessage) => void>();
  private emoteListeners = new Set<(e: EmoteEvent) => void>();
  private objectListeners = new Set<(obj: InteractiveObject) => void>();
  private whiteboardStrokeListeners = new Set<(p: WhiteboardStrokePayload) => void>();
  private whiteboardClearListeners = new Set<(p: WhiteboardClearPayload) => void>();

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
      if (recentEmotes.length >= 3) {
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

    socket.on('whiteboard_clear', (payload: WhiteboardClearPayload) => {
      if (!payload || typeof payload.objectId !== 'string') return;
      useGameStore.getState().clearWhiteboard(payload.objectId);
      for (const fn of this.whiteboardClearListeners) fn(payload);
    });

    return socket;
  }

  joinRoom(payload: JoinRoomPayload): void {
    this.socket?.emit('join_room', payload);
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

  interactObject(objectId: string): void {
    this.socket?.emit('interact_object', { objectId });
  }

  sendRecordingState(on: boolean): void {
    this.socket?.emit('recording_state', { on });
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

  sendWhiteboardClear(objectId: string): void {
    this.socket?.emit('whiteboard_clear', { objectId });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketManager = new SocketManager();
