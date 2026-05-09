export type Direction = 'up' | 'down' | 'left' | 'right';

export interface PlayerState {
  id: string;
  name: string;
  avatar: number;
  x: number;
  y: number;
  direction: Direction;
  moving: boolean;
}

export interface RoomState {
  slug: string;
  players: PlayerState[];
  selfId: string;
}

export interface JoinRoomPayload {
  slug: string;
  name: string;
  avatar: number;
}

export interface PlayerMovePayload {
  x: number;
  y: number;
  direction: Direction;
  moving: boolean;
}
