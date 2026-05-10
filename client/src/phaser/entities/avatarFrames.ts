import type { Direction } from '../../types';

// Sheet layout for animated layers (body / pants / shirt):
//   rows  = categoryIdx * 4 (directions) + dirIdx
//   cols  = FRAMES_PER_DIR (idle, walkA, walkB)
//   frame = (categoryIdx * 4 + dirIdx) * FRAMES_PER_DIR + walkPhase
//
// Phase 0 = idle, 1 = walkA, 2 = walkB.
// While moving, walkPhase cycles through WALK_SEQUENCE at WALK_FPS.
// While idle, walkPhase is held at 0.

export const FRAMES_PER_DIR = 3;
export const WALK_SEQUENCE: ReadonlyArray<number> = [1, 0, 2, 0];
export const WALK_FPS = 6;
export const WALK_FRAME_MS = 1000 / WALK_FPS;

const DIR_INDEX: Record<Direction, number> = {
  down: 0,
  left: 1,
  right: 2,
  up: 3,
};

export function directionIndex(dir: Direction): number {
  return DIR_INDEX[dir];
}

export function animatedFrame(
  categoryIdx: number,
  dir: Direction,
  isMoving: boolean,
  walkTick: number,
): number {
  const phase = isMoving
    ? (WALK_SEQUENCE[walkTick % WALK_SEQUENCE.length] ?? 0)
    : 0;
  return (categoryIdx * 4 + DIR_INDEX[dir]) * FRAMES_PER_DIR + phase;
}

// Advance walk tick by elapsed ms. Returns new tick + remainder accumulator.
export function advanceWalkTick(
  walkTick: number,
  accumMs: number,
  deltaMs: number,
  isMoving: boolean,
): { walkTick: number; accumMs: number } {
  if (!isMoving) {
    return { walkTick: 0, accumMs: 0 };
  }
  let acc = accumMs + deltaMs;
  let tick = walkTick;
  while (acc >= WALK_FRAME_MS) {
    acc -= WALK_FRAME_MS;
    tick = (tick + 1) % WALK_SEQUENCE.length;
  }
  return { walkTick: tick, accumMs: acc };
}
