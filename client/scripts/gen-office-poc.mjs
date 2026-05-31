// Injecte dans default.tmj : les 3 tilesets LimeZu, un layer de sol
// (limezu_floor), un layer mobilier (limezu_test) avec 2 pods, et les
// rectangles de collision des plateaux. Idempotent (supprime ses ajouts
// précédents avant de réinjecter). Lancement : cd client && node scripts/gen-office-poc.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { podTiles, floorPatch, deskCollisionRect, nextFirstgid } from './officePoc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const W = map.width;
const H = map.height;

const NEW_TILESETS = [
  { name: 'room_builder', image: '../assets/tilesets/Room_Builder_Office_32x32.png', imagewidth: 512, imageheight: 448, tilecount: 224 },
  { name: 'office_shadow', image: '../assets/tilesets/Modern_Office_Black_Shadow_32x32.png', imagewidth: 512, imageheight: 1696, tilecount: 848 },
  { name: 'office_shadowless', image: '../assets/tilesets/Modern_Office_Shadowless_32x32.png', imagewidth: 512, imageheight: 1696, tilecount: 848 },
];
const NEW_NAMES = new Set(NEW_TILESETS.map((t) => t.name));
const GEN_LAYERS = new Set(['limezu_floor', 'limezu_test']);

// --- idempotence : on enlève les ajouts d'une exécution précédente ---
map.tilesets = map.tilesets.filter((t) => !NEW_NAMES.has(t.name));
map.layers = map.layers.filter((l) => !GEN_LAYERS.has(l.name));
// nettoie aussi les collisions de pod d'une exécution précédente
for (const l of map.layers) {
  if (l.type === 'objectgroup' && Array.isArray(l.objects)) {
    l.objects = l.objects.filter((o) => o.name !== 'poc_desk');
  }
}

// --- (ré)injection des tilesets avec firstgid enchaînés ---
const firstgids = {};
for (const def of NEW_TILESETS) {
  const firstgid = nextFirstgid(map.tilesets);
  firstgids[def.name] = firstgid;
  map.tilesets.push({
    firstgid,
    name: def.name,
    image: def.image,
    imagewidth: def.imagewidth,
    imageheight: def.imageheight,
    tilewidth: 32,
    tileheight: 32,
    columns: 16,
    tilecount: def.tilecount,
    margin: 0,
    spacing: 0,
  });
}

// --- helper : construit un tilelayer plat WxH à partir de placements ---
function makeTileLayer(name, placements) {
  const data = new Array(W * H).fill(0);
  for (const { col, row, gid } of placements) {
    if (col < 0 || col >= W || row < 0 || row >= H) continue;
    data[row * W + col] = gid;
  }
  return {
    name, type: 'tilelayer', visible: true, opacity: 1,
    x: 0, y: 0, width: W, height: H, data,
  };
}

// --- contenu des 2 pods ---
const PODS = [
  { oc: 29, or: 16, office: 'office_shadow' },
  { oc: 34, or: 16, office: 'office_shadowless' },
];

const floor = [];
const furniture = [];
const collisionRects = [];
for (const p of PODS) {
  floor.push(...floorPatch(p.oc, p.or, firstgids.room_builder));
  furniture.push(...podTiles(p.oc, p.or, firstgids[p.office]));
  collisionRects.push(deskCollisionRect(p.oc, p.or, map.tilewidth));
}

// --- insertion des layers : sol juste après 'ground', mobilier en dernier ---
const floorLayer = makeTileLayer('limezu_floor', floor);
const furnitureLayer = makeTileLayer('limezu_test', furniture);
const groundIdx = map.layers.findIndex((l) => l.name === 'ground');
map.layers.splice(groundIdx + 1, 0, floorLayer); // au-dessus de ground, sous le reste
map.layers.push(furnitureLayer); // tout en haut

// --- collision : on ajoute les rectangles de pods à l'objectgroup existant ---
const coll = map.layers.find((l) => l.name === 'collision' && l.type === 'objectgroup');
let nextId = Math.max(0, ...map.layers.flatMap((l) => (l.objects ?? []).map((o) => o.id ?? 0))) + 1;
for (const r of collisionRects) {
  coll.objects.push({ id: nextId++, name: 'poc_desk', type: '', x: r.x, y: r.y, width: r.width, height: r.height, rotation: 0, visible: true });
}

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log(`OK — ${NEW_TILESETS.length} tilesets, 2 pods, ${collisionRects.length} collisions. firstgids:`, firstgids);
