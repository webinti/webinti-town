import { describe, it, expect } from 'vitest';
import { localId, podTiles, floorPatch, nextFirstgid } from './officePoc.mjs';

describe('localId', () => {
  it('convertit (col,row) en index local (16 colonnes)', () => {
    expect(localId(0, 0)).toBe(0);
    expect(localId(4, 17)).toBe(276);
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
  const FG = { office: 481 };
  it('place écran/bureau/chaise/plante aux bons (col,row) avec les bons gid', () => {
    const tiles = podTiles(29, 14, FG.office);
    // écran à (29,14) gid 481+141
    expect(tiles).toContainEqual({ col: 29, row: 14, gid: 622 });
    // bureau arrière gauche (29,15) gid 481+276
    expect(tiles).toContainEqual({ col: 29, row: 15, gid: 757 });
    // bureau arrière droit (30,15) gid 481+277
    expect(tiles).toContainEqual({ col: 30, row: 15, gid: 758 });
    // bureau avant gauche (29,16) gid 481+292
    expect(tiles).toContainEqual({ col: 29, row: 16, gid: 773 });
    // bureau avant droit (30,16) gid 481+293
    expect(tiles).toContainEqual({ col: 30, row: 16, gid: 774 });
    // chaise (29,17) gid 481+128
    expect(tiles).toContainEqual({ col: 29, row: 17, gid: 609 });
    // plante haut (31,15) gid 481+117 ; bas (31,16) gid 481+133
    expect(tiles).toContainEqual({ col: 31, row: 15, gid: 598 });
    expect(tiles).toContainEqual({ col: 31, row: 16, gid: 614 });
  });
  it('ne superpose aucune tuile (couples col,row uniques)', () => {
    const tiles = podTiles(29, 14, FG.office);
    const keys = tiles.map((t) => `${t.col},${t.row}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('floorPatch', () => {
  it('remplit un rectangle 5x6 autour de l’origine avec le gid de sol', () => {
    const tiles = floorPatch(29, 14, 257); // room_builder firstgid 257, sol localId 90
    expect(tiles.length).toBe(5 * 6);
    expect(tiles).toContainEqual({ col: 28, row: 13, gid: 347 });
    expect(tiles).toContainEqual({ col: 32, row: 18, gid: 347 });
  });
});
