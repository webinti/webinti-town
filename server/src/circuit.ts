// F12 — Circuit de kart chronométré (time-trial).
//
// Le circuit est une boucle de "portiques" (checkpoints) à franchir DANS L'ORDRE.
// L'index 0 est la ligne départ/arrivée. Géométrie partagée à l'identique avec le
// client (client/src/circuit.ts) pour que le rendu visuel des portiques corresponde
// exactement à la détection serveur (autoritaire). Coordonnées en pixels monde.
//
// Tracé v2 : grand circuit asphalté dans la zone extérieure DÉDIÉE ajoutée à l'est
// de la map (scripts/extend-map-racetrack.py). Anneau asphalté avec intérieur
// bloqué → la trajectoire suit l'asphalte. 4 portiques au milieu de chaque côté,
// dans l'ordre : 0(bas/départ) → 1(droite) → 2(haut) → 3(gauche) → retour 0.
// Les coords doivent matcher la piste peinte par le script (et la copie client).

export interface Checkpoint {
  /** Coin haut-gauche du rectangle de détection (px monde). */
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

/** Centre d'un checkpoint (utile pour le rendu / les libellés). */
export function checkpointCenter(c: Checkpoint): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

export function pointInCheckpoint(x: number, y: number, c: Checkpoint): boolean {
  return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
}
