import { describe, it, expect } from 'vitest';
import { workstationIdForPoint, WORKSTATIONS } from './workstations.js';

describe('workstationIdForPoint — WORKSTATIONS vide', () => {
  it('retourne null pour n\'importe quel point quand le tableau est vide', () => {
    // Quand WORKSTATIONS = [] (placeholder), aucun point ne matche.
    if (WORKSTATIONS.length === 0) {
      expect(workstationIdForPoint(0, 0)).toBeNull();
      expect(workstationIdForPoint(99999, 99999)).toBeNull();
    }
  });
});

// Ces tests utilisent des postes de test injectés directement via la fonction interne.
// On importe aussi la fonction pure pour la tester isolément.
import { workstationIdForPointIn } from './workstations.js';
import type { Workstation } from './workstations.js';

const TEST_WS: readonly Workstation[] = [
  { id: 'poste-1', name: 'Poste 1', minX: 100, minY: 100, maxX: 200, maxY: 200 },
  { id: 'poste-2', name: 'Poste 2', minX: 300, minY: 100, maxX: 400, maxY: 200 },
];

describe('workstationIdForPointIn', () => {
  it('retourne l\'id si le point est dans la zone (centré)', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 150)).toBe('poste-1');
  });

  it('retourne l\'id pour poste-2', () => {
    expect(workstationIdForPointIn(TEST_WS, 350, 150)).toBe('poste-2');
  });

  it('retourne null si le point est hors de toute zone', () => {
    expect(workstationIdForPointIn(TEST_WS, 250, 150)).toBeNull();
  });

  it('frontière inclusive minX', () => {
    expect(workstationIdForPointIn(TEST_WS, 100, 150)).toBe('poste-1');
  });

  it('frontière inclusive maxX', () => {
    expect(workstationIdForPointIn(TEST_WS, 200, 150)).toBe('poste-1');
  });

  it('frontière inclusive minY', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 100)).toBe('poste-1');
  });

  it('frontière inclusive maxY', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 200)).toBe('poste-1');
  });

  it('un pixel hors minX → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 99, 150)).toBeNull();
  });

  it('un pixel hors maxX → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 201, 150)).toBeNull();
  });

  it('un pixel hors minY → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 99)).toBeNull();
  });

  it('un pixel hors maxY → null', () => {
    expect(workstationIdForPointIn(TEST_WS, 150, 201)).toBeNull();
  });

  it('retourne null si tableau vide', () => {
    expect(workstationIdForPointIn([], 0, 0)).toBeNull();
  });
});
