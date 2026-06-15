import { create } from 'zustand';
import type {
  Appearance,
  ChatMessage,
  DmMessage,
  InteractiveObject,
  KanbanCard,
  KartState,
  PlayerState,
  Presence,
  WhiteboardStroke,
  WhiteboardText,
  WorkstationState,
  CircuitEvent,
  LeaderboardEntry,
} from '../types';
import { DEFAULT_APPEARANCE } from '../types';
import { clampMapZoom } from '../mapZoom';
import { CIRCUIT } from '../circuit';

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
  openKanbanId: string | null;
  setOpenKanban: (id: string | null) => void;
  kanbanCards: KanbanCard[];
  setKanbanCards: (cards: KanbanCard[]) => void;
  // F10 — Direct Messages
  // Clé = id de l'autre joueur (le contact). Triée par ts asc.
  dmConversations: Map<string, DmMessage[]>;
  unreadDm: Map<string, number>;
  activeDmTarget: string | null;
  setActiveDmTarget: (id: string | null) => void;
  setDmState: (conversations: Record<string, DmMessage[]>) => void;
  appendDmMessage: (msg: DmMessage) => void;
  markDmRead: (otherPlayerId: string) => void;
  totalUnreadDm: () => number;
  localPresence: Presence;
  setLocalPresence: (p: Presence) => void;
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
  // Taille du monde (px) poussée par GameScene — pour mapper la minimap.
  worldW: number;
  worldH: number;
  setWorldSize: (w: number, h: number) => void;
  // Vue libre via la minimap : la caméra explore sans déplacer le perso.
  freeLook: boolean;
  freeLookTarget: { x: number; y: number } | null;
  enterFreeLook: (x: number, y: number) => void;
  setFreeLookTarget: (x: number, y: number) => void;
  exitFreeLook: () => void;
  // Mute master : coupe TOUT le son entrant (effets + voix LiveKit) pour le joueur
  // local (= "sourdine"). N'affecte pas le micro (ce que les autres entendent).
  deafened: boolean;
  setDeafened: (v: boolean) => void;
  // Volume de sortie (0..1) appliqué aux voix entrantes (multiplie la proximité).
  masterVolume: number;
  setMasterVolume: (v: number) => void;
  // Miroir de SA PROPRE caméra (vue locale uniquement ; n'affecte pas les autres).
  camMirror: boolean;
  setCamMirror: (v: boolean) => void;
  workstations: Map<string, WorkstationState>;
  setWorkstationState: (ws: WorkstationState) => void;
  setWorkstationsInitial: (list: WorkstationState[]) => void;
  nearbyWorkstationId: string | null;
  setNearbyWorkstationId: (id: string | null) => void;
  // Objet interactif le plus proche (tableau, note, lien, kanban…). Mis à jour
  // par le GameScene, lu par le bouton d'action tactile pour son libellé.
  nearbyObjectType: string | null;
  setNearbyObjectType: (t: string | null) => void;
  claimError: { workstationId: string; reason: string; x: number; y: number } | null;
  setClaimError: (e: { workstationId: string; reason: string; x: number; y: number } | null) => void;
  karts: Map<string, KartState>;
  setKartState: (k: KartState) => void;
  setKartsInitial: (list: KartState[]) => void;
  localKartId: string | null;
  setLocalKartId: (id: string | null) => void;
  nearbyKartId: string | null;
  setNearbyKartId: (id: string | null) => void;
  localBoosting: boolean;
  setLocalBoosting: (b: boolean) => void;
  // F12 — Course chronométrée
  raceActive: boolean;             // tour en cours (chrono démarré)
  raceLocalStartMs: number | null; // horloge client, pour le chrono live
  raceNextIndex: number;           // prochain checkpoint à franchir
  raceTotal: number;               // nb de checkpoints du circuit
  raceLastMs: number | null;       // dernier tour bouclé
  raceLastWasBest: boolean;        // le dernier tour était-il un record perso ?
  raceLastLapAt: number | null;    // horloge client du dernier tour (pour le toast)
  raceBestMs: number | null;       // meilleur tour perso connu
  applyCircuitEvent: (ev: CircuitEvent) => void;
  leaderboard: LeaderboardEntry[];
  setLeaderboard: (l: LeaderboardEntry[]) => void;
  pendingInvite: { fromPlayerName: string; workstationId: string; workstationName: string } | null;
  setPendingInvite: (inv: { fromPlayerName: string; workstationId: string; workstationName: string } | null) => void;
  // Auto-walk: cible que le joueur local doit rejoindre automatiquement.
  // GameScene lit cette valeur chaque frame et force les inputs directionnels
  // vers (x, y). Clear quand le joueur arrive (rayon de tolérance) ou expire.
  autoWalkTarget: { x: number; y: number; startedAt: number } | null;
  setAutoWalkTarget: (t: { x: number; y: number; startedAt: number } | null) => void;
  speakingPlayerIds: Set<string>;
  setSpeakingPlayer: (playerId: string, speaking: boolean) => void;
  reset: () => void;
}

const DM_PER_CONV_CAP = 200;

export const useGameStore = create<GameStore>((set, get) => ({
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
  setOpenWhiteboard: (id) =>
    set((s) => ({
      openWhiteboardId: id,
      inputFocused:
        id !== null ||
        s.openNoteId !== null ||
        s.openLinkId !== null ||
        s.openKanbanId !== null,
    })),
  openNoteId: null,
  setOpenNote: (id) =>
    set((s) => ({
      openNoteId: id,
      inputFocused:
        id !== null ||
        s.openWhiteboardId !== null ||
        s.openLinkId !== null ||
        s.openKanbanId !== null,
    })),
  openLinkId: null,
  setOpenLink: (id) =>
    set((s) => ({
      openLinkId: id,
      inputFocused:
        id !== null ||
        s.openWhiteboardId !== null ||
        s.openNoteId !== null ||
        s.openKanbanId !== null,
    })),
  openKanbanId: null,
  setOpenKanban: (id) =>
    set((s) => ({
      openKanbanId: id,
      inputFocused:
        id !== null ||
        s.openWhiteboardId !== null ||
        s.openNoteId !== null ||
        s.openLinkId !== null,
    })),
  kanbanCards: [],
  setKanbanCards: (cards) => set({ kanbanCards: cards }),
  // ─── F10 DM ───
  dmConversations: new Map<string, DmMessage[]>(),
  unreadDm: new Map<string, number>(),
  activeDmTarget: null,
  setActiveDmTarget: (id) =>
    set((s) => {
      // Marquer la conv comme lue à l'ouverture
      const next = new Map(s.unreadDm);
      if (id) next.delete(id);
      return { activeDmTarget: id, unreadDm: next };
    }),
  setDmState: (conversations) =>
    set(() => {
      const m = new Map<string, DmMessage[]>();
      const unread = new Map<string, number>();
      const myId = get().localPlayerId;
      for (const [other, msgs] of Object.entries(conversations)) {
        const sorted = [...msgs].sort((a, b) => a.ts - b.ts);
        m.set(other, sorted);
        if (myId) {
          const n = sorted.reduce((acc, msg) => acc + (msg.from === other && !msg.readBy.includes(myId) ? 1 : 0), 0);
          if (n > 0) unread.set(other, n);
        }
      }
      return { dmConversations: m, unreadDm: unread };
    }),
  appendDmMessage: (msg) =>
    set((s) => {
      const myId = s.localPlayerId;
      if (!myId) return {};
      const otherId = msg.from === myId ? msg.to : msg.from;
      const list = s.dmConversations.get(otherId) ?? [];
      // Dédup par id (echo expéditeur + reçu serveur peuvent arriver une seule fois normalement)
      if (list.some((m) => m.id === msg.id)) return {};
      const nextList = list.concat(msg);
      if (nextList.length > DM_PER_CONV_CAP) nextList.splice(0, nextList.length - DM_PER_CONV_CAP);
      const convs = new Map(s.dmConversations);
      convs.set(otherId, nextList);

      // Incrémenter unread sauf si :
      //   - c'est mon propre message (from === myId)
      //   - OU le chat est ouvert ET sur l'onglet Privés ET ce contact est l'activeDmTarget
      const isMine = msg.from === myId;
      const isViewing = s.chatPanelOpen && s.activeDmTarget === otherId;
      let unread = s.unreadDm;
      if (!isMine && !isViewing) {
        unread = new Map(s.unreadDm);
        unread.set(otherId, (unread.get(otherId) ?? 0) + 1);
      }
      return { dmConversations: convs, unreadDm: unread };
    }),
  markDmRead: (otherPlayerId) =>
    set((s) => {
      if (!s.unreadDm.has(otherPlayerId)) return {};
      const next = new Map(s.unreadDm);
      next.delete(otherPlayerId);
      return { unreadDm: next };
    }),
  totalUnreadDm: () => {
    let total = 0;
    for (const n of get().unreadDm.values()) total += n;
    return total;
  },
  localPresence: 'available' as Presence,
  setLocalPresence: (p) => set({ localPresence: p }),
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
  worldW: 50 * 32,
  worldH: 40 * 32,
  setWorldSize: (w, h) => set({ worldW: w, worldH: h }),
  freeLook: false,
  freeLookTarget: null,
  enterFreeLook: (x, y) => set({ freeLook: true, freeLookTarget: { x, y } }),
  setFreeLookTarget: (x, y) => set((s) => (s.freeLook ? { freeLookTarget: { x, y } } : {})),
  exitFreeLook: () => set({ freeLook: false, freeLookTarget: null }),
  deafened: false,
  setDeafened: (v) => set({ deafened: v }),
  masterVolume: 1,
  setMasterVolume: (v) => set({ masterVolume: Math.max(0, Math.min(1, v)) }),
  camMirror: true,
  setCamMirror: (v) => set({ camMirror: v }),
  workstations: new Map<string, WorkstationState>(),
  setWorkstationState: (ws) =>
    set((s) => {
      const next = new Map(s.workstations);
      next.set(ws.id, ws);
      return { workstations: next };
    }),
  setWorkstationsInitial: (list) =>
    set({ workstations: new Map(list.map((ws) => [ws.id, ws])) }),
  nearbyWorkstationId: null,
  setNearbyWorkstationId: (id) => set({ nearbyWorkstationId: id }),
  nearbyObjectType: null,
  setNearbyObjectType: (t) => set({ nearbyObjectType: t }),
  claimError: null,
  setClaimError: (e) => set({ claimError: e }),
  karts: new Map<string, KartState>(),
  setKartState: (k) =>
    set((s) => {
      const next = new Map(s.karts);
      next.set(k.id, k);
      return { karts: next };
    }),
  setKartsInitial: (list) => set({ karts: new Map(list.map((k) => [k.id, k])) }),
  localKartId: null,
  setLocalKartId: (id) => set({ localKartId: id }),
  nearbyKartId: null,
  setNearbyKartId: (id) => set({ nearbyKartId: id }),
  localBoosting: false,
  setLocalBoosting: (b) => set({ localBoosting: b }),
  // F12 — Course chronométrée
  raceActive: false,
  raceLocalStartMs: null,
  raceNextIndex: 0,
  raceTotal: CIRCUIT.length,
  raceLastMs: null,
  raceLastWasBest: false,
  raceLastLapAt: null,
  raceBestMs: null,
  applyCircuitEvent: (ev: CircuitEvent) =>
    set(() => {
      switch (ev.type) {
        case 'lap_start':
          return {
            raceActive: true,
            raceLocalStartMs: Date.now(),
            raceNextIndex: 1,
            raceTotal: CIRCUIT.length,
          };
        case 'checkpoint':
          return {
            raceNextIndex: (ev.index + 1) % ev.total,
            raceTotal: ev.total,
          };
        case 'lap':
          return {
            raceLastMs: ev.ms,
            raceLastWasBest: ev.isBest,
            raceBestMs: ev.bestMs,
            raceLastLapAt: Date.now(),
            // Enchaîne sur un nouveau tour (tour lancé).
            raceActive: true,
            raceLocalStartMs: Date.now(),
            raceNextIndex: 1,
          };
        case 'best':
          return { raceBestMs: ev.ms };
        case 'reset':
          return { raceActive: false, raceLocalStartMs: null, raceNextIndex: 0 };
        default:
          return {};
      }
    }),
  leaderboard: [],
  setLeaderboard: (l: LeaderboardEntry[]) => set({ leaderboard: l }),
  pendingInvite: null,
  setPendingInvite: (inv) => set({ pendingInvite: inv }),
  autoWalkTarget: null,
  setAutoWalkTarget: (t) => set({ autoWalkTarget: t }),
  speakingPlayerIds: new Set<string>(),
  setSpeakingPlayer: (playerId, speaking) =>
    set((s) => {
      const next = new Set(s.speakingPlayerIds);
      if (speaking) next.add(playerId); else next.delete(playerId);
      return { speakingPlayerIds: next };
    }),
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
      openKanbanId: null,
      kanbanCards: [],
      dmConversations: new Map(),
      unreadDm: new Map(),
      activeDmTarget: null,
      localPresence: 'available' as Presence,
      helpOpen: false,
      adminPanelOpen: false,
      hostPlayerId: null,
      isRecording: false,
      recordingHostName: '',
      mapZoom: 1,
      freeLook: false,
      freeLookTarget: null,
      deafened: false,
      masterVolume: 1,
      camMirror: true,
      workstations: new Map(),
      nearbyWorkstationId: null,
      nearbyObjectType: null,
      claimError: null,
      karts: new Map(),
      localKartId: null,
      nearbyKartId: null,
      localBoosting: false,
      raceActive: false,
      raceLocalStartMs: null,
      raceNextIndex: 0,
      raceLastMs: null,
      raceLastWasBest: false,
      raceLastLapAt: null,
      raceBestMs: null,
      leaderboard: [],
      pendingInvite: null,
      autoWalkTarget: null,
      speakingPlayerIds: new Set(),
    }),
}));
