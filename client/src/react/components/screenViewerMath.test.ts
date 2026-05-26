import { describe, it, expect } from 'vitest';
import {
  VIEWER_MIN_ZOOM,
  VIEWER_MAX_ZOOM,
  clampViewerZoom,
  nextViewerZoom,
  clampPan,
} from './screenViewerMath';

describe('clampViewerZoom', () => {
  it('uses 0.5 .. 3 bounds', () => {
    expect(VIEWER_MIN_ZOOM).toBe(0.5);
    expect(VIEWER_MAX_ZOOM).toBe(3);
  });
  it('clamps out-of-range', () => {
    expect(clampViewerZoom(0)).toBe(0.5);
    expect(clampViewerZoom(10)).toBe(3);
    expect(clampViewerZoom(1.5)).toBe(1.5);
  });
});

describe('nextViewerZoom', () => {
  it('steps by 0.25 and clamps', () => {
    expect(nextViewerZoom(1, 1)).toBe(1.25);
    expect(nextViewerZoom(1, -1)).toBe(0.75);
    expect(nextViewerZoom(3, 1)).toBe(3);
    expect(nextViewerZoom(0.5, -1)).toBe(0.5);
  });
  it('rounds to avoid float drift', () => {
    expect(nextViewerZoom(0.5, 1)).toBe(0.75);
  });
});

describe('clampPan', () => {
  it('is zero when zoom <= 1', () => {
    expect(clampPan({ x: 100, y: 100 }, 1, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: 100, y: 100 }, 0.5, 800, 600)).toEqual({ x: 0, y: 0 });
  });
  it('clamps to +/- viewport*(zoom-1)/2', () => {
    expect(clampPan({ x: 999, y: -999 }, 2, 800, 600)).toEqual({ x: 400, y: -300 });
  });
  it('passes through within-range values', () => {
    expect(clampPan({ x: 50, y: -20 }, 2, 800, 600)).toEqual({ x: 50, y: -20 });
  });
});
