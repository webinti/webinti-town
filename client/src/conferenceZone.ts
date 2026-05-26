// Conference room: everyone inside this rectangle hears everyone else at full
// volume regardless of distance (proximity attenuation is suspended inside).
// Pixel coords, inclusive. Tiles 1..29 horizontally, 23..40 vertically (32px tiles).
export const CONFERENCE_ZONE = {
  minX: 32,
  minY: 736,
  maxX: 960,
  maxY: 1312,
} as const;

export function isInConferenceZone(x: number, y: number): boolean {
  return (
    x >= CONFERENCE_ZONE.minX &&
    x <= CONFERENCE_ZONE.maxX &&
    y >= CONFERENCE_ZONE.minY &&
    y <= CONFERENCE_ZONE.maxY
  );
}
