// Transforme le coin haut-gauche de la Réception (où les 5 karts sont garés en dur
// côté serveur, parkingY=356 -> ligne 11, cols ~1-7) en un vrai GARAGE assumé :
// dalle béton à joints + marquage parking au sol. Descend le comptoir d'accueil
// ligne 16 pour libérer la zone. Idempotent.
// Lancement : cd client && node scripts/gen-garage.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { localId } from './officePoc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const W = map.width;

const room = map.tilesets.find((t) => t.name === 'room_builder').firstgid;
const basic = map.tilesets.find((t) => t.name === 'basic').firstgid;
const R = (col, row) => room + localId(col, row);
const B = (col, row) => basic + localId(col, row);

// Tuiles
const CONCRETE = R(10, 7); // béton gris à joints (look parking/industriel)
const LINE = R(10, 5);     // béton gris clair lisse -> marquage tonal (pas de blanc criard)
const BEIGE = R(4, 9);     // sol beige d'origine (pour effacer l'ancien comptoir)

const floor = map.layers.find((l) => l.name === 'limezu_floor' && l.type === 'tilelayer');
const furn = map.layers.find((l) => l.name === 'furniture' && l.type === 'tilelayer');
const set = (layer, c, r, gid) => { if (c >= 0 && c < W && r >= 0 && r < map.height) layer.data[r * W + c] = gid; };

// --- 1. Dalle béton du garage : cols 1-8, lignes 11-14 ---
const G = { c0: 1, c1: 8, r0: 11, r1: 14 };
for (let r = G.r0; r <= G.r1; r++)
  for (let c = G.c0; c <= G.c1; c++) set(floor, c, r, CONCRETE);

// --- 2. Marquage au sol (blanc) : une ligne frontale nette + courts séparateurs ---
// ligne frontale (bas du garage) = "les véhicules se garent derrière cette ligne"
for (let c = G.c0; c <= G.c1; c++) set(floor, c, G.r1, LINE);
// courts séparateurs de box montant de la ligne frontale, devant les karts
for (const c of [3, 6]) set(floor, c, 13, LINE);

// --- 3. Efface l'ancien comptoir (furniture ligne 12, cols 2-7) -> il était sous les karts ---
for (let c = 2; c <= 7; c++) furn.data[12 * W + c] = 0;

// --- 4. Repose le comptoir d'accueil plus bas (ligne 16), près du sofa/lounge ---
const DESK = [[2, B(1, 5)], [3, B(2, 5)], [4, B(2, 5)], [5, B(2, 5)], [6, B(2, 5)], [7, B(3, 5)]];
for (const [c, gid] of DESK) set(furn, c, 16, gid);

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log(`OK — garage : dalle béton ${G.c0}-${G.c1} x ${G.r0}-${G.r1} + marquage, comptoir descendu ligne 16`);
