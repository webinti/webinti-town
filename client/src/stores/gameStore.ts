import { create } from 'zustand';
import type { PlayerState } from '../types';

interface GameStore {
  connected: boolean;
  joined: boolean;
  localPlayerId: string | null;
  name: string;
  avatar: number;
  players: Map<string, PlayerState>;
  setConnected: (v: boolean) => void;
  setJoined: (v: boolean) => void;
  setLocalPlayerId: (id: string | null) => void;
  setName: (n: string) => void;
  setAvatar: (a: number) => void;
  setPlayers: (players: PlayerState[]) => void;
  upsertPlayer: (p: PlayerState) => void;
  removePlayer: (id: string) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  connected: false,
  joined: false,
  localPlayerId: null,
  name: '',
  avatar: 0,
  players: new Map(),
  setConnected: (v) => set({ connected: v }),
  setJoined: (v) => set({ joined: v }),
  setLocalPlayerId: (id) => set({ localPlayerId: id }),
  setName: (n) => set({ name: n }),
  setAvatar: (a) => set({ avatar: a }),
  setPlayers: (list) => {
    const m = new Map<string, PlayerState>();
    for (const p of list) m.set(p.id, p);
    set({ players: m });
  },
  upsertPlayer: (p) =>
    set((s) => {
      const m = new Map(s.players);
      m.set(p.id, p);
      return { players: m };
    }),
  removePlayer: (id) =>
    set((s) => {
      const m = new Map(s.players);
      m.delete(id);
      return { players: m };
    }),
  reset: () =>
    set({
      connected: false,
      joined: false,
      localPlayerId: null,
      players: new Map(),
    }),
}));
