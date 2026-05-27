import { describe, it, expect, beforeEach } from 'vitest';
import { WorkstationManager } from './WorkstationManager.js';
import type { Workstation } from '../workstations.js';

// Postes de test
const WS: Workstation[] = [
  { id: 'p1', name: 'Poste 1', minX: 100, minY: 100, maxX: 200, maxY: 200 },
  { id: 'p2', name: 'Poste 2', minX: 300, minY: 100, maxX: 400, maxY: 200 },
];

// Joueurs fictifs
const ALICE   = { id: 'alice',   name: 'Alice' };
const BOB     = { id: 'bob',     name: 'Bob' };
const CHARLIE = { id: 'charlie', name: 'Charlie' };

// Coordonnées dans p1 et hors zone
const IN_P1  = { x: 150, y: 150 };
const IN_P2  = { x: 350, y: 150 };
const OUT    = { x: 250, y: 150 };

let m: WorkstationManager;
beforeEach(() => {
  m = new WorkstationManager(WS);
});

// --- claim ---

describe('claim', () => {
  it('claim OK : poste libre + joueur dans la zone', () => {
    const ok = m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(ok).toBe(true);
    const ws = m.getState('p1')!;
    expect(ws.claimedBy).toBe(ALICE.id);
    expect(ws.claimedByName).toBe(ALICE.name);
    expect(ws.claimedAt).not.toBeNull();
  });

  it('claim échoue : poste déjà claimé', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.claim('p1', BOB.id, BOB.name, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('claim échoue : joueur pas dans la zone', () => {
    expect(m.claim('p1', ALICE.id, ALICE.name, OUT.x, OUT.y)).toBe(false);
  });

  it('claim échoue : workstationId inconnu', () => {
    expect(m.claim('nope', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y)).toBe(false);
  });
});

// --- release ---

describe('release', () => {
  beforeEach(() => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
  });

  it('release OK par le claimer', () => {
    expect(m.release('p1', ALICE.id)).toBe(true);
    const ws = m.getState('p1')!;
    expect(ws.claimedBy).toBeNull();
    expect(ws.invitedPlayerIds).toHaveLength(0);
    expect(ws.claimedAt).toBeNull();
  });

  it('release efface aussi les invités', () => {
    m.release('p1', ALICE.id);
    expect(m.getState('p1')!.invitedPlayerIds).toHaveLength(0);
  });

  it('release échoue par un non-claimer', () => {
    expect(m.release('p1', BOB.id)).toBe(false);
    expect(m.getState('p1')!.claimedBy).toBe(ALICE.id);
  });

  it('release échoue si poste déjà libre', () => {
    m.release('p1', ALICE.id);
    expect(m.release('p1', ALICE.id)).toBe(false);
  });
});

// --- invite ---

describe('invite', () => {
  beforeEach(() => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
  });

  it('invite OK par le claimer', () => {
    expect(m.invite('p1', ALICE.id, BOB.id)).toBe(true);
    expect(m.getState('p1')!.invitedPlayerIds).toContain(BOB.id);
  });

  it('invite échoue par un non-claimer', () => {
    expect(m.invite('p1', BOB.id, CHARLIE.id)).toBe(false);
  });

  it('invite est idempotent (déjà invité → false)', () => {
    m.invite('p1', ALICE.id, BOB.id);
    expect(m.invite('p1', ALICE.id, BOB.id)).toBe(false);
  });

  it('invite échoue si poste libre', () => {
    m.release('p1', ALICE.id);
    expect(m.invite('p1', ALICE.id, BOB.id)).toBe(false);
  });

  it('invite échoue sur workstationId inconnu', () => {
    expect(m.invite('nope', ALICE.id, BOB.id)).toBe(false);
  });
});

// --- uninvite ---

describe('uninvite', () => {
  beforeEach(() => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
  });

  it('uninvite OK par le claimer', () => {
    expect(m.uninvite('p1', ALICE.id, BOB.id)).toBe(true);
    expect(m.getState('p1')!.invitedPlayerIds).not.toContain(BOB.id);
  });

  it('uninvite échoue par un non-claimer', () => {
    expect(m.uninvite('p1', BOB.id, BOB.id)).toBe(false);
    expect(m.getState('p1')!.invitedPlayerIds).toContain(BOB.id);
  });

  it('uninvite échoue si target pas dans la liste', () => {
    expect(m.uninvite('p1', ALICE.id, CHARLIE.id)).toBe(false);
  });
});

// --- canEnter ---

describe('canEnter', () => {
  it('poste libre → toujours true', () => {
    expect(m.canEnter('p1', CHARLIE.id)).toBe(true);
  });

  it('poste claimé par alice → alice peut entrer', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.canEnter('p1', ALICE.id)).toBe(true);
  });

  it('poste claimé par alice → invité (bob) peut entrer', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
    expect(m.canEnter('p1', BOB.id)).toBe(true);
  });

  it('poste claimé par alice → charlie (non invité) ne peut pas entrer', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.canEnter('p1', CHARLIE.id)).toBe(false);
  });

  it('workstationId inconnu → true (pas de restriction)', () => {
    expect(m.canEnter('nope', CHARLIE.id)).toBe(true);
  });
});

// --- isInsideAnyLockedWorkstation ---

describe('isInsideAnyLockedWorkstation', () => {
  it('aucun poste claimé → false pour n\'importe qui', () => {
    expect(m.isInsideAnyLockedWorkstation(BOB.id, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('poste claimé : non-autorisé à l\'intérieur → true (bloqué)', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.isInsideAnyLockedWorkstation(BOB.id, IN_P1.x, IN_P1.y)).toBe(true);
  });

  it('poste claimé : claimer à l\'intérieur → false (autorisé)', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.isInsideAnyLockedWorkstation(ALICE.id, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('poste claimé : invité à l\'intérieur → false (autorisé)', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    m.invite('p1', ALICE.id, BOB.id);
    expect(m.isInsideAnyLockedWorkstation(BOB.id, IN_P1.x, IN_P1.y)).toBe(false);
  });

  it('coordonnées hors de toute zone → false', () => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
    expect(m.isInsideAnyLockedWorkstation(BOB.id, OUT.x, OUT.y)).toBe(false);
  });
});

// --- getAllStates ---

describe('getAllStates', () => {
  it('retourne un WorkstationState par entrée de WORKSTATIONS', () => {
    const states = m.getAllStates();
    expect(states).toHaveLength(WS.length);
    expect(states.every((s) => s.claimedBy === null)).toBe(true);
  });
});

// --- setCustomName ---

describe('setCustomName', () => {
  beforeEach(() => {
    m.claim('p1', ALICE.id, ALICE.name, IN_P1.x, IN_P1.y);
  });

  it('le claimer peut définir un nom personnalisé', () => {
    expect(m.setCustomName(ALICE.id, 'p1', 'Mon Super Poste')).toBe(true);
    expect(m.getState('p1')!.customName).toBe('Mon Super Poste');
  });

  it('un non-claimer ne peut pas renommer', () => {
    expect(m.setCustomName(BOB.id, 'p1', 'Nom Bob')).toBe(false);
    expect(m.getState('p1')!.customName).toBeNull();
  });

  it('un nom vide ou whitespace-only est rejeté', () => {
    expect(m.setCustomName(ALICE.id, 'p1', '')).toBe(false);
    expect(m.setCustomName(ALICE.id, 'p1', '   ')).toBe(false);
    expect(m.getState('p1')!.customName).toBeNull();
  });

  it('null efface le nom personnalisé', () => {
    m.setCustomName(ALICE.id, 'p1', 'Ancien nom');
    expect(m.setCustomName(ALICE.id, 'p1', null)).toBe(true);
    expect(m.getState('p1')!.customName).toBeNull();
  });

  it('un nom de plus de 40 chars est tronqué à 40', () => {
    const long = 'a'.repeat(50);
    expect(m.setCustomName(ALICE.id, 'p1', long)).toBe(true);
    expect(m.getState('p1')!.customName).toBe('a'.repeat(40));
  });

  it('customName est remis à null lors du release', () => {
    m.setCustomName(ALICE.id, 'p1', 'Nom test');
    m.release('p1', ALICE.id);
    expect(m.getState('p1')!.customName).toBeNull();
  });
});
