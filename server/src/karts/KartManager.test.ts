import { describe, it, expect, beforeEach } from 'vitest';
import { KartManager } from './KartManager.js';
import type { KartDef } from '../karts.js';
import { MOUNT_DISTANCE } from '../karts.js';

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

describe('mount', () => {
  it('mount OK si kart libre et joueur ≤ MOUNT_DISTANCE', () => {
    const ok = m.mount('k1', 'alice', 100 + MOUNT_DISTANCE, 100);
    expect(ok).toBe(true);
    expect(m.getState('k1')!.driverId).toBe('alice');
  });

  it('mount échoue si trop loin', () => {
    const ok = m.mount('k1', 'alice', 100 + MOUNT_DISTANCE + 1, 100);
    expect(ok).toBe(false);
    expect(m.getState('k1')!.driverId).toBeNull();
  });

  it('mount échoue si kart déjà occupé', () => {
    m.mount('k1', 'alice', 100, 100);
    const ok = m.mount('k1', 'bob', 100, 100);
    expect(ok).toBe(false);
  });

  it('mount échoue sur id inconnu', () => {
    expect(m.mount('nope', 'alice', 100, 100)).toBe(false);
  });

  it('getKartByDriver retrouve le kart du conducteur', () => {
    m.mount('k1', 'alice', 100, 100);
    expect(m.getKartByDriver('alice')?.id).toBe('k1');
    expect(m.getKartByDriver('bob')).toBeUndefined();
  });
});
