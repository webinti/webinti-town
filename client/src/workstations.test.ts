import { describe, it, expect } from 'vitest';
import { WORKSTATIONS } from './workstations';

describe('WORKSTATIONS — pods LimeZu', () => {
  it('contient les 2 pods LimeZu avec leurs zones', () => {
    const p1 = WORKSTATIONS.find((w) => w.id === 'poste-limezu-1');
    const p2 = WORKSTATIONS.find((w) => w.id === 'poste-limezu-2');
    expect(p1).toEqual({ id: 'poste-limezu-1', name: 'Bureau LimeZu 1', minX: 928, minY: 512, maxX: 1024, maxY: 608 });
    expect(p2).toEqual({ id: 'poste-limezu-2', name: 'Bureau LimeZu 2', minX: 1088, minY: 512, maxX: 1184, maxY: 608 });
  });
  it('aucun id de poste dupliqué', () => {
    const ids = WORKSTATIONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
