import { describe, it, expect, beforeEach } from 'vitest';
import { KartManager } from './KartManager.js';
import type { KartDef } from '../karts.js';

const KARTS: KartDef[] = [
  { id: 'k1', parkingX: 100, parkingY: 100 },
  { id: 'k2', parkingX: 140, parkingY: 100 },
];

let m: KartManager;
beforeEach(() => {
  m = new KartManager(KARTS, () => 1000);
});

describe('init', () => {
  it('crée un kart par def, position = parking, driver null', () => {
    const all = m.getAllStates();
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      id: 'k1', x: 100, y: 100, parkingX: 100, parkingY: 100, driverId: null, lastMovedAt: 1000,
    });
    expect(all[1].id).toBe('k2');
  });

  it('getState retourne undefined pour un id inconnu', () => {
    expect(m.getState('nope')).toBeUndefined();
  });
});
