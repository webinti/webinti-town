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
// Calibrage v2 — basé sur 4 captures Shift+D :
//   poste-1 (open space, haut-gauche) : Tim @ (611, 444)
//   poste-6 (open space, haut-droite) : Tim @ (1374, 444)
//   poste-7 (open space, bas-gauche)  : Tim @ (610, 572)
//   poste-14 (red room, premier)      : Tim @ (1085, 988)
// Rect de 96×96 px centré sur la position joueur (3 tiles × 3 tiles).
// Open R&D + bureau-rouge-2/3 restent estimés ; à recalibrer.
export const WORKSTATIONS: readonly Workstation[] = [
  // ── Open space marron — rangée du haut (Y center = 444) ──
  { id: 'poste-1',  name: 'Poste 1',  minX:  563, minY: 396, maxX:  659, maxY: 492 },
  { id: 'poste-2',  name: 'Poste 2',  minX:  686, minY: 396, maxX:  782, maxY: 492 },
  { id: 'poste-3',  name: 'Poste 3',  minX:  869, minY: 396, maxX:  965, maxY: 492 },
  { id: 'poste-4',  name: 'Poste 4',  minX: 1022, minY: 396, maxX: 1118, maxY: 492 },
  { id: 'poste-5',  name: 'Poste 5',  minX: 1175, minY: 396, maxX: 1271, maxY: 492 },
  { id: 'poste-6',  name: 'Poste 6',  minX: 1326, minY: 396, maxX: 1422, maxY: 492 },
  // ── Open space marron — rangée du bas (Y center = 572) ──
  { id: 'poste-7',  name: 'Poste 7',  minX:  562, minY: 524, maxX:  658, maxY: 620 },
  { id: 'poste-8',  name: 'Poste 8',  minX:  716, minY: 524, maxX:  812, maxY: 620 },
  { id: 'poste-9',  name: 'Poste 9',  minX:  869, minY: 524, maxX:  965, maxY: 620 },
  { id: 'poste-10', name: 'Poste 10', minX: 1022, minY: 524, maxX: 1118, maxY: 620 },
  { id: 'poste-11', name: 'Poste 11', minX: 1175, minY: 524, maxX: 1271, maxY: 620 },
  { id: 'poste-12', name: 'Poste 12', minX: 1326, minY: 524, maxX: 1422, maxY: 620 },
  // ── Salle blanche en haut-droite (Open R&D, partagé 4 sièges) — TODO recalibrer ──
  { id: 'poste-13', name: 'Open R&D',  minX: 1500, minY: 200, maxX: 1700, maxY: 360 },
  // ── 3 petits bureaux rouges en bas-droite (Y center = 988) ──
  { id: 'poste-14', name: 'Bureau rouge 1', minX: 1037, minY: 940, maxX: 1133, maxY: 1036 },
  { id: 'poste-15', name: 'Bureau rouge 2', minX: 1326, minY: 940, maxX: 1422, maxY: 1036 }, // TODO recalibrer
  { id: 'poste-16', name: 'Bureau rouge 3', minX: 1612, minY: 940, maxX: 1708, maxY: 1036 }, // TODO recalibrer
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
