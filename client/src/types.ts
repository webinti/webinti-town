export type Direction = 'up' | 'down' | 'left' | 'right';

// Couches d'avatar LimeZu (Modern Interiors). Les spritesheets sont générées
// par scripts/build-avatars.py — garder ces compteurs synchronisés avec lui.
export const SKIN_COUNT = 9;        // Bodies/32x32 (teints)
export const OUTFIT_COUNT = 12;     // tenues curatées
export const HAIR_STYLE_COUNT = 6;  // coiffures curatées
export const HAIR_COLOR_COUNT = 4;  // couleurs de cheveux
// Variante de la planche `hair` = hairStyle * HAIR_COLOR_COUNT + hairColor.

export interface Appearance {
  skin: number;       // 0..SKIN_COUNT-1
  outfit: number;     // 0..OUTFIT_COUNT-1
  hairStyle: number;  // 0..HAIR_STYLE_COUNT-1
  hairColor: number;  // 0..HAIR_COLOR_COUNT-1
}

export const DEFAULT_APPEARANCE: Appearance = {
  skin: 2,
  outfit: 0,
  hairStyle: 1,
  hairColor: 1,
};

export type Presence = 'available' | 'away' | 'brb' | 'dnd' | 'inactive';

export interface PlayerState {
  playerId: string;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost?: boolean;
  joinedAt?: number;
  presence?: Presence;   // optionnel pour la rétrocompatibilité
  workstationId?: string | null;    // calculé server-side
  kartId: string | null;           // id du kart conduit, null si piéton
  boosting: boolean;               // true pendant l'effet nitro
}

export interface KartState {
  id: string;          // 'kart-1' … 'kart-5'
  x: number;
  y: number;
  parkingX: number;
  parkingY: number;
  driverId: string | null;
  lastMovedAt: number; // epoch ms
}

export type ChatMessageType = 'local' | 'global' | 'system';

export type EmoteType = 'wave' | 'heart' | 'laugh' | 'thumbsup' | 'question' | 'exclaim';

export interface ChatAttachment {
  url: string;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/svg+xml' | 'application/pdf';
  sizeBytes: number;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  type: ChatMessageType;
  timestamp: number;
  attachment?: ChatAttachment;  // F9
}

// F10 — Direct Messages
export interface DmMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  attachment: ChatAttachment | null;
  ts: number;
  readBy: string[];
}

export interface WhiteboardStroke {
  id: string;
  playerId: string;
  color: string;
  size: number;
  points: Array<{ x: number; y: number }>;
  isErase: boolean;
}

export interface WhiteboardText {
  id: string;
  playerId: string;
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
}

export type KanbanColumn = 'todo' | 'doing' | 'done';

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorName: string;
  column: KanbanColumn;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  completedBy: string | null;
  completedByName: string | null;
}

export type InteractiveObject =
  | { id: string; type: 'screen'; x: number; y: number; data: { sharedByPlayerId?: string } }
  | { id: string; type: 'whiteboard'; x: number; y: number; data: { strokes: WhiteboardStroke[]; texts?: WhiteboardText[] } }
  | { id: string; type: 'note'; x: number; y: number; data: { title: string; content: string } }
  | { id: string; type: 'link'; x: number; y: number; data: { url: string; label: string } }
  | { id: string; type: 'kanban'; x: number; y: number; data: Record<string, never> };

export interface EmoteEvent {
  playerId: string;
  emoteType: EmoteType;
  timestamp: number;
}

export interface ConfettiEvent {
  playerId: string;
  timestamp: number;
}

export interface RoomState {
  playerId: string;
  roomSlug: string;
  roomName: string;
  players: PlayerState[];
  chatHistory?: ChatMessage[];
  interactiveObjects?: InteractiveObject[];
  hostPlayerId?: string | null;
  isRecording?: boolean;
}

export interface JoinRoomPayload {
  roomSlug: string;
  playerName: string;
  appearance: Appearance;
  hostToken?: string;
  // Stable per-browser identity (UUID) persisted in localStorage. Lets the
  // server preserve our playerId across reconnects so we keep ownership of
  // resources we authored (e.g. Kanban cards).
  clientKey?: string;
}

export interface PlayerMovePayload {
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
}

export interface WorkstationState {
  id: string;
  claimedBy: string | null;
  claimedByName: string | null;
  invitedPlayerIds: string[];
  claimedAt: number | null;
  customName: string | null;
}
