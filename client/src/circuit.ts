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
  { x: 3145, y: 1150, w: 110, h: 110 }, // 0 — DÉPART/ARRIVÉE (damier, bas)
  { x: 2792, y: 847, w: 110, h: 110 },  // 1 — bas-gauche
  { x: 2837, y: 322, w: 110, h: 110 },  // 2 — gauche-haut
  { x: 3280, y: 131, w: 110, h: 110 },  // 3 — haut
  { x: 3477, y: 509, w: 110, h: 110 },  // 4 — droite-haut
  { x: 3525, y: 866, w: 110, h: 110 },  // 5 — droite-bas (sortie chicane)
];

export function checkpointCenter(c: Checkpoint): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

// Zone du circuit (la zone extérieure ajoutée à l'est, px monde). Sert à n'afficher
// le HUD de course que lorsqu'on est sur/près de la piste (pas dans les bureaux).
export const CIRCUIT_ZONE = { x0: 2650, y0: 0, x1: 3712, y1: 1344 };

export function inCircuitZone(x: number, y: number): boolean {
  return (
    x >= CIRCUIT_ZONE.x0 && x <= CIRCUIT_ZONE.x1 &&
    y >= CIRCUIT_ZONE.y0 && y <= CIRCUIT_ZONE.y1
  );
}
