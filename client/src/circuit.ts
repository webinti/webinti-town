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

export const CIRCUIT_ID = 'jardin';

export const CIRCUIT: readonly Checkpoint[] = [
  { x: 1360, y: 216, w: 72, h: 64 }, // 0 — DÉPART/ARRIVÉE (bas-gauche)
  { x: 1748, y: 216, w: 72, h: 64 }, // 1 — virage bas-droite
  { x: 1748, y: 56, w: 72, h: 64 },  // 2 — virage haut-droite
  { x: 1360, y: 56, w: 72, h: 64 },  // 3 — virage haut-gauche
];

export function checkpointCenter(c: Checkpoint): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}
