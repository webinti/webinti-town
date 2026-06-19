import { describe, it, expect } from 'vitest';
import { config } from '../config.js';

/**
 * Détection « room de démonstration » — DOIT rester strictement identique à la
 * regex utilisée dans RoomManager.buildRoomState (slug 'demo' ou 'demo-<...>').
 */
const isDemo = (slug: string): boolean => /^demo(-[a-z0-9-]*)?$/.test(slug);

describe('plafonnement de capacité — mapping des plans', () => {
  it('mappe chaque plan vers sa capacité', () => {
    expect(config.planCapacity.free).toBe(3);
    expect(config.planCapacity.demarrage).toBe(10);
    expect(config.planCapacity.equipe).toBe(25);
    expect(config.planCapacity.entreprise).toBe(100);
  });
});

describe('détection isDemo (regex slug)', () => {
  it("'demo' est une room de démo", () => {
    expect(isDemo('demo')).toBe(true);
  });
  it("'demo-acme' est une room de démo", () => {
    expect(isDemo('demo-acme')).toBe(true);
  });
  it("'equipe' n'est PAS une room de démo", () => {
    expect(isDemo('equipe')).toBe(false);
  });
  it("'mon-equipe' n'est PAS une room de démo", () => {
    expect(isDemo('mon-equipe')).toBe(false);
  });
});
