import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  parsePlanIntent,
  parsePlanFromSearch,
  readPlanIntent,
  clearPlanIntent,
} from './planIntent';

describe('parsePlanIntent', () => {
  it('accepte les trois plans payants', () => {
    expect(parsePlanIntent('starter')).toBe('starter');
    expect(parsePlanIntent('team')).toBe('team');
    expect(parsePlanIntent('enterprise')).toBe('enterprise');
  });

  it('rejette free, valeurs inconnues, casse et vide', () => {
    expect(parsePlanIntent('free')).toBeNull();
    expect(parsePlanIntent('pro')).toBeNull();
    expect(parsePlanIntent('Starter')).toBeNull(); // sensible à la casse
    expect(parsePlanIntent('')).toBeNull();
    expect(parsePlanIntent(null)).toBeNull();
    expect(parsePlanIntent(undefined)).toBeNull();
  });
});

describe('parsePlanFromSearch', () => {
  it('lit le paramètre plan valide', () => {
    expect(parsePlanFromSearch('?plan=team')).toBe('team');
    expect(parsePlanFromSearch('plan=starter')).toBe('starter');
  });

  it('ignore un plan absent ou invalide', () => {
    expect(parsePlanFromSearch('')).toBeNull();
    expect(parsePlanFromSearch('?room=demo')).toBeNull();
    expect(parsePlanFromSearch('?plan=bogus')).toBeNull();
  });

  it('cohabite avec d’autres paramètres', () => {
    expect(parsePlanFromSearch('?room=demo&plan=enterprise')).toBe('enterprise');
  });
});

describe('readPlanIntent / clearPlanIntent (persistance)', () => {
  // localStorage n'existe pas en environnement node : on le stube en mémoire.
  const store = new Map<string, string>();
  const stub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };

  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = stub;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('relit un plan valide écrit en localStorage', () => {
    store.set('webinti-town:planIntent', 'team');
    expect(readPlanIntent()).toBe('team');
  });

  it('renvoie null pour une valeur persistée invalide', () => {
    store.set('webinti-town:planIntent', 'bogus');
    expect(readPlanIntent()).toBeNull();
  });

  it('clearPlanIntent efface l’intention', () => {
    store.set('webinti-town:planIntent', 'starter');
    clearPlanIntent();
    expect(readPlanIntent()).toBeNull();
  });

  it('renvoie null sans intention persistée', () => {
    expect(readPlanIntent()).toBeNull();
  });
});
