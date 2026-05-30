import { describe, it, expect } from 'vitest';
import { mergeCollisionRects } from './collisionRects.mjs';

// grid: tableau plat de booléens (length = w*h), true = cellule solide.
const T = 32;

describe('mergeCollisionRects', () => {
  it('grille vide -> aucun rectangle', () => {
    expect(mergeCollisionRects([false, false, false, false], 2, 2, T)).toEqual([]);
  });

  it('cellule isolée -> 1 rectangle 32x32', () => {
    expect(mergeCollisionRects([true], 1, 1, T)).toEqual([
      { x: 0, y: 0, width: 32, height: 32 },
    ]);
  });

  it('ligne horizontale de 3 -> 1 rectangle 96x32', () => {
    expect(mergeCollisionRects([true, true, true], 3, 1, T)).toEqual([
      { x: 0, y: 0, width: 96, height: 32 },
    ]);
  });

  it('colonne verticale de 3 -> 1 rectangle 32x96', () => {
    expect(mergeCollisionRects([true, true, true], 1, 3, T)).toEqual([
      { x: 0, y: 0, width: 32, height: 96 },
    ]);
  });

  it('bloc 2x2 plein -> 1 rectangle 64x64', () => {
    expect(mergeCollisionRects([true, true, true, true], 2, 2, T)).toEqual([
      { x: 0, y: 0, width: 64, height: 64 },
    ]);
  });

  it('deux cellules séparées par un trou -> 2 rectangles', () => {
    // ligne de 3 : solide, vide, solide
    expect(mergeCollisionRects([true, false, true], 3, 1, T)).toEqual([
      { x: 0, y: 0, width: 32, height: 32 },
      { x: 64, y: 0, width: 32, height: 32 },
    ]);
  });
});
