// Pixel AABB of the conference room. Inside this zone everyone hears each other
// at full volume and stays mutually subscribed regardless of proximity (the
// server mirrors this constant in server/src/socket/proximity.ts).
export const CONFERENCE_ZONE = {
  minX: 32,
  minY: 736,
  maxX: 960,
  maxY: 1312,
} as const;

export function inConferenceZone(x: number, y: number): boolean {
  return (
    x >= CONFERENCE_ZONE.minX &&
    x <= CONFERENCE_ZONE.maxX &&
    y >= CONFERENCE_ZONE.minY &&
    y <= CONFERENCE_ZONE.maxY
  );
}
