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

// Tracé spline (chicane) — checkpoints répartis le long du circuit, dans l'ordre.
// Générés par scripts/extend-map-racetrack.py (qui imprime ces coords).
export const CIRCUIT: readonly Checkpoint[] = [
  { x: 3145, y: 1150, w: 110, h: 110 }, // 0 — DÉPART/ARRIVÉE (damier, bas)
  { x: 2792, y: 847, w: 110, h: 110 },  // 1 — bas-gauche
  { x: 2837, y: 322, w: 110, h: 110 },  // 2 — gauche-haut
  { x: 3280, y: 131, w: 110, h: 110 },  // 3 — haut
  { x: 3477, y: 509, w: 110, h: 110 },  // 4 — droite-haut
  { x: 3525, y: 866, w: 110, h: 110 },  // 5 — droite-bas (sortie chicane)
];

/** Centre d'un checkpoint (utile pour le rendu / les libellés). */
export function checkpointCenter(c: Checkpoint): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

export function pointInCheckpoint(x: number, y: number, c: Checkpoint): boolean {
  return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
}
