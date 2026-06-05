// F12 — Circuit de kart chronométré (time-trial).
//
// Le circuit est une boucle de "portiques" (checkpoints) à franchir DANS L'ORDRE.
// L'index 0 est la ligne départ/arrivée. Géométrie partagée à l'identique avec le
// client (client/src/circuit.ts) pour que le rendu visuel des portiques corresponde
// exactement à la détection serveur (autoritaire). Coordonnées en pixels monde.
//
// Tracé v1 : boucle rectangulaire dans la partie DROITE du jardin extérieur, une
// zone libre de toute collision (x≈1360→1820, y≈56→284 — vérifié contre la couche
// `collision`). Le centre/gauche du jardin est encombré (fontaine, bancs, arbres,
// ping-pong) et bloquerait les karts. Boucle dans le sens horaire : 0(bas-g) →
// 1(bas-d) → 2(haut-d) → 3(haut-g) → retour 0. Rectangles 72×64 (généreux pour la
// vitesse). Ajuster ces coords (et la copie client) pour redessiner la piste.

export interface Checkpoint {
  /** Coin haut-gauche du rectangle de détection (px monde). */
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

/** Centre d'un checkpoint (utile pour le rendu / les libellés). */
export function checkpointCenter(c: Checkpoint): { x: number; y: number } {
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}

export function pointInCheckpoint(x: number, y: number, c: Checkpoint): boolean {
  return x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h;
}
