import { create } from 'zustand';
import type {
  Appearance,
  ChatMessage,
  InteractiveObject,
  PlayerState,
  WhiteboardStroke,
} from '../types';
import { DEFAULT_APPEARANCE } from '../types';

const CHAT_CAP = 200;
const WHITEBOARD_STROKE_CAP = 5000;

interface GameStore {
  connected: boolean;
  joined: boolean;
  localPlayerId: string | null;
  name: string;
  appearance: Appearance;
  players: Map<string, PlayerState>;
  chat: ChatMessage[];
  unreadChat: number;
  chatPanelOpen: boolean;
  inputFocused: boolean;
  interactiveObjects: InteractiveObject[];
  setConnected: (v: boolean) => void;
  setJoined: (v: boolean) => void;
  setLocalPlayerId: (id: string | null) => void;
  setName: (n: string) => void;
  setAppearance: (a: Appearance) => void;
  setPlayers: (players: PlayerState[]) => void;
  upsertPlayer: (p: PlayerState) => void;
  removePlayer: (id: string) => void;
  setChatHistory: (msgs: ChatMessage[]) => void;
  addChatMessage: (msg: ChatMessage) => void;
  markChatRead: () => void;
  setChatPanelOpen: (v: boolean) => void;
  toggleChatPanel: () => void;
  setInputFocused: (v: boolean) => void;
  setInteractiveObjects: (objs: InteractiveObject[]) => void;
  upsertInteractiveObject: (obj: InteractiveObject) => void;
  openWhiteboardId: string | null;
  setOpenWhiteboard: (id: string | null) => void;
  appendWhiteboardStroke: (objectId: string, stroke: WhiteboardStroke) => void;
  clearWhiteboard: (objectId: string) => void;
  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
  hostPlayerId: string | null;
  isRecording: boolean;
  recordingHostName: string;
  setHost: (id: string | null) => void;
  setRecording: (on: boolean, hostName: string) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  connected: false,
  joined: false,
  localPlayerId: null,
  name: '',
  appearance: DEFAULT_APPEARANCE,
  players: new Map(),
  chat: [],
  unreadChat: 0,
  chatPanelOpen: false,
  inputFocused: false,
  interactiveObjects: [],
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
  setChatHistory: (msgs) =>
    set({ chat: msgs.slice(-CHAT_CAP), unreadChat: 0 }),
  addChatMessage: (msg) =>
    set((s) => {
      const next = s.chat.concat(msg);
      if (next.length > CHAT_CAP) next.splice(0, next.length - CHAT_CAP);
      return {
        chat: next,
        unreadChat: s.chatPanelOpen ? 0 : s.unreadChat + 1,
      };
    }),
  markChatRead: () => set({ unreadChat: 0 }),
  setChatPanelOpen: (v) =>
    set((s) => ({ chatPanelOpen: v, unreadChat: v ? 0 : s.unreadChat })),
  toggleChatPanel: () =>
    set((s) => ({ chatPanelOpen: !s.chatPanelOpen, unreadChat: !s.chatPanelOpen ? 0 : s.unreadChat })),
  setInputFocused: (v) => set({ inputFocused: v }),
  setInteractiveObjects: (objs) => set({ interactiveObjects: objs }),
  upsertInteractiveObject: (obj) =>
    set((s) => {
      const next = s.interactiveObjects.slice();
      const idx = next.findIndex((o) => o.id === obj.id);
      if (idx >= 0) next[idx] = obj;
      else next.push(obj);
      return { interactiveObjects: next };
    }),
  openWhiteboardId: null,
  setOpenWhiteboard: (id) => set({ openWhiteboardId: id, inputFocused: id !== null }),
  appendWhiteboardStroke: (objectId, stroke) =>
    set((s) => {
      const next = s.interactiveObjects.slice();
      const idx = next.findIndex((o) => o.id === objectId);
      if (idx < 0) return {};
      const obj = next[idx]!;
      if (obj.type !== 'whiteboard') return {};
      const strokes = obj.data.strokes.concat(stroke);
      if (strokes.length > WHITEBOARD_STROKE_CAP) {
        strokes.splice(0, strokes.length - WHITEBOARD_STROKE_CAP);
      }
      next[idx] = { ...obj, data: { strokes } };
      return { interactiveObjects: next };
    }),
  clearWhiteboard: (objectId) =>
    set((s) => {
      const next = s.interactiveObjects.slice();
      const idx = next.findIndex((o) => o.id === objectId);
      if (idx < 0) return {};
      const obj = next[idx]!;
      if (obj.type !== 'whiteboard') return {};
      next[idx] = { ...obj, data: { strokes: [] } };
      return { interactiveObjects: next };
    }),
  helpOpen: false,
  setHelpOpen: (v) => set({ helpOpen: v }),
  hostPlayerId: null,
  isRecording: false,
  recordingHostName: '',
  setHost: (id) => set({ hostPlayerId: id }),
  setRecording: (on, hostName) => set({ isRecording: on, recordingHostName: hostName }),
  reset: () =>
    set({
      connected: false,
      joined: false,
      localPlayerId: null,
      players: new Map(),
      chat: [],
      unreadChat: 0,
      chatPanelOpen: false,
      inputFocused: false,
      interactiveObjects: [],
      openWhiteboardId: null,
      helpOpen: false,
      hostPlayerId: null,
      isRecording: false,
      recordingHostName: '',
    }),
}));
