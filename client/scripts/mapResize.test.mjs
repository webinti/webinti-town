import { describe, it, expect } from 'vitest';
import { widenRow, widenData } from './mapResize.mjs';

describe('widenData', () => {
  it('élargit une grille 2x2 -> 4x2 en complétant de 0 à droite', () => {
    // data row-major [r0c0,r0c1, r1c0,r1c1]
    const out = widenData([1, 2, 3, 4], 2, 2, 4);
    expect(out).toEqual([1, 2, 0, 0, 3, 4, 0, 0]);
  });
  it('conserve la longueur newW*H', () => {
    expect(widenData([1, 2, 3, 4], 2, 2, 5).length).toBe(10);
  });
  it('widenRow complète une ligne', () => {
    expect(widenRow([7, 8], 4)).toEqual([7, 8, 0, 0]);
  });
});
