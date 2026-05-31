// Logique pure de placement des tuiles LimeZu pour le POC bureau.
// Aucune I/O : testable unitairement (cf. officePoc.test.mjs).

const COLS = 16; // toutes les sheets LimeZu utilisées font 16 colonnes.

export function localId(col, row) {
  return row * COLS + col;
}

export function nextFirstgid(tilesets) {
  const last = tilesets[tilesets.length - 1];
  return last.firstgid + last.tilecount;
}

// Coordonnées (col,row) des tuiles dans la sheet office, identifiées visuellement.
const T = {
  monitor: [13, 8],
  deskBackL: [4, 17],
  deskBackR: [5, 17],
  deskFrontL: [4, 18],
  deskFrontR: [5, 18],
  chair: [0, 8],
  plantTop: [5, 7],
  plantBot: [5, 8],
};
const FLOOR = [10, 5]; // sol room_builder

// Génère les placements d'un pod, origine (oc,or) = coin haut-gauche.
export function podTiles(oc, or, officeFirstgid) {
  const g = (coord) => officeFirstgid + localId(coord[0], coord[1]);
  return [
    { col: oc, row: or, gid: g(T.monitor) },
    { col: oc, row: or + 1, gid: g(T.deskBackL) },
    { col: oc + 1, row: or + 1, gid: g(T.deskBackR) },
    { col: oc, row: or + 2, gid: g(T.deskFrontL) },
    { col: oc + 1, row: or + 2, gid: g(T.deskFrontR) },
    { col: oc, row: or + 3, gid: g(T.chair) },
    { col: oc + 2, row: or + 1, gid: g(T.plantTop) },
    { col: oc + 2, row: or + 2, gid: g(T.plantBot) },
  ];
}

// Patch de sol 5x6 autour de l'origine (déborde d'1 tuile autour du pod).
export function floorPatch(oc, or, roomBuilderFirstgid) {
  const gid = roomBuilderFirstgid + localId(FLOOR[0], FLOOR[1]);
  const tiles = [];
  for (let dy = -1; dy <= 4; dy++) {
    for (let dx = -1; dx <= 3; dx++) {
      tiles.push({ col: oc + dx, row: or + dy, gid });
    }
  }
  return tiles;
}

// Rectangle de collision du plateau (2x2 sous l'écran).
export function deskCollisionRect(oc, or, tile = 32) {
  return { x: oc * tile, y: (or + 1) * tile, width: 2 * tile, height: 2 * tile };
}
