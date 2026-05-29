import { describe, it, expect } from 'vitest';
import { computeKnockback, aabbOverlap } from './collisionPush.js';
import { KART_HALF_W, KART_HALF_H, PLAYER_HALF } from '../karts.js';

describe('aabbOverlap (kart vs player)', () => {
  it('overlap quand les rectangles se chevauchent', () => {
    expect(aabbOverlap(
      { x: 100, y: 100, halfW: KART_HALF_W, halfH: KART_HALF_H },
      { x: 110, y: 100, halfW: PLAYER_HALF, halfH: PLAYER_HALF },
    )).toBe(true);
  });

  it("pas d'overlap quand séparés", () => {
    expect(aabbOverlap(
      { x: 0, y: 0, halfW: KART_HALF_W, halfH: KART_HALF_H },
      { x: 100, y: 0, halfW: PLAYER_HALF, halfH: PLAYER_HALF },
    )).toBe(false);
  });

  it("pas d'overlap quand pile au bord (touche, pas chevauche)", () => {
    expect(aabbOverlap(
      { x: 0, y: 0, halfW: KART_HALF_W, halfH: KART_HALF_H },
      { x: 26, y: 0, halfW: PLAYER_HALF, halfH: PLAYER_HALF },
    )).toBe(false);
  });
});

describe('computeKnockback', () => {
  it('direction right → dx +24, dy 0', () => {
    expect(computeKnockback('right')).toEqual({ dx: 24, dy: 0 });
  });
  it('direction left → dx -24, dy 0', () => {
    expect(computeKnockback('left')).toEqual({ dx: -24, dy: 0 });
  });
  it('direction up → dy -24', () => {
    expect(computeKnockback('up')).toEqual({ dx: 0, dy: -24 });
  });
  it('direction down → dy 24', () => {
    expect(computeKnockback('down')).toEqual({ dx: 0, dy: 24 });
  });
});
