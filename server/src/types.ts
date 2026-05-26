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
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  type: ChatMessageType;
  timestamp: number;
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
  hostPlayerId: string | null;
  isRecording: boolean;
}

export interface PublicRoomInfo {
  slug: string;
  name: string;
  playerCount: number;
}
