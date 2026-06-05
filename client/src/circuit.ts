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
  { x: 3136, y: 1170, w: 128, h: 100 }, // 0 — DÉPART/ARRIVÉE (damier, ligne du bas)
  { x: 3532, y: 610, w: 112, h: 124 },  // 1 — côté droit
  { x: 3136, y: 74, w: 128, h: 100 },   // 2 — côté haut
  { x: 2756, y: 610, w: 112, h: 124 },  // 3 — côté gauche
];

export function checkpointCenter(c: Checkpoint): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}
