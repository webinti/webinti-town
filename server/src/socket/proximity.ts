import type { PlayerState } from '../types.js';

export function computeProximity(
  players: PlayerState[],
  radiusPx: number,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const radiusSq = radiusPx * radiusPx;
  for (const a of players) {
    const nearby: string[] = [];
    for (const b of players) {
      if (a.playerId === b.playerId) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy <= radiusSq) {
        nearby.push(b.playerId);
      }
    }
    result.set(a.playerId, nearby);
  }
  return result;
}
