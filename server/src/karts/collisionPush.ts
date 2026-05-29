import type { Direction } from '../types.js';

export interface AABB { x: number; y: number; halfW: number; halfH: number; }

export function aabbOverlap(a: AABB, b: AABB): boolean {
  return (
    Math.abs(a.x - b.x) < (a.halfW + b.halfW) &&
    Math.abs(a.y - b.y) < (a.halfH + b.halfH)
  );
}

const KNOCKBACK_PX = 24;

export function computeKnockback(dir: Direction): { dx: number; dy: number } {
  switch (dir) {
    case 'right': return { dx:  KNOCKBACK_PX, dy: 0 };
    case 'left':  return { dx: -KNOCKBACK_PX, dy: 0 };
    case 'up':    return { dx: 0, dy: -KNOCKBACK_PX };
    case 'down':  return { dx: 0, dy:  KNOCKBACK_PX };
  }
}
