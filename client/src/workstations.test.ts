import { describe, it, expect } from 'vitest';
import { WORKSTATIONS } from './workstations';

describe('WORKSTATIONS', () => {
  it('contient les 12 postes open space + R&D + 3 rouges + salle conf', () => {
    for (let i = 1; i <= 12; i++) {
      expect(WORKSTATIONS.find((w) => w.id === `poste-${i}`)).toBeTruthy();
    }
    expect(WORKSTATIONS.find((w) => w.id === 'salle-conf')).toBeTruthy();
  });
  it('aucun id de poste dupliqué', () => {
    const ids = WORKSTATIONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('plus aucun poste POC limezu (intégrés à la grille)', () => {
    expect(WORKSTATIONS.find((w) => w.id.startsWith('poste-limezu'))).toBeFalsy();
  });
});
