import { io, Socket } from 'socket.io-client';
import type {
  AiAgentState,
  Appearance,
  ChatAttachment,
  ChatMessage,
  ChatMessageType,
  ConfettiEvent,
  DmMessage,
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
  CircuitEvent,
  LeaderboardEntry,
} from '../types';

interface TypingStatePayload {
  playerId: string;
  typing: boolean;
  t: number;
}

interface AiConfigPayload {
  knowledge: string;
  saved?: boolean;
}

interface WorkstationStatePayload {
  id: string;
  claimedBy: string | null;
  claimedByName: string | null;
  invitedPlayerIds: string[];
  claimedAt: number | null;
  customName: string | null;
}

type KartStatePayload = import('../types').KartState;
type KartInitialPayload = { karts: KartStatePayload[] };

interface WorkstationInvitePayload {
  fromPlayerId: string;
  fromPlayerName: string;
  workstationId: string;
  workstationName: string;
}

interface SpeakingStatePayload {
  playerId: string;
  speaking: boolean;
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
import { playJoin, playLeave, playChat, playApplause, playDmNotif, playKnock } from '../sounds/sounds';

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
  private forceMuteListeners = new Set<() => void>();
  private playerJoinedListeners = new Set<(p: PlayerState) => void>();
  private knockListeners = new Set<(p: { fromPlayerId: string; fromName: string }) => void>();
  private chatListeners = new Set<(msg: ChatMessage) => void>();
  private emoteListeners = new Set<(e: EmoteEvent) => void>();
  private confettiListeners = new Set<(e: ConfettiEvent) => void>();
  private objectListeners = new Set<(obj: InteractiveObject) => void>();
  private aiConfigListeners = new Set<(p: AiConfigPayload) => void>();
  private whiteboardStrokeListeners = new Set<(p: WhiteboardStrokePayload) => void>();
  private whiteboardTextListeners = new Set<(p: WhiteboardTextPayload) => void>();
  private whiteboardClearListeners = new Set<(p: WhiteboardClearPayload) => void>();
  private whiteboardTextUpdateListeners = new Set<(p: WhiteboardTextUpdatePayload) => void>();
  private whiteboardTextDeleteListeners = new Set<(p: WhiteboardTextDeletePayload) => void>();
  private playerGhostListeners = new Set<(p: { playerId: string; isGhost: boolean }) => void>();
  private kickedListeners = new Set<(reason: string) => void>();
  private typingStateListeners = new Set<(p: TypingStatePayload) => void>();
  private workstationStateListeners = new Set<(ws: WorkstationStatePayload) => void>();
  private workstationInviteListeners = new Set<(inv: WorkstationInvitePayload) => void>();
  private speakingStateListeners = new Set<(p: SpeakingStatePayload) => void>();

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
      store.setJoinError(null); // join réussi → on efface toute erreur précédente
      store.setLocalPlayerId(state.playerId);
      if (typeof state.roomSlug === 'string') store.setCurrentRoomSlug(state.roomSlug);
      store.setPlayers(state.players);
      store.setAiAgents(state.aiAgents ?? []);
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
      const message = e?.message ?? 'Impossible de rejoindre la salle.';
      console.error('[join_error]', message);
      // Remonte l'erreur à l'UI (affichée sur l'écran de join).
      useGameStore.getState().setJoinError(message);
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
      for (const fn of this.playerJoinedListeners) fn(p);
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

    socket.on('confetti', (e: ConfettiEvent) => {
      for (const fn of this.confettiListeners) fn(e);
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
      // F11 — keep localKartId / localBoosting in sync when the server confirms it.
      const store = useGameStore.getState();
      if (p.playerId === store.localPlayerId) {
        if (store.localKartId !== p.kartId) store.setLocalKartId(p.kartId ?? null);
        if (store.localBoosting !== p.boosting) store.setLocalBoosting(p.boosting ?? false);
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

    socket.on('ai:config', (payload: AiConfigPayload) => {
      if (!payload || typeof payload.knowledge !== 'string') return;
      for (const fn of this.aiConfigListeners) fn(payload);
    });

    // Agents IA incarnés : apparition / mise à jour (déplacement, badge) / départ.
    socket.on('ai_agent_joined', (a: AiAgentState) => {
      if (!a || typeof a.agentId !== 'string') return;
      useGameStore.getState().upsertAiAgent(a);
    });
    socket.on('ai_agent_update', (a: AiAgentState) => {
      if (!a || typeof a.agentId !== 'string') return;
      useGameStore.getState().upsertAiAgent(a);
    });
    socket.on('ai_agent_left', (payload: { agentId?: string }) => {
      if (!payload || typeof payload.agentId !== 'string') return;
      useGameStore.getState().removeAiAgent(payload.agentId);
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

    // ─── F10 DM ───
    socket.on('dm:state', (payload: { conversations: Record<string, DmMessage[]> }) => {
      if (!payload || !payload.conversations) return;
      useGameStore.getState().setDmState(payload.conversations);
    });
    socket.on('dm:message', (msg: DmMessage) => {
      if (!msg || typeof msg.id !== 'string') return;
      const state = useGameStore.getState();
      const myId = state.localPlayerId;
      state.appendDmMessage(msg);
      // Notif son seulement si c'est un message REÇU (pas envoyé par moi)
      // et que je ne suis pas en train de regarder cette conv
      if (myId && msg.from !== myId) {
        const isViewing = state.chatPanelOpen && state.activeDmTarget === msg.from;
        if (!isViewing) {
          void playDmNotif();
        }
      }
    });

    socket.on('workstation:initial', (payload: { workstations: WorkstationStatePayload[] }) => {
      if (!payload || !Array.isArray(payload.workstations)) return;
      useGameStore.getState().setWorkstationsInitial(payload.workstations);
    });

    socket.on('workstation:state', (payload: WorkstationStatePayload) => {
      if (!payload || typeof payload.id !== 'string') return;
      useGameStore.getState().setWorkstationState(payload);
      for (const l of this.workstationStateListeners) l(payload);
    });

    // Échec de revendication : on remonte la raison (feedback + diagnostic).
    socket.on(
      'workstation:claim_failed',
      (payload: { workstationId?: string; reason?: string; x?: number; y?: number }) => {
        if (!payload || typeof payload.workstationId !== 'string') return;
        console.warn('[workstation:claim_failed]', payload);
        useGameStore.getState().setClaimError({
          workstationId: payload.workstationId,
          reason: String(payload.reason ?? 'unknown'),
          x: Number(payload.x ?? 0),
          y: Number(payload.y ?? 0),
        });
        window.setTimeout(() => {
          const cur = useGameStore.getState().claimError;
          if (cur && cur.workstationId === payload.workstationId) {
            useGameStore.getState().setClaimError(null);
          }
        }, 6000);
      },
    );

    socket.on('workstation:invite', (payload: WorkstationInvitePayload) => {
      if (!payload || typeof payload.workstationId !== 'string') return;
      useGameStore.getState().setPendingInvite({
        fromPlayerName: payload.fromPlayerName,
        workstationId: payload.workstationId,
        workstationName: payload.workstationName,
      });
      for (const l of this.workstationInviteListeners) l(payload);
    });

    socket.on('kart:initial', (payload: KartInitialPayload) => {
      this.kartInitialCallbacks.forEach((cb) => cb(payload));
    });
    socket.on('kart:state', (payload: KartStatePayload) => {
      this.kartStateCallbacks.forEach((cb) => cb(payload));
    });
    this.onKartInitial((p) => useGameStore.getState().setKartsInitial(p.karts));
    this.onKartState((p) => useGameStore.getState().setKartState(p));

    // F12 — Course chronométrée
    socket.on('circuit:event', (ev: CircuitEvent) => {
      if (!ev || typeof ev.type !== 'string') return;
      useGameStore.getState().applyCircuitEvent(ev);
    });
    socket.on('circuit:leaderboard', (payload: { entries?: LeaderboardEntry[] }) => {
      if (!payload || !Array.isArray(payload.entries)) return;
      useGameStore.getState().setLeaderboard(payload.entries);
    });

    // Mute forcé par l'hôte : on coupe le micro local.
    socket.on('force_mute', () => {
      for (const l of this.forceMuteListeners) l();
    });

    // « Toc toc » reçu : quelqu'un veut te parler → son + notif.
    socket.on('knocked', (payload: { fromPlayerId?: string; fromName?: string }) => {
      if (!payload || typeof payload.fromName !== 'string') return;
      playKnock();
      const data = { fromPlayerId: String(payload.fromPlayerId ?? ''), fromName: payload.fromName };
      for (const l of this.knockListeners) l(data);
    });

    socket.on('speaking_state', (payload: SpeakingStatePayload) => {
      if (!payload || typeof payload.playerId !== 'string') return;
      for (const l of this.speakingStateListeners) l(payload);
    });

    return socket;
  }

  joinRoom(payload: JoinRoomPayload): void {
    this.socket?.emit('join_room', { ...payload, clientKey: getOrCreateClientKey() });
  }

  sendMove(payload: PlayerMovePayload): void {
    this.socket?.emit('player_move', payload);
  }

  sendChat(text: string, type: ChatMessageType, attachment?: ChatAttachment): void {
    this.socket?.emit('chat_message', { text, type, ...(attachment ? { attachment } : {}) });
  }

  sendEmote(emoteType: EmoteType): void {
    this.socket?.emit('emote', { emoteType });
  }

  sendConfetti(): void {
    this.socket?.emit('confetti');
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

  /** Agent d'accueil « Marie » : récupère / met à jour ses consignes (hôte). */
  aiGetConfig(): void {
    this.socket?.emit('ai:get_config');
  }

  aiSetConfig(knowledge: string): void {
    this.socket?.emit('ai:set_config', { knowledge });
  }

  onAiConfig(fn: (p: AiConfigPayload) => void): () => void {
    this.aiConfigListeners.add(fn);
    return () => {
      this.aiConfigListeners.delete(fn);
    };
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

  onForceMute(fn: () => void): () => void {
    this.forceMuteListeners.add(fn);
    return () => {
      this.forceMuteListeners.delete(fn);
    };
  }

  onPlayerJoined(fn: (p: PlayerState) => void): () => void {
    this.playerJoinedListeners.add(fn);
    return () => {
      this.playerJoinedListeners.delete(fn);
    };
  }

  /** Envoie un « toc toc » à un membre (signaler qu'on veut lui parler). */
  knock(targetPlayerId: string): void {
    this.socket?.emit('knock', { targetPlayerId });
  }

  onKnock(fn: (p: { fromPlayerId: string; fromName: string }) => void): () => void {
    this.knockListeners.add(fn);
    return () => {
      this.knockListeners.delete(fn);
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

  onConfetti(fn: (e: ConfettiEvent) => void): () => void {
    this.confettiListeners.add(fn);
    return () => {
      this.confettiListeners.delete(fn);
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

  // ─── F10 DM ───
  sendDm(toPlayerId: string, text: string, attachment?: ChatAttachment): void {
    this.socket?.emit('dm:send', {
      toPlayerId,
      text,
      ...(attachment ? { attachment } : {}),
    });
  }
  markDmRead(withPlayerId: string): void {
    this.socket?.emit('dm:read', { withPlayerId });
  }

  sendAppearanceUpdate(appearance: Appearance): void {
    this.socket?.emit('update_appearance', { appearance });
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

  workstationClaim(workstationId: string): void {
    this.socket?.emit('workstation:claim', { workstationId });
  }

  workstationRelease(workstationId: string): void {
    this.socket?.emit('workstation:release', { workstationId });
  }

  workstationForceRelease(workstationId: string): void {
    this.socket?.emit('workstation:force-release', { workstationId });
  }

  workstationInvite(workstationId: string, targetPlayerId: string): void {
    this.socket?.emit('workstation:invite', { workstationId, targetPlayerId });
  }

  workstationUninvite(workstationId: string, targetPlayerId: string): void {
    this.socket?.emit('workstation:uninvite', { workstationId, targetPlayerId });
  }

  workstationRename(workstationId: string, customName: string | null): void {
    this.socket?.emit('workstation:rename', { workstationId, customName });
  }

  sendSpeakingState(speaking: boolean): void {
    this.socket?.emit('speaking_state', { speaking });
  }

  sendKartMount(kartId: string): void { this.socket?.emit('kart:mount', { kartId }); }
  sendKartDismount(): void { this.socket?.emit('kart:dismount'); }
  sendKartBoostStart(): void { this.socket?.emit('kart:boost_start'); }
  sendKartBoostEnd(): void { this.socket?.emit('kart:boost_end'); }

  onWorkstationState(cb: (ws: WorkstationStatePayload) => void): () => void {
    this.workstationStateListeners.add(cb);
    return () => this.workstationStateListeners.delete(cb);
  }

  onWorkstationInvite(cb: (inv: WorkstationInvitePayload) => void): () => void {
    this.workstationInviteListeners.add(cb);
    return () => this.workstationInviteListeners.delete(cb);
  }

  onSpeakingState(cb: (p: SpeakingStatePayload) => void): () => void {
    this.speakingStateListeners.add(cb);
    return () => this.speakingStateListeners.delete(cb);
  }

  private kartInitialCallbacks = new Set<(p: KartInitialPayload) => void>();
  private kartStateCallbacks = new Set<(p: KartStatePayload) => void>();

  onKartInitial(cb: (p: KartInitialPayload) => void): () => void {
    this.kartInitialCallbacks.add(cb);
    return () => this.kartInitialCallbacks.delete(cb);
  }
  onKartState(cb: (p: KartStatePayload) => void): () => void {
    this.kartStateCallbacks.add(cb);
    return () => this.kartStateCallbacks.delete(cb);
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
