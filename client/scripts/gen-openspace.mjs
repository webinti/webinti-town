// Habille l'open space en LimeZu : sol gris + 12 pods (bureau 3 tuiles + écran +
// chaise) aux positions des postes, nettoie les vieux meubles basic, plantes déco.
// Remplace les 2 pods POC (limezu_test). Idempotent.
// Lancement : cd client && node scripts/gen-openspace.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { localId } from './officePoc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const W = map.width;
const T = map.tilewidth;

const office = map.tilesets.find((t) => t.name === 'office_shadow').firstgid;
const room = map.tilesets.find((t) => t.name === 'room_builder').firstgid;
const g = (col, row) => office + localId(col, row); // tuile office_shadow
const FLOOR_GID = room + localId(10, 5); // sol gris

// tuiles office (col,row)
const TILE = {
  monitor: [14, 12], deskL: [7, 29], deskM: [8, 29], deskR: [9, 29], chair: [0, 9],
  plantTop: [6, 10], plantBot: [6, 11],
};

// 12 postes open space : (colTuile, rowTuile centre du bureau)
const PODS = [
  [19, 13], [22, 13], [28, 13], [33, 13], [39, 13], [42, 13],
  [19, 17], [22, 17], [28, 17], [33, 17], [39, 17], [42, 17],
];
// plantes déco (col,row du pot bas) dans les allées / espaces libres
const PLANTS = [[25, 13], [36, 13], [25, 17], [36, 17], [16, 15], [45, 15]];

const FLOOR_RECT = { c0: 15, c1: 45, r0: 11, r1: 20 }; // zone à re-solliver
const CLEAR_RECT = { c0: 14, c1: 46, r0: 11, r1: 20 }; // vieux meubles basic à effacer

// --- helpers couches ---
const layer = (name) => map.layers.find((l) => l.name === name && l.type === 'tilelayer');
function ensureLayer(name, insertAfter) {
  let l = layer(name);
  if (!l) {
    l = { name, type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0, width: W, height: map.height, data: new Array(W * map.height).fill(0) };
    const idx = map.layers.findIndex((x) => x.name === insertAfter);
    map.layers.splice(idx + 1, 0, l);
  }
  return l;
}
const set = (l, c, r, gid) => { if (c >= 0 && c < W && r >= 0 && r < map.height) l.data[r * W + c] = gid; };

// --- 1. nettoie les vieux meubles basic dans l'open space ---
const furn = layer('furniture');
for (let r = CLEAR_RECT.r0; r <= CLEAR_RECT.r1; r++)
  for (let c = CLEAR_RECT.c0; c <= CLEAR_RECT.c1; c++) furn.data[r * W + c] = 0;

// --- 2. sol gris LimeZu sur toute la zone (couche limezu_floor) ---
const floor = ensureLayer('limezu_floor', 'ground');
for (let r = FLOOR_RECT.r0; r <= FLOOR_RECT.r1; r++)
  for (let c = FLOOR_RECT.c0; c <= FLOOR_RECT.c1; c++) set(floor, c, r, FLOOR_GID);

// --- 3. pods + plantes dans limezu_test (on repart de zéro) ---
const test = ensureLayer('limezu_test', 'decoration');
test.data = new Array(W * map.height).fill(0);
for (const [cx, cy] of PODS) {
  set(test, cx, cy - 1, g(...TILE.monitor));      // écran
  set(test, cx - 1, cy, g(...TILE.deskL));         // bureau 3 tuiles
  set(test, cx, cy, g(...TILE.deskM));
  set(test, cx + 1, cy, g(...TILE.deskR));
  set(test, cx, cy + 1, g(...TILE.chair));         // chaise
}
for (const [cx, cy] of PLANTS) {
  set(test, cx, cy - 1, g(...TILE.plantTop));
  set(test, cx, cy, g(...TILE.plantBot));
}

// --- 4. collisions : remplace poc_desk par les 12 plateaux ---
const coll = map.layers.find((l) => l.name === 'collision' && l.type === 'objectgroup');
coll.objects = coll.objects.filter((o) => o.name !== 'poc_desk');
let nextId = Math.max(0, ...map.layers.flatMap((l) => (l.objects ?? []).map((o) => o.id ?? 0))) + 1;
for (const [cx, cy] of PODS) {
  coll.objects.push({ id: nextId++, name: 'poc_desk', type: '', x: (cx - 1) * T, y: cy * T, width: 3 * T, height: T, rotation: 0, visible: true });
}

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log(`OK — open space : 12 pods, ${PLANTS.length} plantes, sol ${FLOOR_RECT.c0}-${FLOOR_RECT.c1}x${FLOOR_RECT.r0}-${FLOOR_RECT.r1}`);
