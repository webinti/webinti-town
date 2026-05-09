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
