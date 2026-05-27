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
export const WORKSTATIONS: readonly Workstation[] = [
  // À calibrer via Shift+D en jeu. Exemple commenté :
  // { id: 'poste-1',  name: 'Poste 1',  minX: 384, minY:  96, maxX: 448, maxY: 160 },
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
