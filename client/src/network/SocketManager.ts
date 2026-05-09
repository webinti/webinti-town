import { io, Socket } from 'socket.io-client';
import type {
  JoinRoomPayload,
  PlayerMovePayload,
  PlayerState,
  RoomState,
} from '../types';
import { useGameStore } from '../stores/gameStore';

const SERVER_URL = 'http://localhost:3001';

class SocketManager {
  private socket: Socket | null = null;
  private listeners = new Set<(p: PlayerState) => void>();
  private removalListeners = new Set<(id: string) => void>();

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
      store.setLocalPlayerId(state.selfId);
      store.setPlayers(state.players);
      store.setJoined(true);
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
      for (const fn of this.listeners) fn(p);
    });

    socket.on('player_moved', (p: PlayerState) => {
      useGameStore.getState().upsertPlayer(p);
      for (const fn of this.listeners) fn(p);
    });

    socket.on('player_left', (id: string) => {
      useGameStore.getState().removePlayer(id);
      for (const fn of this.removalListeners) fn(id);
    });

    return socket;
  }

  joinRoom(payload: JoinRoomPayload): void {
    this.socket?.emit('join_room', payload);
  }

  sendMove(payload: PlayerMovePayload): void {
    this.socket?.emit('player_move', payload);
  }

  onPlayerUpdate(fn: (p: PlayerState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onPlayerRemoved(fn: (id: string) => void): () => void {
    this.removalListeners.add(fn);
    return () => this.removalListeners.delete(fn);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const socketManager = new SocketManager();
