// F12 — Circuit de kart chronométré (time-trial). COPIE IDENTIQUE de
// server/src/circuit.ts : la détection des passages est faite côté serveur
// (autoritaire) ; cette copie sert au rendu des portiques côté client. Garder les
// deux fichiers synchronisés (mêmes coordonnées) sinon visuel ≠ détection.

export interface Checkpoint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CIRCUIT_ID = 'circuit-est';

export const CIRCUIT: readonly Checkpoint[] = [
  { x: 3120, y: 1168, w: 128, h: 96 }, // 0 — DÉPART/ARRIVÉE (ligne du bas)
  { x: 3568, y: 600, w: 96, h: 112 },  // 1 — côté droit
  { x: 3104, y: 80, w: 128, h: 96 },   // 2 — côté haut
  { x: 2720, y: 600, w: 96, h: 112 },  // 3 — côté gauche
];

export function checkpointCenter(c: Checkpoint): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}
