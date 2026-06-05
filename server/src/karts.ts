// F11 — Karts: parking definitions and shared constants.
// 5 karts in a horizontal row at the entrance parking (pixel y=356),
// spaced 40 px apart starting from x=44 (tile (1, 11)).

export interface KartDef {
  id: string;
  parkingX: number;
  parkingY: number;
}

export const KARTS: readonly KartDef[] = [
  // Parking d'entrée (réception)
  { id: 'kart-1', parkingX:  44, parkingY: 356 },
  { id: 'kart-2', parkingX:  84, parkingY: 356 },
  { id: 'kart-3', parkingX: 124, parkingY: 356 },
  { id: 'kart-4', parkingX: 164, parkingY: 356 },
  { id: 'kart-5', parkingX: 204, parkingY: 356 },
  // Karts du circuit est : garés dans le paddock (entrée haut-gauche, depuis le
  // jardin) → le joueur en prend un à pied dès l'arrivée, puis rejoint la ligne.
  { id: 'kart-6', parkingX: 2750, parkingY: 110 },
  { id: 'kart-7', parkingX: 2800, parkingY: 110 },
  { id: 'kart-8', parkingX: 2750, parkingY: 185 },
  { id: 'kart-9', parkingX: 2800, parkingY: 185 },
];

export const KART_SPEED_BASE  = 320;      // px/s, joueur monté sur kart, sans boost
export const KART_SPEED_BOOST = 480;      // px/s, pendant les 2 s de boost
export const BOOST_DURATION_MS = 2000;
export const BOOST_COOLDOWN_MS = 15000;
export const KART_IDLE_RETURN_MS = 5 * 60 * 1000;

// AABB demi-tailles, pour collision push.
export const KART_HALF_W = 14;
export const KART_HALF_H = 10;
export const PLAYER_HALF = 12;

// Distance max joueur-kart pour pouvoir monter (E).
export const MOUNT_DISTANCE = 32;
