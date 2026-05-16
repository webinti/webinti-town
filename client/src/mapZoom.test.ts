import { describe, it, expect } from 'vitest';
import { MAP_MIN_ZOOM, MAP_MAX_ZOOM, clampMapZoom, stepMapZoom } from './mapZoom';

describe('clampMapZoom', () => {
  it('uses 0.5 .. 2.0 bounds', () => {
    expect(MAP_MIN_ZOOM).toBe(0.5);
    expect(MAP_MAX_ZOOM).toBe(2);
  });

  it('clamps below min and above max', () => {
    expect(clampMapZoom(0.1)).toBe(0.5);
    expect(clampMapZoom(5)).toBe(2);
    expect(clampMapZoom(1)).toBe(1);
  });
});

describe('stepMapZoom', () => {
  it('steps up and down by the given amount', () => {
    expect(stepMapZoom(1, 1, 0.25)).toBe(1.25);
    expect(stepMapZoom(1, -1, 0.25)).toBe(0.75);
  });

  it('clamps the stepped result', () => {
    expect(stepMapZoom(2, 1, 0.25)).toBe(2);
    expect(stepMapZoom(0.5, -1, 0.25)).toBe(0.5);
  });

  it('rounds to avoid floating point drift', () => {
    expect(stepMapZoom(0.7, 1, 0.1)).toBe(0.8);
  });
});
