/**
 * Tableau des postes de travail définis sur la map.
 * Laissé vide intentionnellement — à remplir après calibration en jeu
 * via le mode debug Shift+D. Voir la spec F6 pour la structure attendue.
 *
 * Format : { id: 'poste-1', name: 'Poste 1', minX: 384, minY: 96, maxX: 448, maxY: 160 }
 * 16 postes attendus au total (12 open-space + 1 salle blanche + 3 bureaux rouges).
 */
export const WORKSTATIONS = [
// À calibrer via Shift+D en jeu. Exemple commenté :
// { id: 'poste-1',  name: 'Poste 1',  minX: 384, minY:  96, maxX: 448, maxY: 160 },
];
/**
 * Fonction pure testable : cherche dans `workstations` le premier poste contenant (x, y).
 * Frontières inclusives des deux côtés.
 */
export function workstationIdForPointIn(workstations, x, y) {
    for (const w of workstations) {
        if (x >= w.minX && x <= w.maxX && y >= w.minY && y <= w.maxY)
            return w.id;
    }
    return null;
}
/**
 * Version raccourcie qui opère sur le tableau global WORKSTATIONS.
 */
export function workstationIdForPoint(x, y) {
    return workstationIdForPointIn(WORKSTATIONS, x, y);
}
//# sourceMappingURL=workstations.js.map