export interface Workstation {
  id: string;    // ex: 'poste-1', 'poste-2'
  name: string;  // ex: 'Poste 1' (pour les toasts)
  minX: number;  // pixel, inclusive
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Tableau des postes de travail définis sur la map.
 * Laissé vide intentionnellement — à remplir après calibration en jeu
 * via le mode debug Shift+D. Voir la spec F6 pour la structure attendue.
 *
 * Format : { id: 'poste-1', name: 'Poste 1', minX: 384, minY: 96, maxX: 448, maxY: 160 }
 * 16 postes attendus au total (12 open-space + 1 salle blanche + 3 bureaux rouges).
 */
// Estimations grossières basées sur le screenshot annoté (à ajuster via Shift+D).
// Map = 60×42 tiles de 32px. Tile (x,y) = pixel (x*32, y*32).
export const WORKSTATIONS: readonly Workstation[] = [
  // ── Open space marron — rangée du haut (6 postes) ──
  { id: 'poste-1',  name: 'Poste 1',  minX: 11 * 32, minY:  5 * 32, maxX: 13 * 32, maxY:  7 * 32 },
  { id: 'poste-2',  name: 'Poste 2',  minX: 14 * 32, minY:  5 * 32, maxX: 16 * 32, maxY:  7 * 32 },
  { id: 'poste-3',  name: 'Poste 3',  minX: 17 * 32, minY:  5 * 32, maxX: 19 * 32, maxY:  7 * 32 },
  { id: 'poste-4',  name: 'Poste 4',  minX: 21 * 32, minY:  5 * 32, maxX: 23 * 32, maxY:  7 * 32 },
  { id: 'poste-5',  name: 'Poste 5',  minX: 24 * 32, minY:  5 * 32, maxX: 26 * 32, maxY:  7 * 32 },
  { id: 'poste-6',  name: 'Poste 6',  minX: 27 * 32, minY:  5 * 32, maxX: 29 * 32, maxY:  7 * 32 },
  // ── Open space marron — rangée du bas (6 postes) ──
  { id: 'poste-7',  name: 'Poste 7',  minX: 11 * 32, minY:  9 * 32, maxX: 13 * 32, maxY: 11 * 32 },
  { id: 'poste-8',  name: 'Poste 8',  minX: 14 * 32, minY:  9 * 32, maxX: 16 * 32, maxY: 11 * 32 },
  { id: 'poste-9',  name: 'Poste 9',  minX: 17 * 32, minY:  9 * 32, maxX: 19 * 32, maxY: 11 * 32 },
  { id: 'poste-10', name: 'Poste 10', minX: 21 * 32, minY:  9 * 32, maxX: 23 * 32, maxY: 11 * 32 },
  { id: 'poste-11', name: 'Poste 11', minX: 24 * 32, minY:  9 * 32, maxX: 26 * 32, maxY: 11 * 32 },
  { id: 'poste-12', name: 'Poste 12', minX: 27 * 32, minY:  9 * 32, maxX: 29 * 32, maxY: 11 * 32 },
  // ── Salle blanche en haut-droite (1 poste partagé, 4 sièges) ──
  { id: 'poste-13', name: 'Open R&D',  minX: 50 * 32, minY:  6 * 32, maxX: 54 * 32, maxY:  9 * 32 },
  // ── 3 petits bureaux rouges en bas-droite ──
  { id: 'poste-14', name: 'Bureau rouge 1', minX: 35 * 32, minY: 22 * 32, maxX: 38 * 32, maxY: 25 * 32 },
  { id: 'poste-15', name: 'Bureau rouge 2', minX: 44 * 32, minY: 22 * 32, maxX: 47 * 32, maxY: 25 * 32 },
  { id: 'poste-16', name: 'Bureau rouge 3', minX: 53 * 32, minY: 22 * 32, maxX: 56 * 32, maxY: 25 * 32 },
];

/**
 * Fonction pure testable : cherche dans `workstations` le premier poste contenant (x, y).
 * Frontières inclusives des deux côtés.
 */
export function workstationIdForPointIn(
  workstations: readonly Workstation[],
  x: number,
  y: number,
): string | null {
  for (const w of workstations) {
    if (x >= w.minX && x <= w.maxX && y >= w.minY && y <= w.maxY) return w.id;
  }
  return null;
}

/**
 * Version raccourcie qui opère sur le tableau global WORKSTATIONS.
 */
export function workstationIdForPoint(x: number, y: number): string | null {
  return workstationIdForPointIn(WORKSTATIONS, x, y);
}
