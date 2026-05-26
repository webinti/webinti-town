export const VIEWER_MIN_ZOOM = 0.5;
export const VIEWER_MAX_ZOOM = 3;

export interface Pan {
  x: number;
  y: number;
}

export function clampViewerZoom(z: number): number {
  if (z < VIEWER_MIN_ZOOM) return VIEWER_MIN_ZOOM;
  if (z > VIEWER_MAX_ZOOM) return VIEWER_MAX_ZOOM;
  return z;
}

export function nextViewerZoom(current: number, dir: 1 | -1): number {
  const stepped = Math.round((current + dir * 0.25) * 100) / 100;
  return clampViewerZoom(stepped);
}

export function clampPan(
  pan: Pan,
  zoom: number,
  viewportW: number,
  viewportH: number,
): Pan {
  if (zoom <= 1) return { x: 0, y: 0 };
  const maxX = (viewportW * (zoom - 1)) / 2;
  const maxY = (viewportH * (zoom - 1)) / 2;
  const clamp = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);
  return { x: clamp(pan.x, maxX), y: clamp(pan.y, maxY) };
}
