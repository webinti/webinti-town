export type Direction = 'up' | 'down' | 'left' | 'right';

export type ChatMessageType = 'local' | 'global' | 'system';

export type EmoteType = 'wave' | 'heart' | 'laugh' | 'thumbsup' | 'question' | 'exclaim';

export interface PlayerState {
  playerId: string;
  socketId: string;
  name: string;
  avatarIndex: number;
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

export interface RoomState {
  slug: string;
  name: string;
  adminToken: string;
  players: Map<string, PlayerState>;
  createdAt: number;
}

export interface PublicRoomInfo {
  slug: string;
  name: string;
  playerCount: number;
}
