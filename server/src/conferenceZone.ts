// Mirror of client/src/conferenceZone.ts. No shared package exists, so this
// constant is intentionally duplicated; keep both copies identical.
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
