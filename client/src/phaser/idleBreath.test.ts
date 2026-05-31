import { describe, it, expect } from 'vitest';
import { breathScaleY } from './idleBreath';

describe('breathScaleY', () => {
  it('vaut 1 avant le délai (perso vient de s’arrêter)', () => {
    expect(breathScaleY(0)).toBe(1);
    expect(breathScaleY(399)).toBe(1);
  });
  it('vaut 1 pile au démarrage de la respiration (cos(0))', () => {
    // à idleMs = delay, t=0 -> 0.5-0.5*cos(0)=0 -> scale 1
    expect(breathScaleY(400)).toBeCloseTo(1, 5);
  });
  it('atteint ~1+amplitude à mi-période', () => {
    // t = period/2 -> cos(pi) = -1 -> 0.5-0.5*(-1)=1 -> scale 1+amp
    expect(breathScaleY(400 + 700)).toBeCloseTo(1.07, 3);
  });
  it('reste borné dans [1, 1+amplitude]', () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const s = breathScaleY(ms);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(1.07 + 1e-9);
    }
  });
});
