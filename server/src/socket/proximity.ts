import type { InteractiveObject, PlayerState } from '../types.js';
import { isInConferenceZone } from '../conferenceZone.js';
import { inCircuitZone } from '../circuit.js';

// Zones « micro ouvert » : tous les joueurs présents dans une même zone
// s'entendent mutuellement quelle que soit la distance (la salle de conférence,
// et toute la zone du circuit kart — on se parle d'un bout à l'autre de la piste).
const OPEN_MIC_ZONES: ReadonlyArray<(x: number, y: number) => boolean> = [
  isInConferenceZone,
  inCircuitZone,
];

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

  // Open-mic zones (conference room, circuit kart) : every pair of players both
  // inside the same zone is mutually "near" regardless of distance, so their
  // tracks stay subscribed.
  for (const inZone of OPEN_MIC_ZONES) {
    const zonePlayers = players.filter((p) => inZone(p.x, p.y));
    for (const a of zonePlayers) {
      const list = result.get(a.playerId);
      if (!list) continue;
      for (const b of zonePlayers) {
        if (a.playerId === b.playerId) continue;
        if (!list.includes(b.playerId)) list.push(b.playerId);
      }
    }
  }

  return result;
}
