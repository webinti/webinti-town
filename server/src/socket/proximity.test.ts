import { describe, it, expect } from 'vitest';
import { computeProximity } from './proximity.js';
import type { PlayerState } from '../types.js';

function mk(id: string, x: number, y: number): PlayerState {
  return {
    playerId: id,
    name: id,
    appearance: { skin: 0, hairStyle: 0, hairColor: 0, shirt: 0, pants: 0 },
    x,
    y,
    direction: 'down',
    isMoving: false,
    socketId: `s-${id}`,
  } as PlayerState;
}

describe('computeProximity base behavior', () => {
  it('pairs players within radius', () => {
    const res = computeProximity([mk('a', 0, 0), mk('b', 10, 0)], 160);
    expect(res.get('a')).toEqual(['b']);
    expect(res.get('b')).toEqual(['a']);
  });

  it('does not pair players outside radius', () => {
    const res = computeProximity([mk('a', 0, 0), mk('b', 1000, 0)], 160);
    expect(res.get('a')).toEqual([]);
    expect(res.get('b')).toEqual([]);
  });
});

describe('computeProximity conference-zone override', () => {
  it('pairs two far-apart players when both are inside the conference zone', () => {
    const a = mk('a', 40, 740);
    const b = mk('b', 950, 1300);
    const res = computeProximity([a, b], 160);
    expect(res.get('a')).toEqual(['b']);
    expect(res.get('b')).toEqual(['a']);
  });

  it('does not pair when only one is inside the zone', () => {
    const a = mk('a', 500, 1000);
    const b = mk('b', 500, 100);
    const res = computeProximity([a, b], 160);
    expect(res.get('a')).toEqual([]);
    expect(res.get('b')).toEqual([]);
  });

  it('does not duplicate an already-near player', () => {
    const a = mk('a', 100, 800);
    const b = mk('b', 110, 800);
    const res = computeProximity([a, b], 160);
    expect(res.get('a')).toEqual(['b']);
    expect(res.get('b')).toEqual(['a']);
  });
});
