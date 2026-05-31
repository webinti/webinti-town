// Aile gym à l'est : élargit default.tmj (60->84), enregistre les 2 couches du
// design gym pré-fait LimeZu comme tilesets, pose gym + couloir, ouvre le mur
// est et ajoute les collisions. Idempotent. Lancement : cd client && node scripts/gen-gym.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { widenData } from './mapResize.mjs';
import { nextFirstgid } from './officePoc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));

const BASE_W = 60; // largeur d'origine
const NEW_W = 84;
const T = map.tileheight; // 32

// Géométrie (tuiles)
const GYM = { oc: 64, or: 9, cols: 19, rows: 15 }; // bloc design 19x15
const COR = { x0: 60, x1: 63, y0: 15, y1: 16 }; // couloir cols 60-63 lignes 15-16
const GYM_TILESETS = [
  { name: 'gym_floor', image: '../assets/tilesets/Gym_layer_1_32x32.png', imagewidth: 608, imageheight: 480, tilecount: 285 },
  { name: 'gym_equip', image: '../assets/tilesets/Gym_layer_2_32x32.png', imagewidth: 608, imageheight: 480, tilecount: 285 },
];
const GYM_NAMES = new Set(GYM_TILESETS.map((t) => t.name));
const GEN_LAYERS = new Set(['gym_floor', 'gym_equip', 'gym_corridor']);
const ROOM_BUILDER_FLOOR_LOCAL = 90; // sol gris (col10,row5) du tileset room_builder

// --- idempotence : repartir de l'état de base ---
map.tilesets = map.tilesets.filter((t) => !GYM_NAMES.has(t.name));
map.layers = map.layers.filter((l) => !GEN_LAYERS.has(l.name));
for (const l of map.layers) {
  if (l.type === 'objectgroup' && Array.isArray(l.objects)) {
    l.objects = l.objects.filter((o) =>
      o.name !== 'gym' && o.name !== 'gym_eastwall' &&
      // l'ancien mur est plein (sera re-scindé) — retiré pour idempotence
      !(Math.round(o.x) === 1888 && Math.round(o.y) === 352 && Math.round(o.height) === 992),
    );
  }
}

// --- 1. élargir toutes les couches tuiles (depuis la largeur courante) ---
const curW = map.width;
for (const l of map.layers) {
  if (l.type === 'tilelayer' && Array.isArray(l.data)) {
    l.data = widenData(l.data, curW, map.height, NEW_W);
    l.width = NEW_W;
  }
}
map.width = NEW_W;
const H = map.height;

// --- 2. tilesets gym ---
const fg = {};
for (const def of GYM_TILESETS) {
  const firstgid = nextFirstgid(map.tilesets);
  fg[def.name] = firstgid;
  map.tilesets.push({
    firstgid, name: def.name, image: def.image,
    imagewidth: def.imagewidth, imageheight: def.imageheight,
    tilewidth: 32, tileheight: 32, columns: 19, tilecount: def.tilecount,
    margin: 0, spacing: 0,
  });
}
const roomBuilder = map.tilesets.find((t) => t.name === 'room_builder');
const FLOOR_GID = roomBuilder.firstgid + ROOM_BUILDER_FLOOR_LOCAL;

// --- helper couche vide ---
function emptyLayer(name) {
  return { name, type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0, width: NEW_W, height: H, data: new Array(NEW_W * H).fill(0) };
}
const set = (layer, col, row, gid) => { if (col >= 0 && col < NEW_W && row >= 0 && row < H) layer.data[row * NEW_W + col] = gid; };

// --- 3+4. bloc gym : floor puis equip, gids en ordre ligne par ligne ---
const floorLayer = emptyLayer('gym_floor');
const equipLayer = emptyLayer('gym_equip');
for (let dy = 0; dy < GYM.rows; dy++) {
  for (let dx = 0; dx < GYM.cols; dx++) {
    const local = dy * GYM.cols + dx; // 0..284
    set(floorLayer, GYM.oc + dx, GYM.or + dy, fg.gym_floor + local);
    set(equipLayer, GYM.oc + dx, GYM.or + dy, fg.gym_equip + local);
  }
}

// --- 5. couloir : sol + murs visuels (haut/bas) ---
const WALL_GID = roomBuilder.firstgid + 8; // tuile mur plein room_builder (col8,row0)
const corridor = emptyLayer('gym_corridor');
for (let y = COR.y0; y <= COR.y1; y++) {
  for (let x = COR.x0; x <= COR.x1; x++) set(corridor, x, y, FLOOR_GID);
}
for (let x = COR.x0; x <= COR.x1; x++) {
  set(corridor, x, COR.y0 - 1, WALL_GID); // mur haut
  set(corridor, x, COR.y1 + 1, WALL_GID); // mur bas
}
// prolonge le sol du couloir jusque dans l'embrasure de la gym (col 64)
for (let y = COR.y0; y <= COR.y1; y++) set(corridor, GYM.oc, y, FLOOR_GID);

// --- perce l'embrasure : retire les tuiles de mur ouest de la gym aux lignes couloir ---
for (let y = COR.y0; y <= COR.y1; y++) {
  set(floorLayer, GYM.oc, y, 0); // enlève la tuile de design (mur) -> laisse voir le sol couloir
  set(equipLayer, GYM.oc, y, 0);
}

// insertion : sol couloir + gym_floor après 'ground' ; gym_equip tout en haut
const groundIdx = map.layers.findIndex((l) => l.name === 'ground');
map.layers.splice(groundIdx + 1, 0, corridor, floorLayer);
map.layers.push(equipLayer);

// --- 6. ouverture du mur est (col 59) au niveau du couloir ---
const coll = map.layers.find((l) => l.name === 'collision' && l.type === 'objectgroup');
let nextId = Math.max(0, ...map.layers.flatMap((l) => (l.objects ?? []).map((o) => o.id ?? 0))) + 1;
// l'ancien mur plein (x=1888,y=352,h=992) a été retiré plus haut ; on pose
// inconditionnellement les 2 segments laissant le passage du couloir.
{
  const gapY0 = COR.y0 * T, gapY1 = (COR.y1 + 1) * T; // passage rows 15-16 -> y 480..544
  if (gapY0 > 352) coll.objects.push({ id: nextId++, name: 'gym_eastwall', type: '', x: 1888, y: 352, width: 32, height: gapY0 - 352, rotation: 0, visible: true });
  if (1344 > gapY1) coll.objects.push({ id: nextId++, name: 'gym_eastwall', type: '', x: 1888, y: gapY1, width: 32, height: 1344 - gapY1, rotation: 0, visible: true });
}

// --- 7. collisions gym (périmètre) + couloir (haut/bas) ---
function rect(x, y, w, h) { coll.objects.push({ id: nextId++, name: 'gym', type: '', x, y, width: w, height: h, rotation: 0, visible: true }); }
const gx0 = GYM.oc * T, gy0 = GYM.or * T, gx1 = (GYM.oc + GYM.cols) * T, gy1 = (GYM.or + GYM.rows) * T;
rect(gx0, gy0, GYM.cols * T, T);            // mur haut gym
rect(gx0, gy1 - T, GYM.cols * T, T);        // mur bas gym
rect(gx1 - T, gy0, T, GYM.rows * T);        // mur droit gym
// mur gauche gym : seulement hors passage couloir (le couloir entre par la gauche)
rect(gx0, gy0, T, (COR.y0 - GYM.or) * T);                       // gauche au-dessus couloir
rect(gx0, (COR.y1 + 1) * T, T, (GYM.or + GYM.rows - (COR.y1 + 1)) * T); // gauche en-dessous
// couloir murs invisibles haut/bas
rect(COR.x0 * T, (COR.y0 - 1) * T, (COR.x1 - COR.x0 + 1) * T, T); // haut
rect(COR.x0 * T, (COR.y1 + 1) * T, (COR.x1 - COR.x0 + 1) * T, T); // bas

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log(`OK — map ${NEW_W}x${H}, gym posée (cols ${GYM.oc}-${GYM.oc + GYM.cols - 1}), couloir cols ${COR.x0}-${COR.x1}, firstgids`, fg);
