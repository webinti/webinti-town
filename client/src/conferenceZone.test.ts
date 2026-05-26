import { describe, it, expect } from 'vitest';
import { CONFERENCE_ZONE, isInConferenceZone } from './conferenceZone';

describe('isInConferenceZone', () => {
  it('exposes the spec rectangle', () => {
    expect(CONFERENCE_ZONE).toEqual({ minX: 32, minY: 736, maxX: 960, maxY: 1312 });
  });

  it('returns true for a point inside', () => {
    expect(isInConferenceZone(500, 1000)).toBe(true);
  });

  it('is inclusive on the boundary corners', () => {
    expect(isInConferenceZone(32, 736)).toBe(true);
    expect(isInConferenceZone(960, 1312)).toBe(true);
  });

  it('returns false outside the rectangle', () => {
    expect(isInConferenceZone(31, 1000)).toBe(false);
    expect(isInConferenceZone(500, 735)).toBe(false);
    expect(isInConferenceZone(961, 1000)).toBe(false);
    expect(isInConferenceZone(500, 1313)).toBe(false);
  });
});
