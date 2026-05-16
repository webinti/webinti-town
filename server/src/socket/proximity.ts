import type { InteractiveObject, PlayerState } from '../types.js';

// Pixel AABB of the conference room. Mirrored on the client in
// client/src/conferenceZone.ts.
const CONFERENCE_ZONE = { minX: 32, minY: 736, maxX: 960, maxY: 1312 } as const;

function inConferenceZone(p: PlayerState): boolean {
  return (
    p.x >= CONFERENCE_ZONE.minX &&
    p.x <= CONFERENCE_ZONE.maxX &&
    p.y >= CONFERENCE_ZONE.minY &&
    p.y <= CONFERENCE_ZONE.maxY
  );
}

export function computeProximity(
  players: PlayerState[],
  radiusPx: number,
  objects: InteractiveObject[] = [],
  screenRadiusPx = 16 * 32,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const radiusSq = radiusPx * radiusPx;
  const screenRadiusSq = screenRadiusPx * screenRadiusPx;

  // Base proximity: every pair within `radiusPx` (Euclidean) hears/sees each other.
  for (const a of players) {
    const nearby = new Set<string>();
    for (const b of players) {
      if (a.playerId === b.playerId) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy <= radiusSq) nearby.add(b.playerId);
    }
    result.set(a.playerId, Array.from(nearby));
  }

  // Extended-radius screen sharing: when a player A is sharing on a screen object S,
  // every player B within `screenRadiusPx` of S subscribes to A's tracks (and vice-versa
  // so the sharer receives audio/reactions back). This is the key Gather feature: the
  // audience for a presenter is defined by the screen, not by per-player proximity.
  const playersById = new Map<string, PlayerState>();
  for (const p of players) playersById.set(p.playerId, p);

  for (const obj of objects) {
    if (obj.type !== 'screen') continue;
    const sharerId = obj.data.sharedByPlayerId;
    if (!sharerId) continue;
    const sharer = playersById.get(sharerId);
    if (!sharer) continue;
    const observers: string[] = [];
    for (const p of players) {
      if (p.playerId === sharerId) continue;
      const dx = p.x - obj.x;
      const dy = p.y - obj.y;
      if (dx * dx + dy * dy <= screenRadiusSq) observers.push(p.playerId);
    }
    const sharerNearby = result.get(sharerId);
    if (sharerNearby) {
      const set = new Set(sharerNearby);
      for (const id of observers) set.add(id);
      result.set(sharerId, Array.from(set));
    }
    for (const obsId of observers) {
      const obsNearby = result.get(obsId);
      if (!obsNearby) continue;
      if (!obsNearby.includes(sharerId)) obsNearby.push(sharerId);
    }
  }

  // Conference room: any two players both inside the conference AABB stay
  // mutually subscribed and audible at full volume, so a meeting works even when
  // participants spread out beyond the normal proximity radius.
  const conferenceIds = players.filter(inConferenceZone).map((p) => p.playerId);
  for (const aId of conferenceIds) {
    const aNearby = result.get(aId);
    if (!aNearby) continue;
    const set = new Set(aNearby);
    for (const bId of conferenceIds) {
      if (aId === bId) continue;
      set.add(bId);
    }
    result.set(aId, Array.from(set));
  }

  return result;
}
