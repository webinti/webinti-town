/**
 * Miroir lecture-seule du tableau de postes de travail (côté client).
 * Synchroniser avec server/src/workstations.ts à chaque ajout de poste.
 * Laisser vide tant que les coordonnées n'ont pas été calibrées via Shift+D.
 */
export interface Workstation {
  id: string;
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const WORKSTATIONS: readonly Workstation[] = [
  // À calibrer via Shift+D en jeu.
  // { id: 'poste-1', name: 'Poste 1', minX: 384, minY: 96, maxX: 448, maxY: 160 },
];
