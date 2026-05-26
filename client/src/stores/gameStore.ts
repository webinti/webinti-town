import { create } from 'zustand';
import type {
  Appearance,
  ChatMessage,
  InteractiveObject,
  PlayerState,
  WhiteboardStroke,
  WhiteboardText,
} from '../types';
import { DEFAULT_APPEARANCE } from '../types';
import { clampMapZoom } from '../mapZoom';

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
  openNoteId: string | null;
  setOpenNote: (id: string | null) => void;
  openLinkId: string | null;
  setOpenLink: (id: string | null) => void;
  currentRoomSlug: string;
  setCurrentRoomSlug: (slug: string) => void;
  appendWhiteboardStroke: (objectId: string, stroke: WhiteboardStroke) => void;
  appendWhiteboardText: (objectId: string, text: WhiteboardText) => void;
  updateWhiteboardText: (objectId: string, textId: string, x: number, y: number) => void;
  removeWhiteboardText: (objectId: string, textId: string) => void;
  clearWhiteboard: (objectId: string) => void;
  helpOpen: boolean;
  setHelpOpen: (v: boolean) => void;
  adminPanelOpen: boolean;
  setAdminPanelOpen: (v: boolean) => void;
  hostPlayerId: string | null;
  isRecording: boolean;
  recordingHostName: string;
  setHost: (id: string | null) => void;
  setRecording: (on: boolean, hostName: string) => void;
  mapZoom: number;
  setMapZoom: (z: number) => void;
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
  openNoteId: null,
  setOpenNote: (id) =>
    set((s) => ({
      openNoteId: id,
      inputFocused: id !== null || s.openWhiteboardId !== null || s.openLinkId !== null,
    })),
  openLinkId: null,
  setOpenLink: (id) =>
    set((s) => ({
      openLinkId: id,
      inputFocused: id !== null || s.openWhiteboardId !== null || s.openNoteId !== null,
    })),
  currentRoomSlug: 'demo',
  setCurrentRoomSlug: (slug) => set({ currentRoomSlug: slug }),
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
      next[idx] = { ...obj, data: { ...obj.data, strokes } };
      return { interactiveObjects: next };
    }),
  appendWhiteboardText: (objectId, text) =>
    set((s) => {
      const next = s.interactiveObjects.slice();
      const idx = next.findIndex((o) => o.id === objectId);
      if (idx < 0) return {};
      const obj = next[idx]!;
      if (obj.type !== 'whiteboard') return {};
      const existing = obj.data.texts ?? [];
      const texts = existing.concat(text);
      const total = obj.data.strokes.length + texts.length;
      if (total > WHITEBOARD_STROKE_CAP) {
        texts.splice(0, total - WHITEBOARD_STROKE_CAP);
      }
      next[idx] = { ...obj, data: { ...obj.data, texts } };
      return { interactiveObjects: next };
    }),
  updateWhiteboardText: (objectId, textId, x, y) =>
    set((s) => {
      const next = s.interactiveObjects.slice();
      const idx = next.findIndex((o) => o.id === objectId);
      if (idx < 0) return {};
      const obj = next[idx]!;
      if (obj.type !== 'whiteboard') return {};
      const existing = obj.data.texts ?? [];
      let changed = false;
      const texts = existing.map((t) => {
        if (t.id === textId) {
          changed = true;
          return { ...t, x, y };
        }
        return t;
      });
      if (!changed) return {};
      next[idx] = { ...obj, data: { ...obj.data, texts } };
      return { interactiveObjects: next };
    }),
  removeWhiteboardText: (objectId, textId) =>
    set((s) => {
      const next = s.interactiveObjects.slice();
      const idx = next.findIndex((o) => o.id === objectId);
      if (idx < 0) return {};
      const obj = next[idx]!;
      if (obj.type !== 'whiteboard') return {};
      const existing = obj.data.texts ?? [];
      const texts = existing.filter((t) => t.id !== textId);
      if (texts.length === existing.length) return {};
      next[idx] = { ...obj, data: { ...obj.data, texts } };
      return { interactiveObjects: next };
    }),
  clearWhiteboard: (objectId) =>
    set((s) => {
      const next = s.interactiveObjects.slice();
      const idx = next.findIndex((o) => o.id === objectId);
      if (idx < 0) return {};
      const obj = next[idx]!;
      if (obj.type !== 'whiteboard') return {};
      next[idx] = { ...obj, data: { strokes: [], texts: [] } };
      return { interactiveObjects: next };
    }),
  helpOpen: false,
  setHelpOpen: (v) => set({ helpOpen: v }),
  adminPanelOpen: false,
  setAdminPanelOpen: (v) => set({ adminPanelOpen: v }),
  hostPlayerId: null,
  isRecording: false,
  recordingHostName: '',
  setHost: (id) => set({ hostPlayerId: id }),
  setRecording: (on, hostName) => set({ isRecording: on, recordingHostName: hostName }),
  mapZoom: 1,
  setMapZoom: (z) => set({ mapZoom: clampMapZoom(z) }),
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
      openNoteId: null,
      openLinkId: null,
      helpOpen: false,
      adminPanelOpen: false,
      hostPlayerId: null,
      isRecording: false,
      recordingHostName: '',
      mapZoom: 1,
    }),
}));
