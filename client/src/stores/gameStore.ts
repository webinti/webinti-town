import { create } from 'zustand';
import type { Appearance, PlayerState } from '../types';
import { DEFAULT_APPEARANCE } from '../types';

interface GameStore {
  connected: boolean;
  joined: boolean;
  localPlayerId: string | null;
  name: string;
  appearance: Appearance;
  players: Map<string, PlayerState>;
  setConnected: (v: boolean) => void;
  setJoined: (v: boolean) => void;
  setLocalPlayerId: (id: string | null) => void;
  setName: (n: string) => void;
  setAppearance: (a: Appearance) => void;
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
  appearance: DEFAULT_APPEARANCE,
  players: new Map(),
  setConnected: (v) => set({ connected: v }),
  setJoined: (v) => set({ joined: v }),
  setLocalPlayerId: (id) => set({ localPlayerId: id }),
  setName: (n) => set({ name: n }),
  setAppearance: (a) => set({ appearance: a }),
  setPlayers: (list) => {
    const m = new Map<string, PlayerState>();
    for (const p of list) m.set(p.playerId, p);
    set({ players: m });
  },
  upsertPlayer: (p) =>
    set((s) => {
      const m = new Map(s.players);
      m.set(p.playerId, p);
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
