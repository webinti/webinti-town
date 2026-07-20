import type { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { roomManager } from '../rooms/RoomManager.js';
import { config } from '../config.js';
import { verifyUserToken, getAccountFromToken } from '../pocketbase/client.js';
import { computeProximity } from './proximity.js';
import { saveBest } from '../race/leaderboardStore.js';
import { CIRCUIT_ID } from '../circuit.js';
import { getLicenseStatus, effectiveCapacity } from '../license/index.js';
import type {
  Appearance,
  ChatAttachment,
  ChatMessage,
  ChatMessageType,
  Direction,
  EmoteType,
  InteractiveObject,
  PlayerState,
  RoomState,
  WhiteboardStroke,
  WhiteboardText,
} from '../types.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORKSTATIONS } from '../workstations.js';
import { RECEPTIONIST, getMarieKnowledge, setMarieKnowledge } from '../ai/receptionist.js';
import { generateAgentReply, forgetConversation } from '../ai/agent.js';
import {
  getNearestAgent,
  toPublicAgents,
  toPublicAgent,
  buildAgentSystemPrompt,
  buildEmployeePersona,
  createEmployeeRecord,
  createUnderstudyRecord,
} from '../ai/AgentRegistry.js';

const UPLOADS_ROOT_HANDLER = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'data', 'uploads');
})();

/**
 * Valide qu'un attachment reçu du client référence un fichier existant
 * sous le bon roomSlug. Retourne l'objet nettoyé ou null si invalide.
 */
function parseAttachment(raw: unknown, roomSlug: string): ChatAttachment | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const url = typeof r.url === 'string' ? r.url : null;
  const filename = typeof r.filename === 'string' ? r.filename.slice(0, 80) : null;
  const mimeType = r.mimeType;
  const sizeBytes = typeof r.sizeBytes === 'number' && r.sizeBytes > 0 ? r.sizeBytes : null;

  if (!url || !filename || !sizeBytes) return null;

  // Valider le MIME
  const ALLOWED: ReadonlySet<string> = new Set([
    'image/jpeg', 'image/png', 'image/svg+xml', 'application/pdf',
  ]);
  if (typeof mimeType !== 'string' || !ALLOWED.has(mimeType)) return null;

  // Extraire le roomSlug et le filename depuis l'URL
  // Format attendu: /api/uploads/<roomSlug>/<uuid>.<ext>
  const match = url.match(/^\/api\/uploads\/([a-z0-9-]{1,50})\/([0-9a-f-]{36}\.(jpg|png|svg|pdf))$/);
  if (!match) return null;
  const urlRoomSlug = match[1];
  const urlFilename = match[2];

  // Le roomSlug dans l'URL doit correspondre à la room du socket
  if (urlRoomSlug !== roomSlug) return null;

  // Vérifier que le fichier existe vraiment sur le disque
  const filePath = join(UPLOADS_ROOT_HANDLER, roomSlug, urlFilename!);
  if (!existsSync(filePath)) return null;

  return {
    url,
    filename,
    mimeType: mimeType as ChatAttachment['mimeType'],
    sizeBytes,
  };
}

const WHITEBOARD_STROKE_CAP = 5000;
const WHITEBOARD_TEXT_MAX_LEN = 1000;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const ALLOWED_STROKE_SIZES: ReadonlyArray<number> = [2, 4, 8];

function parseStroke(raw: unknown, playerId: string): WhiteboardStroke | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64 ? r.id : null;
  const color = typeof r.color === 'string' && HEX_COLOR_RE.test(r.color) ? r.color : null;
  const size =
    typeof r.size === 'number' && ALLOWED_STROKE_SIZES.includes(r.size) ? r.size : null;
  const isErase = typeof r.isErase === 'boolean' ? r.isErase : false;
  if (!id || !color || size === null) return null;
  if (!Array.isArray(r.points) || r.points.length < 1 || r.points.length > 4000) return null;
  const points: Array<{ x: number; y: number }> = [];
  for (const pt of r.points) {
    if (typeof pt !== 'object' || pt === null) return null;
    const p = pt as Record<string, unknown>;
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
    points.push({ x: p.x, y: p.y });
  }
  return { id, playerId, color, size, points, isErase };
}

function parseText(raw: unknown, playerId: string): WhiteboardText | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64 ? r.id : null;
  const color = typeof r.color === 'string' && HEX_COLOR_RE.test(r.color) ? r.color : null;
  const size =
    typeof r.size === 'number' && ALLOWED_STROKE_SIZES.includes(r.size) ? r.size : null;
  if (!id || !color || size === null) return null;
  if (typeof r.x !== 'number' || typeof r.y !== 'number') return null;
  if (!Number.isFinite(r.x) || !Number.isFinite(r.y)) return null;
  if (r.x < 0 || r.x > 1 || r.y < 0 || r.y > 1) return null;
  const text = sanitizeMultilineText(r.text, WHITEBOARD_TEXT_MAX_LEN);
  if (!text) return null;
  return { id, playerId, x: r.x, y: r.y, text, color, size };
}

function sanitizeMultilineText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  // Strip HTML-ish tags and control chars EXCEPT newline (\n) and tab (\t).
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/^\n+|\n+$/g, '')
    .slice(0, max);
}
import { DEFAULT_APPEARANCE } from '../types.js';

interface SocketSession {
  roomSlug: string;
  playerId: string;
  chatTimestamps: number[];
  moveTimestamps: number[];
  typingTimestamps: number[];
  speakingTimestamps: number[];
  dmTimestamps: number[];
  knockTimestamps: number[];
}

const sessions = new Map<string, SocketSession>();
// Dernier confetti par joueur (cooldown anti-spam serveur).
const lastConfetti = new Map<string, number>();

// Messages captés par les doublures, en attente de livraison à leur propriétaire
// quand il revient. Clé = `${roomSlug}:${ownerPlayerId}`.
const understudyMessages = new Map<string, Array<{ from: string; text: string; ts: number }>>();

/** Retire la doublure d'un joueur (si présente) et lui livre les messages captés. */
function removeUnderstudy(room: RoomState, roomSlug: string, ownerPlayerId: string, io: Server): void {
  const agentId = `ai-und-${ownerPlayerId}`;
  if (room.agents.has(agentId)) {
    room.agents.delete(agentId);
    forgetConversation(`${roomSlug}:${agentId}`);
    io.to(roomSlug).emit('ai_agent_left', { agentId });
  }
  const key = `${roomSlug}:${ownerPlayerId}`;
  const msgs = understudyMessages.get(key);
  understudyMessages.delete(key);
  if (msgs && msgs.length) {
    const owner = room.players.get(ownerPlayerId);
    if (owner) {
      const text =
        `📨 Pendant votre absence, votre doublure a reçu ${msgs.length} message(s) :\n` +
        msgs.map((m) => `• ${m.from} : ${m.text}`).join('\n');
      const sysMsg: ChatMessage = {
        id: randomUUID(),
        playerId: agentId,
        playerName: 'Doublure IA',
        text,
        type: 'system',
        timestamp: Date.now(),
      };
      io.to(owner.socketId).emit('chat_message', sysMsg);
    }
  }
}

let roomServiceClient: RoomServiceClient | null = null;
function getRoomServiceClient(): RoomServiceClient | null {
  if (!config.livekitApiSecret) return null;
  if (!roomServiceClient) {
    const httpUrl = config.livekitUrl.replace(/^ws/, 'http');
    roomServiceClient = new RoomServiceClient(
      httpUrl,
      config.livekitApiKey,
      config.livekitApiSecret,
    );
  }
  return roomServiceClient;
}

async function muteParticipantMic(roomSlug: string, identity: string): Promise<void> {
  const svc = getRoomServiceClient();
  if (!svc) return;
  const participants = await svc.listParticipants(roomSlug);
  const target = participants.find((p) => p.identity === identity);
  if (!target) return;
  for (const t of target.tracks) {
    if (t.source === TrackSource.MICROPHONE && !t.muted) {
      await svc.mutePublishedTrack(roomSlug, identity, t.sid, true);
    }
  }
}

function sanitizeName(input: unknown): string {
  if (typeof input !== 'string') return 'Guest';
  const stripped = input.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return stripped.slice(0, 20) || 'Guest';
}

function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

// Longueur max du texte des messages (chat global/local et DM) — assez large
// pour partager des prompts ou blocs de texte entiers.
const MESSAGE_MAX_LEN = 10000;

// Variante multi-ligne de sanitizeText pour le corps des messages : conserve
// les sauts de ligne et tabulations (indispensables pour les prompts),
// strip HTML et les autres caractères de contrôle.
function sanitizeMessageText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.replace(/<[^>]*>/g, '').replace(/\r\n?/g, '\n');
  let out = '';
  for (const ch of cleaned) {
    const c = ch.codePointAt(0) ?? 0;
    const isControl = (c < 32 && c !== 10 && c !== 9) || c === 127;
    if (!isControl) out += ch;
  }
  return out.trim().slice(0, max);
}

function isDirection(v: unknown): v is Direction {
  return v === 'up' || v === 'down' || v === 'left' || v === 'right';
}

function isEmote(v: unknown): v is EmoteType {
  return (
    v === 'wave' ||
    v === 'heart' ||
    v === 'laugh' ||
    v === 'thumbsup' ||
    v === 'question' ||
    v === 'exclaim'
  );
}

function rateLimit(stamps: number[], limit: number, windowMs = 1000): boolean {
  const now = Date.now();
  while (stamps.length > 0 && now - stamps[0]! > windowMs) stamps.shift();
  if (stamps.length >= limit) return false;
  stamps.push(now);
  return true;
}

function publicPlayer(p: PlayerState): Omit<PlayerState, 'socketId' | 'lastActivityAt'> {
  const { socketId: _s, lastActivityAt: _la, ...rest } = p;
  return rest;
}

function intInRange(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const n = Math.floor(v);
  if (n < min || n > max) return null;
  return n;
}

function parseAppearance(raw: unknown): Appearance {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_APPEARANCE;
  const r = raw as Record<string, unknown>;
  // Bornes synchronisées avec client/src/types.ts (SKIN/OUTFIT/HAIR_*_COUNT).
  const skin = intInRange(r.skin, 0, 8);
  const outfit = intInRange(r.outfit, 0, 12);
  const hairStyle = intInRange(r.hairStyle, 0, 7);
  const hairColor = intInRange(r.hairColor, 0, 3);
  return {
    skin: skin ?? DEFAULT_APPEARANCE.skin,
    outfit: outfit ?? DEFAULT_APPEARANCE.outfit,
    hairStyle: hairStyle ?? DEFAULT_APPEARANCE.hairStyle,
    hairColor: hairColor ?? DEFAULT_APPEARANCE.hairColor,
  };
}

export function registerSocketHandlers(io: Server): void {
  io.on('connection', (socket: Socket) => {
    socket.on('join_room', async (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const roomSlug = typeof p.roomSlug === 'string' ? p.roomSlug : '';
      const name = sanitizeName(p.playerName);
      const appearance = parseAppearance(p.appearance);
      if (!roomSlug) return;
      // Identité + plan d'abonnement (non-bloquant : null ⇒ anonyme/free).
      const account = await getAccountFromToken(typeof p.token === 'string' ? p.token : undefined);
      let room = roomManager.getRoom(roomSlug);
      if (!room) {
        if (/^[a-z0-9-]{1,50}$/.test(roomSlug)) {
          room = roomManager.ensureRoom(roomSlug, roomSlug);
        } else {
          socket.emit('join_error', { message: 'Room not found' });
          return;
        }
      }
      // Capacité & contrôle d'accès — deux régimes selon l'édition.
      if (config.edition === 'selfhosted') {
        // Self-host mono-tenant : la LICENCE Webinti est la SEULE autorité de
        // capacité (pas de plans SaaS, pas de rooms démo à durée limitée).
        // Expirée/absente ⇒ aucune connexion ; 'restricted' ⇒ capacité réduite.
        const lic = getLicenseStatus();
        const licCap = effectiveCapacity(room.capacity, lic);
        if (licCap <= 0) {
          socket.emit('join_error', {
            code: 'license_expired',
            message: 'Licence Webinti expirée ou absente. Contactez votre administrateur.',
          });
          return;
        }
        if (room.players.size >= licCap) {
          socket.emit('join_error', {
            code: 'license_capacity',
            message: 'Capacité limitée par la licence Webinti. Contactez votre administrateur.',
          });
          return;
        }
      } else {
        // SaaS multi-tenant : le 1er compte authentifié qui crée une room non-demo
        // en devient propriétaire et fixe la capacité selon son plan ; les rooms
        // démo dédiées expirent (anti-abus).
        if (!room.isDemo && room.ownerEmail === null && account) {
          room.ownerEmail = account.email;
          room.capacity = config.planCapacity[account.plan] ?? config.planCapacity.free;
        }
        if (room.isDemo && room.expiresAt && Date.now() > room.expiresAt) {
          socket.emit('join_error', { message: 'Cette démo a expiré. Contactez-nous pour continuer.' });
          return;
        } else if (room.players.size >= room.capacity) {
          socket.emit('join_error', { message: `Cette salle est pleine (${room.capacity} personnes max).` });
          return;
        }
      }
      const existing = sessions.get(socket.id);
      if (existing) {
        socket.leave(existing.roomSlug);
        roomManager.removePlayer(existing.roomSlug, existing.playerId);
        sessions.delete(socket.id);
      }
      const clientKey = typeof p.clientKey === 'string' ? p.clientKey : undefined;
      const spawn = typeof p.spawnX === 'number' && typeof p.spawnY === 'number'
        ? { x: p.spawnX, y: p.spawnY }
        : undefined;
      const player = roomManager.addPlayer(roomSlug, socket.id, name, appearance, clientKey, spawn);
      if (!player) return;
      // Reconnexion / 2e onglet (même clientKey → même playerId) : addPlayer a
      // remplacé le record joueur (kartId=null) mais le KartManager garde encore
      // driverId = playerId pour le kart qu'il pilotait. Sans libération, le kart
      // « colle » à l'avatar (il le suit) alors que le joueur se croit à pied, et
      // reste collé même après en avoir pris/lâché un autre. On le libère + on
      // prévient toute la salle pour que tout le monde le voie redevenir libre.
      const staleKart = room.kartManager.getKartByDriver(player.playerId);
      if (staleKart) {
        room.kartManager.dismount(player.playerId);
        const freed = room.kartManager.getState(staleKart.id)!;
        room.karts.set(staleKart.id, freed);
        io.to(roomSlug).emit('kart:state', { ...freed });
      }
      // Statut hôte = vérifié côté serveur, JAMAIS sur un email client en clair.
      // Voie 1 : token PocketBase prouvé via authRefresh → email == config.hostEmail.
      //   NON-BLOQUANT : la vérif (≤ 4 s si PocketBase est down) ne retarde pas le
      //   join ; le badge hôte arrive juste après, via un host_changed dédié.
      // Voie 2 : hostToken (secret partagé via URL) en filet de secours, synchrone.
      void verifyUserToken(typeof p.token === 'string' ? p.token : undefined).then((verifiedEmail) => {
        if (!verifiedEmail || verifiedEmail !== config.hostEmail) return;
        const r = roomManager.getRoom(roomSlug);
        if (!r || !r.players.has(player.playerId)) return; // parti entre-temps
        roomManager.promoteToHost(roomSlug, player.playerId);
        io.to(roomSlug).emit('host_changed', { hostPlayerId: player.playerId });
      });
      const hostToken = typeof p.hostToken === 'string' ? p.hostToken : '';
      if (config.hostToken && hostToken === config.hostToken) {
        roomManager.promoteToHost(roomSlug, player.playerId);
      }
      sessions.set(socket.id, {
        roomSlug,
        playerId: player.playerId,
        chatTimestamps: [],
        moveTimestamps: [],
        typingTimestamps: [],
        speakingTimestamps: [],
        dmTimestamps: [],
        knockTimestamps: [],
      });
      socket.join(roomSlug);
      // S'assure que les IA embauchées persistées sont chargées avant d'envoyer
      // l'état (mémoïsé : ne charge qu'une fois par room).
      await room.employeeStore.loadInto(room.agents);
      const players = Array.from(room.players.values()).map(publicPlayer);
      socket.emit('room_state', {
        playerId: player.playerId,
        roomSlug,
        roomName: room.name,
        players,
        chatHistory: room.chatHistory
          .filter((m) => m.timestamp >= Date.now() - config.messageTtlMs)
          .slice(-50),
        interactiveObjects: room.interactiveObjects,
        aiAgents: toPublicAgents(room.agents),
        hostPlayerId: room.hostPlayerId,
        isRecording: room.isRecording,
      });
      // Await the lazy load (memoized — read au plus une fois). Si on n'attend
      // pas, getCards() retourne [] alors que le fichier JSON contient des cartes,
      // et le client affiche un board vide jusqu'à la prochaine mutation.
      void room.kanbanStore.load().then(() => {
        socket.emit('kanban:state', { cards: room.kanbanStore.getCards() });
      }).catch((err) => {
        console.error('[join] kanban load échouée', err);
        socket.emit('kanban:state', { cards: room.kanbanStore.getCards() });
      });
      // F10 — DM: load (memoized) puis envoyer les conversations où je suis impliqué
      void room.dmStore.load().then(() => {
        socket.emit('dm:state', {
          conversations: room.dmStore.getConversationsFor(player.playerId),
        });
      }).catch((err) => {
        console.error('[join] dm load échouée', err);
        socket.emit('dm:state', { conversations: room.dmStore.getConversationsFor(player.playerId) });
      });
      // Attendre le load mémoïsé avant d'émettre, sinon le client reçoit un
      // snapshot vide alors que des claims sont persistés sur disque.
      void room.workstationManager.load().then(() => {
        socket.emit('workstation:initial', {
          workstations: room.workstationManager.getAllStates(),
        });
      }).catch((err) => {
        console.error('[join] workstation load échouée', err);
        socket.emit('workstation:initial', { workstations: room.workstationManager.getAllStates() });
      });
      // F11 — état initial des karts (pas de load async, pas de persistance).
      socket.emit('kart:initial', { karts: room.kartManager.getAllStates() });
      // F12 — classement initial du circuit + meilleur tour perso (si connu).
      socket.emit('circuit:leaderboard', { entries: room.raceManager.getLeaderboard() });
      const myBest = room.raceManager.getBest(player.playerId);
      if (myBest !== null) socket.emit('circuit:event', { type: 'best', ms: myBest });
      socket.to(roomSlug).emit('player_joined', publicPlayer(player));
      io.to(roomSlug).emit('host_changed', { hostPlayerId: room.hostPlayerId });
      // Le joueur revient : si une doublure le remplaçait, on la retire et on lui
      // livre les messages reçus pendant son absence.
      removeUnderstudy(room, roomSlug, player.playerId, io);
    });

    socket.on('recording_state', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const on = p.on === true;
      const ok = roomManager.setRecording(session.roomSlug, session.playerId, on);
      if (!ok) return;
      const room = roomManager.getRoom(session.roomSlug);
      const host = room?.hostPlayerId ? room.players.get(room.hostPlayerId) : undefined;
      io.to(session.roomSlug).emit('recording_state', {
        isRecording: on,
        hostPlayerId: room?.hostPlayerId ?? null,
        hostName: host?.name ?? '',
      });
    });

    socket.on('player_move', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.moveTimestamps, 30)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const x = typeof p.x === 'number' ? p.x : NaN;
      const y = typeof p.y === 'number' ? p.y : NaN;
      const direction = isDirection(p.direction) ? p.direction : 'down';
      const isMoving = typeof p.isMoving === 'boolean' ? p.isMoving : false;
      // Bornes anti-triche : une position hors map fausserait les collisions
      // kart (knockback) et la détection de course. La map fait < 4000×1400 px ;
      // on laisse une marge large mais finie.
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 100000 || y > 100000) return;
      roomManager.updatePlayerPosition(session.roomSlug, session.playerId, x, y, direction, isMoving);
      // F12 — détection course : si le joueur est en kart, vérifier les passages
      // de checkpoints (autoritaire serveur) et notifier le pilote.
      {
        const room = roomManager.getRoom(session.roomSlug);
        const player = room?.players.get(session.playerId);
        if (room && player && player.kartId !== null) {
          const events = room.raceManager.onMove(player.playerId, player.name, player.x, player.y);
          for (const ev of events) {
            socket.emit('circuit:event', ev);
            if (ev.type === 'lap' && ev.isBest) {
              // Persiste le nouveau record + diffuse le classement à jour à la room.
              void saveBest(room.slug, CIRCUIT_ID, {
                playerId: player.playerId,
                name: player.name,
                ms: ev.ms,
              });
              io.to(room.slug).emit('circuit:leaderboard', {
                entries: room.raceManager.getLeaderboard(),
              });
            }
          }
        }
      }
      // Compter le mouvement comme activité (peut rétablir inactive → available)
      const presenceChanged = roomManager.markActivity(session.roomSlug, session.playerId);
      if (presenceChanged) {
        const room2 = roomManager.getRoom(session.roomSlug);
        const player2 = room2?.players.get(session.playerId);
        if (player2) io.to(session.roomSlug).emit('player_update', publicPlayer(player2));
      }
    });

    socket.on('chat_message', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.chatTimestamps, 5)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const text = sanitizeMessageText(p.text, MESSAGE_MAX_LEN);
      // Le texte peut être vide SI une pièce jointe est présente
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;

      // Valider l'attachment (strip silencieux si invalide)
      const attachment = parseAttachment(p.attachment, session.roomSlug);

      // Un message doit avoir du texte OU une pièce jointe valide
      if (!text && !attachment) return;

      const msg: ChatMessage = {
        id: randomUUID(),
        playerId: player.playerId,
        playerName: player.name,
        text,
        type: p.type === 'global' ? 'global' : p.type === 'system' ? 'system' : 'local',
        timestamp: Date.now(),
        ...(attachment ? { attachment } : {}),
      };
      // Activité chat : peut rétablir inactive → available
      const presenceChangedByChat = roomManager.markActivity(session.roomSlug, session.playerId);
      if (presenceChangedByChat) {
        const updatedPlayer = room.players.get(session.playerId);
        if (updatedPlayer) io.to(session.roomSlug).emit('player_update', publicPlayer(updatedPlayer));
      }
      roomManager.pushChat(session.roomSlug, msg);
      if (msg.type === 'local') {
        const radiusSq = config.proximityRadiusPx * config.proximityRadiusPx;
        for (const other of room.players.values()) {
          const dx = other.x - player.x;
          const dy = other.y - player.y;
          if (dx * dx + dy * dy <= radiusSq) {
            io.to(other.socketId).emit('chat_message', msg);
          }
        }
      } else {
        io.to(session.roomSlug).emit('chat_message', msg);
      }

      // Agents IA incarnés : si un joueur proche d'un agent (Marie, IA embauchée
      // ou doublure) écrit en chat local, l'agent LE PLUS PROCHE lui répond.
      // Fire-and-forget (l'appel réseau ne doit pas bloquer le handler).
      if (config.aiEnabled && text && msg.type === 'local') {
        const agent = getNearestAgent(room.agents, player.x, player.y, config.proximityRadiusPx);
        if (agent) {
          // Doublure : on capte le message pour le livrer au propriétaire à son retour.
          if (agent.kind === 'understudy' && agent.ownerPlayerId && agent.ownerPlayerId !== player.playerId) {
            const key = `${session.roomSlug}:${agent.ownerPlayerId}`;
            const arr = understudyMessages.get(key) ?? [];
            arr.push({ from: player.name, text, ts: Date.now() });
            if (arr.length > 30) arr.shift();
            understudyMessages.set(key, arr);
          }
          // Contexte temps réel : qui est connecté maintenant (l'agent peut répondre
          // précisément à « on est combien / qui est là »).
          const present = [...room.players.values()].map((pl) => pl.name);
          const liveContext =
            `Personnes actuellement connectées : ${present.length} ` +
            `(${present.join(', ') || 'aucune autre'}). ` +
            `Ce nombre est affiché en haut de l'écran sous la forme « Connecté · N joueur(s) ».`;
          const agentX = agent.x;
          const agentY = agent.y;
          void generateAgentReply({
            conversationKey: `${session.roomSlug}:${agent.agentId}`,
            systemPrompt: buildAgentSystemPrompt(agent, liveContext),
            agentName: agent.name,
            userName: player.name,
            userText: text,
          }).then((reply) => {
            if (!reply) return;
            const liveRoom = roomManager.getRoom(session.roomSlug);
            if (!liveRoom) return;
            const aiMsg: ChatMessage = {
              id: randomUUID(),
              playerId: agent.agentId,
              playerName: agent.name,
              text: reply,
              type: 'local',
              timestamp: Date.now(),
            };
            roomManager.pushChat(session.roomSlug, aiMsg);
            // On diffuse aux joueurs proches de L'AGENT (pas de l'émetteur).
            const rSq = config.proximityRadiusPx * config.proximityRadiusPx;
            for (const other of liveRoom.players.values()) {
              const dx = other.x - agentX;
              const dy = other.y - agentY;
              if (dx * dx + dy * dy <= rSq) io.to(other.socketId).emit('chat_message', aiMsg);
            }
          });
        }
      }
    });

    socket.on('typing_start', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      // Rate-limit : 5 events par seconde par socket. Drop silencieux au-delà.
      if (!rateLimit(session.typingTimestamps, 5)) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      // Broadcast à tous les autres joueurs de la room (excluant l'émetteur).
      socket.to(session.roomSlug).emit('typing_state', {
        playerId: session.playerId,
        typing: true,
        t: Date.now(),
      });
    });

    // F6 — speaking_state relay (rate-limit + broadcast room-wide incl. sender).
    // The sender is INCLUDED in the broadcast so the local user gets their own
    // 💬 update without needing a separate path. (io.to includes sender; that's
    // what we want here — different from typing_state which uses socket.to.)
    socket.on('speaking_state', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.speakingTimestamps, 5)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const speaking = p.speaking === true;
      io.to(session.roomSlug).emit('speaking_state', {
        playerId: session.playerId,
        speaking,
      });
    });

    socket.on('update_note', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const objectId = typeof p.objectId === 'string' ? p.objectId : '';
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || !objectId) return;
      if (room.hostPlayerId !== session.playerId) return;
      const obj = room.interactiveObjects.find((o) => o.id === objectId);
      if (!obj || obj.type !== 'note') return;
      const title = sanitizeText(p.title, 80) || obj.data.title;
      const rawContent = typeof p.content === 'string' ? p.content : '';
      const content = rawContent.replace(/<[^>]*>/g, '').slice(0, 2000);
      obj.data = { title, content };
      io.to(session.roomSlug).emit('object_update', obj);
    });

    socket.on('interact_object', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const objectId = typeof p.objectId === 'string' ? p.objectId : '';
      if (!objectId) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const obj = room.interactiveObjects.find((o) => o.id === objectId);
      if (!obj) return;

      if (obj.type === 'screen') {
        const current = obj.data.sharedByPlayerId;
        if (!current) {
          obj.data.sharedByPlayerId = session.playerId;
        } else if (current === session.playerId) {
          obj.data.sharedByPlayerId = undefined;
        } else {
          return;
        }
        const update: InteractiveObject = obj;
        io.to(session.roomSlug).emit('object_update', update);
        return;
      }

      if (obj.type === 'note' || obj.type === 'link') {
        socket.emit('object_interaction', { objectId: obj.id, type: obj.type, data: obj.data });
        return;
      }
    });

    socket.on('whiteboard_stroke', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const objectId = typeof p.objectId === 'string' ? p.objectId : '';
      if (!objectId) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const obj = room.interactiveObjects.find((o) => o.id === objectId);
      if (!obj || obj.type !== 'whiteboard') return;
      const stroke = parseStroke(p.stroke, session.playerId);
      if (!stroke) return;
      obj.data.strokes.push(stroke);
      if (obj.data.strokes.length > WHITEBOARD_STROKE_CAP) {
        obj.data.strokes.splice(0, obj.data.strokes.length - WHITEBOARD_STROKE_CAP);
      }
      socket.to(session.roomSlug).emit('whiteboard_stroke', { objectId, stroke });
    });

    socket.on('whiteboard_text', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const objectId = typeof p.objectId === 'string' ? p.objectId : '';
      if (!objectId) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const obj = room.interactiveObjects.find((o) => o.id === objectId);
      if (!obj || obj.type !== 'whiteboard') return;
      const text = parseText(p.text, session.playerId);
      if (!text) return;
      if (!obj.data.texts) obj.data.texts = [];
      const total = obj.data.strokes.length + obj.data.texts.length;
      if (total >= WHITEBOARD_STROKE_CAP) {
        if (obj.data.texts.length > 0) {
          obj.data.texts.shift();
        } else {
          return;
        }
      }
      obj.data.texts.push(text);
      socket.to(session.roomSlug).emit('whiteboard_text', { objectId, text });
    });

    socket.on('whiteboard_text_update', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const objectId = typeof p.objectId === 'string' ? p.objectId : '';
      const textId = typeof p.textId === 'string' ? p.textId : '';
      if (!objectId || !textId) return;
      if (typeof p.x !== 'number' || typeof p.y !== 'number') return;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const obj = room.interactiveObjects.find((o) => o.id === objectId);
      if (!obj || obj.type !== 'whiteboard') return;
      const texts = obj.data.texts;
      if (!texts) return;
      const t = texts.find((tt) => tt.id === textId);
      if (!t) return;
      t.x = p.x;
      t.y = p.y;
      socket.to(session.roomSlug).emit('whiteboard_text_update', { objectId, textId, x: p.x, y: p.y });
    });

    socket.on('whiteboard_text_delete', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const objectId = typeof p.objectId === 'string' ? p.objectId : '';
      const textId = typeof p.textId === 'string' ? p.textId : '';
      if (!objectId || !textId) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const obj = room.interactiveObjects.find((o) => o.id === objectId);
      if (!obj || obj.type !== 'whiteboard') return;
      if (!obj.data.texts) return;
      const before = obj.data.texts.length;
      obj.data.texts = obj.data.texts.filter((t) => t.id !== textId);
      if (obj.data.texts.length === before) return;
      socket.to(session.roomSlug).emit('whiteboard_text_delete', { objectId, textId });
    });

    socket.on('whiteboard_clear', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const objectId = typeof p.objectId === 'string' ? p.objectId : '';
      if (!objectId) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const obj = room.interactiveObjects.find((o) => o.id === objectId);
      if (!obj || obj.type !== 'whiteboard') return;
      obj.data.strokes = [];
      obj.data.texts = [];
      io.to(session.roomSlug).emit('whiteboard_clear', { objectId });
    });

    socket.on('kanban:create', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const title = typeof p.title === 'string' ? p.title : '';
      const description = typeof p.description === 'string' ? p.description : '';
      // create() peut être sync (JSON) ou async (PocketBase) selon le backend
      const ok = await room.kanbanStore.create(player.playerId, player.name, title, description);
      if (!ok) return;
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });

    socket.on('kanban:update', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const cardId = typeof p.cardId === 'string' ? p.cardId : '';
      if (!cardId) return;
      const patch: { title?: string; description?: string } = {};
      if (typeof p.title === 'string') patch.title = p.title;
      if (typeof p.description === 'string') patch.description = p.description;
      if (!room.kanbanStore.update(session.playerId, cardId, patch)) return;
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });

    socket.on('kanban:move', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const cardId = typeof p.cardId === 'string' ? p.cardId : '';
      const column = p.column;
      const position = typeof p.position === 'number' && Number.isFinite(p.position) ? Math.floor(p.position) : 0;
      if (!cardId) return;
      if (column !== 'todo' && column !== 'doing' && column !== 'done') return;
      const isHost = room.hostPlayerId === session.playerId;
      if (!room.kanbanStore.move(session.playerId, isHost, cardId, column, position)) return;
      // If we just promoted to 'done', stamp the host's display name.
      if (column === 'done') {
        const host = room.players.get(session.playerId);
        if (host) room.kanbanStore.setCompletedByName(cardId, host.name);
      }
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });

    socket.on('kanban:delete', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const cardId = typeof p.cardId === 'string' ? p.cardId : '';
      if (!cardId) return;
      if (!room.kanbanStore.delete(session.playerId, cardId)) return;
      io.to(session.roomSlug).emit('kanban:state', { cards: room.kanbanStore.getCards() });
    });

    // ────────────── F10 — Direct Messages ──────────────
    socket.on('dm:send', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.dmTimestamps, 5)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const toPlayerId = typeof p.toPlayerId === 'string' ? p.toPlayerId : '';
      if (!toPlayerId || toPlayerId === session.playerId) return;
      const text = sanitizeMessageText(p.text, MESSAGE_MAX_LEN);
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const sender = room.players.get(session.playerId);
      if (!sender) return;

      const attachment = parseAttachment(p.attachment, session.roomSlug);
      if (!text && !attachment) return;

      const msg = await room.dmStore.append(session.playerId, toPlayerId, text, attachment);
      if (!msg) return;

      // Activité chat : DM compte aussi
      const presenceChanged = roomManager.markActivity(session.roomSlug, session.playerId);
      if (presenceChanged) {
        const updated = room.players.get(session.playerId);
        if (updated) io.to(session.roomSlug).emit('player_update', publicPlayer(updated));
      }

      // Emit à l'expéditeur (echo / confirm)
      socket.emit('dm:message', msg);
      // Emit au destinataire SI connecté dans la room
      const target = room.players.get(toPlayerId);
      if (target) io.to(target.socketId).emit('dm:message', msg);
    });

    socket.on('dm:read', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const withPlayerId = typeof p.withPlayerId === 'string' ? p.withPlayerId : '';
      if (!withPlayerId) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      room.dmStore.markRead(session.playerId, withPlayerId);
    });

    // ─── workstation:claim ───────────────────────────────────────────────────
    socket.on('workstation:claim', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      if (!workstationId) return;

      const fail = (reason: string) =>
        socket.emit('workstation:claim_failed', {
          workstationId, reason, x: Math.round(player.x), y: Math.round(player.y),
        });

      // F11 — pas de claim de poste en kart : faut descendre d'abord.
      if (player.kartId !== null) { fail('on_kart'); return; }

      const ok = await room.workstationManager.claim(
        workstationId, session.playerId, player.name, player.x, player.y,
      );
      if (!ok) {
        // Déduire la raison pour le retour au client (diagnostic + UX).
        const cur = room.workstationManager.getState(workstationId);
        if (cur && cur.claimedBy !== null) {
          fail(cur.claimedBy === session.playerId ? 'already_mine' : 'already_claimed');
        } else {
          fail('not_in_zone');
        }
        return;
      }
      // Synchroniser la Map workstations depuis WorkstationManager.
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });

    // ─── workstation:release ─────────────────────────────────────────────────
    socket.on('workstation:release', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      if (!workstationId) return;
      const ok = await room.workstationManager.release(workstationId, session.playerId);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });

    // ─── workstation:force-release (hôte uniquement) ─────────────────────────
    socket.on('workstation:force-release', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      // Seul l'hôte peut forcer la libération
      if (room.hostPlayerId !== session.playerId) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      if (!workstationId) return;
      const ok = await room.workstationManager.forceRelease(workstationId);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });

    // ─── workstation:invite ───────────────────────────────────────────────────
    socket.on('workstation:invite', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const claimer = room.players.get(session.playerId);
      if (!claimer) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      const targetPlayerId = typeof p.targetPlayerId === 'string' ? p.targetPlayerId : '';
      if (!workstationId || !targetPlayerId) return;
      // Vérifier que le target existe dans la room.
      const target = room.players.get(targetPlayerId);
      if (!target) return;
      const ok = await room.workstationManager.invite(workstationId, session.playerId, targetPlayerId);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      // Broadcast l'état mis à jour à toute la room.
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
      // Unicast toast d'invitation au target.
      const workstationDef = WORKSTATIONS.find((w) => w.id === workstationId);
      const wsState = room.workstationManager.getState(workstationId);
      const workstationName = wsState?.customName ?? workstationDef?.name ?? workstationId;
      io.to(target.socketId).emit('workstation:invite', {
        fromPlayerId: session.playerId,
        fromPlayerName: claimer.name,
        workstationId,
        workstationName,
      });
    });

    // ─── workstation:rename ──────────────────────────────────────────────────
    socket.on('workstation:rename', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      if (!workstationId) return;
      // customName peut être null (pour effacer) ou une string
      const customName = p.customName === null ? null : typeof p.customName === 'string' ? p.customName : undefined;
      if (customName === undefined) return;
      const ok = await room.workstationManager.setCustomName(session.playerId, workstationId, customName);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });

    // ─── workstation:uninvite ─────────────────────────────────────────────────
    socket.on('workstation:uninvite', async (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const workstationId = typeof p.workstationId === 'string' ? p.workstationId : '';
      const targetPlayerId = typeof p.targetPlayerId === 'string' ? p.targetPlayerId : '';
      if (!workstationId || !targetPlayerId) return;
      const ok = await room.workstationManager.uninvite(workstationId, session.playerId, targetPlayerId);
      if (!ok) return;
      for (const s of room.workstationManager.getAllStates()) {
        room.workstations.set(s.id, s);
      }
      const ws = room.workstationManager.getState(workstationId)!;
      io.to(session.roomSlug).emit('workstation:state', { ...ws });
    });

    // ─── kart:mount ─────────────────────────────────────────────────────────
    socket.on('kart:mount', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      if (player.kartId !== null) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const kartId = typeof p.kartId === 'string' ? p.kartId : '';
      if (!kartId) return;
      const ok = room.kartManager.mount(kartId, session.playerId, player.x, player.y);
      if (!ok) return;
      player.kartId = kartId;
      const k = room.kartManager.getState(kartId)!;
      room.karts.set(kartId, k);
      io.to(session.roomSlug).emit('kart:state', { ...k });
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    // ─── kart:dismount ───────────────────────────────────────────────────────
    socket.on('kart:dismount', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player || player.kartId === null) return;
      const kartId = player.kartId;
      // Capture the current driver position before dismounting.
      room.kartManager.move(session.playerId, player.x, player.y);
      const ok = room.kartManager.dismount(session.playerId);
      if (!ok) return;
      player.kartId = null;
      player.boosting = false;
      const k = room.kartManager.getState(kartId)!;
      room.karts.set(kartId, k);
      // F12 — abandonner le tour en cours en descendant du kart.
      room.raceManager.reset(session.playerId);
      socket.emit('circuit:event', { type: 'reset' });
      io.to(session.roomSlug).emit('kart:state', { ...k });
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    // ─── kart:boost_start / kart:boost_end ───────────────────────────────────
    socket.on('kart:boost_start', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player || player.kartId === null) return;
      if (player.boosting) return;
      player.boosting = true;
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    socket.on('kart:boost_end', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player || !player.boosting) return;
      player.boosting = false;
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    // ─── speaking_state ───────────────────────────────────────────────────────
    // Relay simple : le client envoie { speaking: boolean }, on rebroadcast à
    // toute la room avec { playerId, speaking }. Rate-limit : 5/s/socket.
    socket.on('speaking_state', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.speakingTimestamps, 5)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const speaking = typeof p.speaking === 'boolean' ? p.speaking : false;
      socket.to(session.roomSlug).emit('speaking_state', {
        playerId: session.playerId,
        speaking,
      });
    });

    socket.on('presence_set', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const pres = p.presence;
      // 'inactive' ne peut pas être défini manuellement par le client
      if (
        pres !== 'available' &&
        pres !== 'away' &&
        pres !== 'brb' &&
        pres !== 'dnd'
      ) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const changed = roomManager.setPresence(session.roomSlug, session.playerId, pres);
      if (!changed) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    // Changement d'avatar en cours de partie (menu HUD). On met à jour le
    // joueur côté serveur et on rediffuse à toute la salle.
    socket.on('update_appearance', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      player.appearance = parseAppearance(p.appearance);
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    socket.on('presence_activity', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const presenceChanged = roomManager.markActivity(session.roomSlug, session.playerId);
      if (!presenceChanged) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      io.to(session.roomSlug).emit('player_update', publicPlayer(player));
    });

    socket.on('emote', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      if (!isEmote(p.emoteType)) return;
      io.to(session.roomSlug).emit('emote', {
        playerId: session.playerId,
        emoteType: p.emoteType,
        timestamp: Date.now(),
      });
    });

    // Confettis (touche F) — effet diffusé à toute la salle, comme dans Gather.
    // Cooldown serveur léger pour éviter le spam.
    socket.on('confetti', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const now = Date.now();
      const last = lastConfetti.get(session.playerId) ?? 0;
      if (now - last < 600) return;
      lastConfetti.set(session.playerId, now);
      io.to(session.roomSlug).emit('confetti', {
        playerId: session.playerId,
        timestamp: now,
      });
    });

    // « Toc toc » : signaler à un membre (ex. occupé dans son bureau) qu'on veut
    // lui parler. Relai ciblé + son côté destinataire. Rate-limit 2/s.
    socket.on('knock', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      if (!rateLimit(session.knockTimestamps, 2)) return;
      if (typeof payload !== 'object' || payload === null) return;
      const targetPlayerId = (payload as Record<string, unknown>).targetPlayerId;
      if (typeof targetPlayerId !== 'string' || !targetPlayerId) return;
      if (targetPlayerId === session.playerId) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const me = room.players.get(session.playerId);
      const target = room.players.get(targetPlayerId);
      if (!me || !target) return;
      io.to(target.socketId).emit('knocked', { fromPlayerId: me.playerId, fromName: me.name });
    });

    // ── Agent d'accueil « Marie » : consignes éditables (hôte seulement) ──
    socket.on('ai:get_config', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      socket.emit('ai:config', { knowledge: getMarieKnowledge(session.roomSlug) });
    });

    socket.on('ai:set_config', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      const knowledge =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>).knowledge
          : undefined;
      const saved = setMarieKnowledge(
        session.roomSlug,
        typeof knowledge === 'string' ? knowledge : '',
      );
      // Applique à chaud le nouveau savoir au record d'agent de Marie.
      const marie = room.agents.get(RECEPTIONIST.id);
      if (marie) marie.knowledge = saved;
      socket.emit('ai:config', { knowledge: saved, saved: true });
    });

    // ── Embauche d'IA (hôte) : crée un agent « employé » posté là où est l'hôte ──
    const MAX_EMPLOYEES = 8;
    socket.on('ai:hire', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      const host = room.players.get(session.playerId);
      if (!host) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const name = sanitizeName(p.name);
      const role = sanitizeText(p.role, 60);
      const knowledge = typeof p.knowledge === 'string' ? p.knowledge.slice(0, 6000) : '';
      const appearance = parseAppearance(p.appearance);
      let count = 0;
      for (const a of room.agents.values()) if (a.kind === 'employee') count += 1;
      if (count >= MAX_EMPLOYEES) {
        socket.emit('ai:hire_error', { message: `Limite atteinte (${MAX_EMPLOYEES} IA maximum par salle).` });
        return;
      }
      const rec = createEmployeeRecord({ name, role, knowledge, appearance, x: host.x, y: host.y });
      room.agents.set(rec.agentId, rec);
      io.to(session.roomSlug).emit('ai_agent_joined', toPublicAgent(rec));
      room.employeeStore.create(rec); // persistance (best-effort)
    });

    socket.on('ai:fire', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      const agentId =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>).agentId
          : undefined;
      if (typeof agentId !== 'string' || !agentId) return;
      const rec = room.agents.get(agentId);
      // On ne licencie que les IA embauchées (jamais Marie ni une doublure).
      if (!rec || rec.kind !== 'employee') return;
      room.agents.delete(agentId);
      forgetConversation(`${session.roomSlug}:${agentId}`);
      io.to(session.roomSlug).emit('ai_agent_left', { agentId });
      room.employeeStore.remove(agentId); // persistance (best-effort)
    });

    // Récupère la config éditable d'une IA embauchée (hôte) — pour pré-remplir le formulaire d'édition.
    socket.on('ai:get_agent', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      const agentId =
        payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>).agentId
          : undefined;
      if (typeof agentId !== 'string') return;
      const rec = room.agents.get(agentId);
      if (!rec || rec.kind !== 'employee') return;
      socket.emit('ai:agent_config', {
        agentId: rec.agentId,
        name: rec.name,
        role: rec.role,
        knowledge: rec.knowledge,
        appearance: rec.appearance,
      });
    });

    // Met à jour une IA embauchée (hôte) : nom, rôle, FAQ/instructions, avatar.
    socket.on('ai:update', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      const agentId = typeof p.agentId === 'string' ? p.agentId : '';
      const rec = room.agents.get(agentId);
      if (!rec || rec.kind !== 'employee') return;
      if (typeof p.name === 'string') rec.name = sanitizeName(p.name);
      if (typeof p.role === 'string') rec.role = sanitizeText(p.role, 60);
      if (typeof p.knowledge === 'string') rec.knowledge = p.knowledge.slice(0, 6000);
      if (p.appearance) rec.appearance = parseAppearance(p.appearance);
      // Reconstruit le persona avec le nom/rôle à jour.
      rec.persona = buildEmployeePersona(rec.name, rec.role);
      io.to(session.roomSlug).emit('ai_agent_update', toPublicAgent(rec));
      room.employeeStore.update(rec); // persistance (best-effort)
      socket.emit('ai:agent_config', {
        agentId: rec.agentId,
        name: rec.name,
        role: rec.role,
        knowledge: rec.knowledge,
        appearance: rec.appearance,
        saved: true,
      });
    });

    // ── Doublure de poste : activer/désactiver son IA de remplacement ──
    socket.on('understudy:set', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room) return;
      const player = room.players.get(session.playerId);
      if (!player) return;
      const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
      const on = p.on === true;
      const agentId = `ai-und-${player.playerId}`;
      if (on) {
        if (!room.agents.has(agentId)) {
          const note = typeof p.note === 'string' ? p.note.slice(0, 2000) : '';
          const rec = createUnderstudyRecord({
            ownerPlayerId: player.playerId,
            ownerName: player.name,
            appearance: player.appearance,
            x: player.x,
            y: player.y,
            note,
          });
          room.agents.set(agentId, rec);
          io.to(session.roomSlug).emit('ai_agent_joined', toPublicAgent(rec));
        }
        socket.emit('understudy:state', { on: true });
      } else {
        removeUnderstudy(room, session.roomSlug, player.playerId, io);
        socket.emit('understudy:state', { on: false });
      }
    });

    socket.on('admin_kick', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      if (typeof payload !== 'object' || payload === null) return;
      const targetPlayerId = (payload as Record<string, unknown>).targetPlayerId;
      if (typeof targetPlayerId !== 'string' || !targetPlayerId) return;
      if (targetPlayerId === session.playerId) return;
      const target = room.players.get(targetPlayerId);
      if (!target) return;
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit('kicked', { reason: 'kicked by host' });
        targetSocket.disconnect(true);
      }
    });

    socket.on('admin_mute', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      if (typeof payload !== 'object' || payload === null) return;
      const targetPlayerId = (payload as Record<string, unknown>).targetPlayerId;
      if (typeof targetPlayerId !== 'string' || !targetPlayerId) return;
      if (targetPlayerId === session.playerId) return;
      // 1) mute côté serveur LiveKit (best-effort, coupe la piste au SFU)
      void muteParticipantMic(session.roomSlug, targetPlayerId).catch((err) => {
        console.error('[admin_mute]', err);
      });
      // 2) force-mute par socket : on demande au client ciblé de couper son micro
      // (fiable même si l'API LiveKit n'est pas joignable).
      const target = room.players.get(targetPlayerId);
      if (target) io.to(target.socketId).emit('force_mute');
    });

    socket.on('admin_mute_all', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      for (const p of room.players.values()) {
        if (p.playerId === room.hostPlayerId) continue;
        void muteParticipantMic(session.roomSlug, p.playerId).catch((err) => {
          console.error('[admin_mute_all]', err);
        });
        io.to(p.socketId).emit('force_mute');
      }
    });

    socket.on('admin_transfer_host', (payload: unknown) => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      if (typeof payload !== 'object' || payload === null) return;
      const targetPlayerId = (payload as Record<string, unknown>).targetPlayerId;
      if (typeof targetPlayerId !== 'string' || !targetPlayerId) return;
      if (targetPlayerId === session.playerId) return;
      const target = room.players.get(targetPlayerId);
      if (!target) return;
      roomManager.promoteToHost(session.roomSlug, targetPlayerId);
      room.isRecording = false;
      io.to(session.roomSlug).emit('host_changed', { hostPlayerId: room.hostPlayerId });
      io.to(session.roomSlug).emit('recording_state', {
        isRecording: false,
        hostPlayerId: room.hostPlayerId,
        hostName: target.name,
      });
    });

    socket.on('admin_close_room', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const room = roomManager.getRoom(session.roomSlug);
      if (!room || room.hostPlayerId !== session.playerId) return;
      const hostId = room.hostPlayerId;
      const targets: string[] = [];
      for (const p of room.players.values()) {
        if (p.playerId !== hostId) targets.push(p.socketId);
      }
      for (const socketId of targets) {
        const s = io.sockets.sockets.get(socketId);
        if (s) {
          s.emit('kicked', { reason: 'room closed by host' });
          s.disconnect(true);
        }
      }
    });

    socket.on('toggle_ghost', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const player = roomManager.toggleGhost(session.roomSlug, session.playerId);
      if (!player) return;
      io.to(session.roomSlug).emit('player_ghost', {
        playerId: player.playerId,
        isGhost: player.isGhost,
      });
    });

    socket.on('disconnect', () => {
      const session = sessions.get(socket.id);
      if (!session) return;
      const wasHost = roomManager.getRoom(session.roomSlug)?.hostPlayerId === session.playerId;
      const removed = roomManager.removePlayer(session.roomSlug, session.playerId);
      sessions.delete(socket.id);
      lastConfetti.delete(session.playerId);
      if (removed) {
        io.to(session.roomSlug).emit('player_left', { playerId: session.playerId });
      }
      const room = roomManager.getRoom(session.roomSlug);
      if (room) {
        for (const obj of room.interactiveObjects) {
          if (obj.type === 'screen' && obj.data.sharedByPlayerId === session.playerId) {
            obj.data.sharedByPlayerId = undefined;
            io.to(session.roomSlug).emit('object_update', obj);
          }
        }
        if (wasHost) {
          const host = room.hostPlayerId ? room.players.get(room.hostPlayerId) : undefined;
          io.to(session.roomSlug).emit('host_changed', { hostPlayerId: room.hostPlayerId });
          io.to(session.roomSlug).emit('recording_state', {
            isRecording: false,
            hostPlayerId: room.hostPlayerId,
            hostName: host?.name ?? '',
          });
        }
      }
    });
  });
}

export function startTickLoops(io: Server): void {
  const tickIntervalMs = Math.round(1000 / config.tickRateHz);
  const proximityIntervalMs = Math.round(1000 / config.proximityRateHz);

  setInterval(() => {
    for (const room of roomManager.listRooms()) {
      if (room.players.size === 0) continue;
      const states = Array.from(room.players.values()).map(publicPlayer);
      io.to(room.slug).emit('players_update', states);
    }
  }, tickIntervalMs);

  setInterval(() => {
    for (const room of roomManager.listRooms()) {
      if (room.players.size === 0) continue;
      const players = Array.from(room.players.values());
      const proximity = computeProximity(
        players,
        config.proximityRadiusPx,
        room.interactiveObjects,
      );
      for (const player of players) {
        const nearby = proximity.get(player.playerId) ?? [];
        io.to(player.socketId).emit('proximity_update', { nearbyPlayerIds: nearby });
      }
    }
  }, proximityIntervalMs);

  // Sweep auto-inactive : toutes les 30 s, bascule available → inactive
  // pour tout joueur dont lastActivityAt > 5 min.
  const AUTO_INACTIVE_MS = 5 * 60 * 1000;
  setInterval(() => {
    for (const room of roomManager.listRooms()) {
      if (room.players.size === 0) continue;
      const changedIds = roomManager.sweepInactive(room.slug, AUTO_INACTIVE_MS);
      for (const pid of changedIds) {
        const player = room.players.get(pid);
        if (!player) continue;
        io.to(room.slug).emit('player_update', publicPlayer(player));
      }
    }
  }, 30_000);

  // F11 — kart idle return sweep (30 s). Repositionne au parking les karts libres
  // et immobiles depuis > 5 min, broadcast l'état pour chacun.
  setInterval(() => {
    for (const room of roomManager.listRooms()) {
      const moved = room.kartManager.sweepIdle();
      if (moved.length === 0) continue;
      for (const id of moved) {
        const k = room.kartManager.getState(id);
        if (!k) continue;
        room.karts.set(id, k);
        io.to(room.slug).emit('kart:state', { ...k });
      }
    }
  }, 30_000);

  // TTL messages : purge chat + DM plus vieux que config.messageTtlMs (toutes les 30 min).
  roomManager.pruneOldMessages(config.messageTtlMs);
  setInterval(() => {
    roomManager.pruneOldMessages(config.messageTtlMs);
  }, 30 * 60 * 1000);

  // Filet de sécurité : purge les sessions orphelines dont le socket n'existe
  // plus (si un 'disconnect' a été manqué). Évite une fuite mémoire très lente
  // de la Map `sessions` sur des semaines d'uptime.
  setInterval(() => {
    for (const socketId of sessions.keys()) {
      if (!io.sockets.sockets.get(socketId)) sessions.delete(socketId);
    }
  }, 5 * 60 * 1000);

  // Doublures : TTL de sécurité — retire celles actives depuis > 60 min, pour
  // éviter les doublures orphelines si le joueur ne revient jamais.
  const UNDERSTUDY_TTL_MS = 60 * 60 * 1000;
  setInterval(() => {
    const now = Date.now();
    for (const room of roomManager.listRooms()) {
      for (const a of [...room.agents.values()]) {
        if (a.kind === 'understudy' && now - a.createdAt > UNDERSTUDY_TTL_MS) {
          removeUnderstudy(room, room.slug, a.ownerPlayerId ?? '', io);
        }
      }
    }
  }, 60_000);
}
