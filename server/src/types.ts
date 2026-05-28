export type Direction = 'up' | 'down' | 'left' | 'right';

export type ChatMessageType = 'local' | 'global' | 'system';

export type EmoteType = 'wave' | 'heart' | 'laugh' | 'thumbsup' | 'question' | 'exclaim';

export interface Appearance {
  skin: 0 | 1 | 2;
  hairStyle: 0 | 1 | 2 | 3 | 4 | 5;
  hairColor: 0 | 1 | 2 | 3 | 4 | 5;
  shirt: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  pants: 0 | 1 | 2 | 3 | 4 | 5;
}

export const DEFAULT_APPEARANCE: Appearance = {
  skin: 0,
  hairStyle: 1,
  hairColor: 0,
  shirt: 5,
  pants: 0,
};

export type Presence = 'available' | 'away' | 'brb' | 'dnd' | 'inactive';

export interface PlayerState {
  playerId: string;
  socketId: string;
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost: boolean;
  joinedAt: number;
  presence: Presence;
  lastActivityAt: number;   // serveur seulement — jamais diffusé au client
  workstationId: string | null;     // calculé server-side depuis x/y ; null si hors zone
}

export interface ChatAttachment {
  url: string;       // /api/uploads/<roomSlug>/<uuid>.<ext>
  filename: string;  // sanitized original (max 80 chars)
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
  attachment?: ChatAttachment;  // F9 — pièce jointe optionnelle
}

// F10 — Direct Messages
export interface DmMessage {
  id: string;
  from: string;          // playerId expéditeur
  to: string;            // playerId destinataire
  text: string;          // 0..1000 chars (peut être vide si attachment présent)
  attachment: ChatAttachment | null;
  ts: number;
  readBy: string[];      // playerIds qui ont lu — au moins from à la création
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

export interface KanbanBoard {
  cards: KanbanCard[];
}

export interface WorkstationState {
  id: string;                       // matches Workstation.id
  claimedBy: string | null;         // playerId du revendicateur, ou null
  claimedByName: string | null;     // snapshot pour l'affichage
  invitedPlayerIds: string[];       // les invités autorisés à entrer
  claimedAt: number | null;         // pour debug / audit
  customName: string | null;        // nom personnalisé défini par le claimer (max 40 chars)
}

export type InteractiveObject =
  | { id: string; type: 'screen'; x: number; y: number; data: { sharedByPlayerId?: string } }
  | { id: string; type: 'whiteboard'; x: number; y: number; data: { strokes: WhiteboardStroke[]; texts?: WhiteboardText[] } }
  | { id: string; type: 'note'; x: number; y: number; data: { title: string; content: string } }
  | { id: string; type: 'link'; x: number; y: number; data: { url: string; label: string } }
  | { id: string; type: 'kanban'; x: number; y: number; data: Record<string, never> };

export interface RoomState {
  slug: string;
  name: string;
  adminToken: string;
  players: Map<string, PlayerState>;
  createdAt: number;
  chatHistory: ChatMessage[];
  interactiveObjects: InteractiveObject[];
  // Cards are owned by an in-memory store + JSON file per room — not embedded
  // in the InteractiveObject's `data` field. See server/src/kanban/KanbanStore.
  kanbanStore:
    | import('./kanban/KanbanStore.js').KanbanStore
    | import('./kanban/KanbanStorePocketBase.js').KanbanStorePocketBase;
  hostPlayerId: string | null;
  isRecording: boolean;
  workstations: Map<string, WorkstationState>;  // key = workstation.id
  workstationManager: import('./workstations/WorkstationManager.js').WorkstationManager;
  dmStore: import('./dm/DmStore.js').DmStore;
}

export interface PublicRoomInfo {
  slug: string;
  name: string;
  playerCount: number;
}
