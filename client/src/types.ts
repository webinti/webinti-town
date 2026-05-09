export type Direction = 'up' | 'down' | 'left' | 'right';

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
  name: string;
  appearance: Appearance;
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
  isGhost?: boolean;
  joinedAt?: number;
}

export interface RoomState {
  playerId: string;
  roomSlug: string;
  roomName: string;
  players: PlayerState[];
}

export interface JoinRoomPayload {
  roomSlug: string;
  playerName: string;
  appearance: Appearance;
}

export interface PlayerMovePayload {
  x: number;
  y: number;
  direction: Direction;
  isMoving: boolean;
}
