import { describe, it, expect } from 'vitest';
import { localId, podTiles, floorPatch, deskCollisionRect, nextFirstgid } from './officePoc.mjs';

describe('localId', () => {
  it('convertit (col,row) en index local (16 colonnes)', () => {
    expect(localId(0, 0)).toBe(0);
    expect(localId(7, 29)).toBe(471);
    expect(localId(10, 5)).toBe(90);
  });
});

describe('nextFirstgid', () => {
  it('renvoie firstgid + tilecount du dernier tileset', () => {
    expect(nextFirstgid([{ firstgid: 1, tilecount: 256 }])).toBe(257);
    expect(nextFirstgid([
      { firstgid: 1, tilecount: 256 },
      { firstgid: 257, tilecount: 224 },
    ])).toBe(481);
  });
});

describe('podTiles', () => {
  const OFFICE = 481;
  it('place écran/bureau/chaise/plante aux bons (col,row) avec les bons gid', () => {
    const tiles = podTiles(29, 14, OFFICE);
    // écran (14,12) à (30,14) : gid 481+206
    expect(tiles).toContainEqual({ col: 30, row: 14, gid: 687 });
    // bureau (7,29)(8,29)(9,29) à (29,15)(30,15)(31,15)
    expect(tiles).toContainEqual({ col: 29, row: 15, gid: 952 });
    expect(tiles).toContainEqual({ col: 30, row: 15, gid: 953 });
    expect(tiles).toContainEqual({ col: 31, row: 15, gid: 954 });
    // chaise (0,9) à (30,16) : gid 481+144
    expect(tiles).toContainEqual({ col: 30, row: 16, gid: 625 });
    // plante (6,10)/(6,11) à (32,14)/(32,15) : gid 481+166 / 481+182
    expect(tiles).toContainEqual({ col: 32, row: 14, gid: 647 });
    expect(tiles).toContainEqual({ col: 32, row: 15, gid: 663 });
  });
  it('ne superpose aucune tuile (couples col,row uniques)', () => {
    const tiles = podTiles(29, 14, OFFICE);
    const keys = tiles.map((t) => `${t.col},${t.row}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('floorPatch', () => {
  it('remplit un rectangle 6x5 autour de l’origine avec le gid de sol', () => {
    const tiles = floorPatch(29, 14, 257); // room_builder firstgid 257, sol localId 90
    expect(tiles.length).toBe(6 * 5);
    expect(tiles).toContainEqual({ col: 28, row: 13, gid: 347 });
    expect(tiles).toContainEqual({ col: 33, row: 17, gid: 347 });
  });
});

describe('deskCollisionRect', () => {
  it('couvre les 3 tuiles du plateau (96x32) à la ligne or+1', () => {
    expect(deskCollisionRect(29, 14)).toEqual({ x: 29 * 32, y: 15 * 32, width: 96, height: 32 });
  });
});
