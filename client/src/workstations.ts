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
  hidden?: boolean;   // zone audio partagée invisible (pas de contour, pas de panel)
}

// Calibrage v2 — basé sur 4 captures Shift+D. DOIT être identique à server/src/workstations.ts.
export const WORKSTATIONS: readonly Workstation[] = [
  // ── Open space marron — rangée du haut (Y center = 444) ──
  { id: 'poste-1',  name: 'Poste 1',  minX:  563, minY: 396, maxX:  659, maxY: 492 },
  { id: 'poste-2',  name: 'Poste 2',  minX:  686, minY: 396, maxX:  782, maxY: 492 },
  { id: 'poste-3',  name: 'Poste 3',  minX:  869, minY: 396, maxX:  965, maxY: 492 },
  { id: 'poste-4',  name: 'Poste 4',  minX: 1022, minY: 396, maxX: 1118, maxY: 492 },
  { id: 'poste-5',  name: 'Poste 5',  minX: 1210, minY: 396, maxX: 1306, maxY: 492 },
  { id: 'poste-6',  name: 'Poste 6',  minX: 1326, minY: 396, maxX: 1422, maxY: 492 },
  // ── Open space marron — rangée du bas (Y center = 572) ──
  { id: 'poste-7',  name: 'Poste 7',  minX:  562, minY: 524, maxX:  658, maxY: 620 },
  { id: 'poste-8',  name: 'Poste 8',  minX:  686, minY: 524, maxX:  782, maxY: 620 },
  { id: 'poste-9',  name: 'Poste 9',  minX:  869, minY: 524, maxX:  965, maxY: 620 },
  { id: 'poste-10', name: 'Poste 10', minX: 1022, minY: 524, maxX: 1118, maxY: 620 },
  { id: 'poste-11', name: 'Poste 11', minX: 1210, minY: 524, maxX: 1306, maxY: 620 },
  { id: 'poste-12', name: 'Poste 12', minX: 1326, minY: 524, maxX: 1422, maxY: 620 },
  // ── Salle blanche en haut-droite (Open R&D, partagé 4 sièges) — TODO recalibrer ──
  { id: 'poste-13', name: 'Open R&D',  minX: 1665, minY: 524, maxX: 1793, maxY: 620 }, // Tim @ (1729, 572)
  // ── 3 petits bureaux rouges en bas-droite (Y center = 988) ──
  { id: 'poste-14', name: 'Bureau rouge 1', minX: 1037, minY: 940, maxX: 1133, maxY: 1036 },
  { id: 'poste-15', name: 'Bureau rouge 2', minX: 1359, minY: 940, maxX: 1455, maxY: 1036 }, // Tim @ (1407, 988)
  { id: 'poste-16', name: 'Bureau rouge 3', minX: 1683, minY: 940, maxX: 1779, maxY: 1036 }, // Tim @ (1731, 988)
  // ── Pods LimeZu (POC tuiles premium, open space) ──
  { id: 'poste-limezu-1', name: 'Bureau LimeZu 1', minX: 928, minY: 512, maxX: 1024, maxY: 608 },
  { id: 'poste-limezu-2', name: 'Bureau LimeZu 2', minX: 1088, minY: 512, maxX: 1184, maxY: 608 },
  // ── Salle de conférence (zone audio partagée, invisible) ──
  { id: 'salle-conf', name: 'Salle de conférence', minX: 44, minY: 723, maxX: 948, maxY: 1292, hidden: true },
];
