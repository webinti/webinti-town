// Logique pure de placement des tuiles LimeZu pour le POC bureau.
// Aucune I/O : testable unitairement (cf. officePoc.test.mjs).
// Coordonnées de tuiles validées visuellement (composite + grilles annotées).

const COLS = 16; // toutes les sheets LimeZu utilisées font 16 colonnes.

export function localId(col, row) {
  return row * COLS + col;
}

export function nextFirstgid(tilesets) {
  const last = tilesets[tilesets.length - 1];
  return last.firstgid + last.tilecount;
}

// Coordonnées (col,row) des tuiles dans la sheet office Modern_Office_*_32x32.
const T = {
  monitor: [14, 12], // écran bleu de face
  deskL: [7, 29], // bureau beige 3 tuiles (gauche/milieu/droite), avec pieds
  deskM: [8, 29],
  deskR: [9, 29],
  chair: [0, 9], // chaise de bureau grise, vue de dos (perso assis face au nord)
  plantTop: [6, 10], // plante verte en pot (haut)
  plantBot: [6, 11], // plante verte en pot (bas)
};
const FLOOR = [10, 5]; // sol gris bureau (room_builder)

// Génère les placements d'un pod, origine (oc,or) = coin haut-gauche de l'emprise.
// Layout (non superposé, layer unique) :
//   ligne or   :        [écran]                  (oc+1)
//   ligne or+1 : [deskL][deskM][deskR] [plante]  (oc..oc+2 ; plante oc+3)
//   ligne or+2 :        [chaise]                  (oc+1)
// (plante haut en (oc+3, or), bas en (oc+3, or+1))
export function podTiles(oc, or, officeFirstgid) {
  const g = (coord) => officeFirstgid + localId(coord[0], coord[1]);
  return [
    { col: oc + 1, row: or, gid: g(T.monitor) },
    { col: oc, row: or + 1, gid: g(T.deskL) },
    { col: oc + 1, row: or + 1, gid: g(T.deskM) },
    { col: oc + 2, row: or + 1, gid: g(T.deskR) },
    { col: oc + 1, row: or + 2, gid: g(T.chair) },
    { col: oc + 3, row: or, gid: g(T.plantTop) },
    { col: oc + 3, row: or + 1, gid: g(T.plantBot) },
  ];
}

// Patch de sol autour du pod (déborde d'1 tuile : 6 cols x 5 lignes).
export function floorPatch(oc, or, roomBuilderFirstgid) {
  const gid = roomBuilderFirstgid + localId(FLOOR[0], FLOOR[1]);
  const tiles = [];
  for (let dy = -1; dy <= 3; dy++) {
    for (let dx = -1; dx <= 4; dx++) {
      tiles.push({ col: oc + dx, row: or + dy, gid });
    }
  }
  return tiles;
}

// Rectangle de collision du plateau (3 tuiles de large, ligne or+1).
export function deskCollisionRect(oc, or, tile = 32) {
  return { x: oc * tile, y: (or + 1) * tile, width: 3 * tile, height: tile };
}
