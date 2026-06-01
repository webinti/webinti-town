// Pose les sols LimeZu texturés par salle sur la couche limezu_floor (rendue
// au-dessus de l'ancien sol couleur unie, sous les murs). Idempotent.
// Open space (gris) déjà fait par gen-openspace.mjs — non touché ici.
// Lancement : cd client && node scripts/gen-floors.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { localId } from './officePoc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const W = map.width, H = map.height;
const room = map.tilesets.find((t) => t.name === 'room_builder').firstgid;
const g = (col, row) => room + localId(col, row);

// (col,row) texture dans room_builder + rectangle intérieur de chaque salle.
const ROOMS = [
  { name: 'reception', tile: [4, 9], c0: 1, c1: 14, r0: 11, r1: 21 },   // beige
  { name: 'rnd', tile: [4, 11], c0: 50, c1: 58, r0: 11, r1: 21 },        // blanc
  { name: 'conference', tile: [4, 5], c0: 1, c1: 29, r0: 23, r1: 40 },   // lavande
  { name: 'red_zone', tile: [10, 11], c0: 31, c1: 58, r0: 23, r1: 40 },  // rouge (bandeau + 3 salles)
  { name: 'open_space_fill', tile: [10, 5], c0: 15, c1: 48, r0: 11, r1: 21 }, // gris : couvre tout l'open space
];

const floor = map.layers.find((l) => l.name === 'limezu_floor' && l.type === 'tilelayer');
const set = (c, r, gid) => { if (c >= 0 && c < W && r >= 0 && r < H) floor.data[r * W + c] = gid; };

let total = 0;
for (const room of ROOMS) {
  const gid = g(room.tile[0], room.tile[1]);
  for (let r = room.r0; r <= room.r1; r++)
    for (let c = room.c0; c <= room.c1; c++) { set(c, r, gid); total++; }
}

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log(`OK — sols LimeZu : ${ROOMS.map((x) => x.name).join(', ')} (${total} tuiles)`);
