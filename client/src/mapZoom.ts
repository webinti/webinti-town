export const MAP_MIN_ZOOM = 0.5;
export const MAP_MAX_ZOOM = 2;

export function clampMapZoom(z: number): number {
  if (z < MAP_MIN_ZOOM) return MAP_MIN_ZOOM;
  if (z > MAP_MAX_ZOOM) return MAP_MAX_ZOOM;
  return z;
}

export function stepMapZoom(current: number, dir: 1 | -1, step: number): number {
  const next = Math.round((current + dir * step) * 100) / 100;
  return clampMapZoom(next);
}
