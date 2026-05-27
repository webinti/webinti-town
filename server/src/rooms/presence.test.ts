import { describe, it, expect, beforeEach } from 'vitest';
import { RoomManager } from './RoomManager.js';
import { DEFAULT_APPEARANCE } from '../types.js';

const APP = DEFAULT_APPEARANCE;

function makeRoom(rm: RoomManager) {
  rm.createRoom('Test');
  // ensureRoom slug = slugify('Test') = 'test'
  const slug = 'test';
  return slug;
}

function addPlayer(rm: RoomManager, slug: string, name: string, socketId = 'sock1', clientKey?: string) {
  return rm.addPlayer(slug, socketId, name, APP, clientKey);
}

describe('RoomManager.addPlayer — presence init', () => {
  let rm: RoomManager;
  let slug: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
  });

  it('initialise presence à available', () => {
    const p = addPlayer(rm, slug, 'Alice');
    expect(p?.presence).toBe('available');
  });

  it('initialise lastActivityAt à un nombre proche de now', () => {
    const before = Date.now();
    const p = addPlayer(rm, slug, 'Bob');
    const after = Date.now();
    expect(p?.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(p?.lastActivityAt).toBeLessThanOrEqual(after);
  });
});

describe('RoomManager.setPresence', () => {
  let rm: RoomManager;
  let slug: string;
  let playerId: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
    const p = addPlayer(rm, slug, 'Alice', 'sock1', '11111111-1111-1111-1111-111111111111');
    playerId = p!.playerId;
  });

  it('met à jour presence pour son propre joueur', () => {
    const changed = rm.setPresence(slug, playerId, 'away');
    expect(changed).toBe(true);
    const room = rm.getRoom(slug)!;
    expect(room.players.get(playerId)?.presence).toBe('away');
  });

  it('retourne false si room inexistante', () => {
    expect(rm.setPresence('nope', playerId, 'dnd')).toBe(false);
  });

  it('retourne false si joueur inexistant', () => {
    expect(rm.setPresence(slug, 'ghost-id', 'brb')).toBe(false);
  });

  it('retourne false si presence invalide', () => {
    expect(rm.setPresence(slug, playerId, 'dancing' as never)).toBe(false);
  });
});

describe('RoomManager.markActivity', () => {
  let rm: RoomManager;
  let slug: string;
  let playerId: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
    const p = addPlayer(rm, slug, 'Alice', 'sock1', '22222222-2222-2222-2222-222222222222');
    playerId = p!.playerId;
  });

  it('bumpe lastActivityAt', async () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    const before = player.lastActivityAt;
    await new Promise((r) => setTimeout(r, 5));
    rm.markActivity(slug, playerId);
    expect(player.lastActivityAt).toBeGreaterThan(before);
  });

  it('repasse inactive → available et retourne true', () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.presence = 'inactive'; // simuler l'auto-inactive
    const changed = rm.markActivity(slug, playerId);
    expect(changed).toBe(true);
    expect(player.presence).toBe('available');
  });

  it('ne change PAS away/brb/dnd → ne retourne pas true pour un changement de statut', () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.presence = 'away';
    const changed = rm.markActivity(slug, playerId);
    // markActivity bumpe timestamp et retourne true seulement si presence a changé
    expect(changed).toBe(false);
    expect(player.presence).toBe('away');
  });

  it('retourne false si room ou joueur inexistant', () => {
    expect(rm.markActivity('nope', playerId)).toBe(false);
    expect(rm.markActivity(slug, 'ghost')).toBe(false);
  });
});

describe('RoomManager — auto-inactive sweep logic', () => {
  let rm: RoomManager;
  let slug: string;
  let playerId: string;

  beforeEach(() => {
    rm = new RoomManager();
    slug = makeRoom(rm);
    const p = addPlayer(rm, slug, 'Alice', 'sock1', '33333333-3333-3333-3333-333333333333');
    playerId = p!.playerId;
  });

  it('sweepInactive bascule available → inactive quand stale > seuil', () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.lastActivityAt = Date.now() - 6 * 60 * 1000; // 6 min stale
    const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
    expect(changed).toEqual([playerId]);
    expect(player.presence).toBe('inactive');
  });

  it("sweepInactive n'override PAS away/brb/dnd", () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.lastActivityAt = Date.now() - 10 * 60 * 1000; // très stale
    for (const p of ['away', 'brb', 'dnd'] as const) {
      player.presence = p;
      const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
      expect(changed).toEqual([]);
      expect(player.presence).toBe(p);
    }
  });

  it("sweepInactive ne bascule PAS un joueur déjà inactive", () => {
    const room = rm.getRoom(slug)!;
    const player = room.players.get(playerId)!;
    player.presence = 'inactive';
    player.lastActivityAt = Date.now() - 10 * 60 * 1000;
    const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
    expect(changed).toEqual([]);
  });

  it("sweepInactive ne bascule PAS un joueur available récent", () => {
    // lastActivityAt est tout proche (défaut)
    const changed = rm.sweepInactive(slug, 5 * 60 * 1000);
    expect(changed).toEqual([]);
  });
});
