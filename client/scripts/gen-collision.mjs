// Génère/replace l'object layer "collision" dans default.tmj à partir des
// tuiles solides actuelles (murs + mobilier dont la propriété collides=true).
// Lancement : cd client && node scripts/gen-collision.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mergeCollisionRects } from './collisionRects.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');

const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const W = map.width;
const H = map.height;
const TILE = map.tilewidth;

// 1. gids qui collisionnent (propriété collides=true sur le tileset).
const collides = new Set();
for (const ts of map.tilesets) {
  const first = ts.firstgid;
  for (const t of ts.tiles ?? []) {
    for (const p of t.properties ?? []) {
      if (p.name === 'collides' && p.value) collides.add(first + t.id);
    }
  }
}

// 2. grille solide = tuiles collidantes des couches walls + furniture.
const layerData = (name) => {
  const l = map.layers.find((l) => l.name === name && l.type === 'tilelayer');
  return l ? l.data : null;
};
const walls = layerData('walls');
const furniture = layerData('furniture');
const grid = new Array(W * H).fill(false);
for (let i = 0; i < W * H; i++) {
  const a = walls ? walls[i] : 0;
  const b = furniture ? furniture[i] : 0;
  grid[i] = collides.has(a) || collides.has(b);
}

// 3. fusion en rectangles.
const rects = mergeCollisionRects(grid, W, H, TILE);

// 4. injecter l'object layer "collision" (remplace si déjà présent).
let nextObjId = (map.nextobjectid ?? 1);
const objects = rects.map((r) => ({
  id: nextObjId++,
  name: '',
  type: '',
  x: r.x,
  y: r.y,
  width: r.width,
  height: r.height,
  rotation: 0,
  visible: true,
}));
map.nextobjectid = nextObjId;

const collisionLayer = {
  id: map.nextlayerid ?? map.layers.length + 1,
  name: 'collision',
  type: 'objectgroup',
  draworder: 'index',
  opacity: 1,
  visible: true,
  x: 0,
  y: 0,
  objects,
};
map.nextlayerid = (map.nextlayerid ?? map.layers.length + 1) + 1;

const idx = map.layers.findIndex((l) => l.name === 'collision');
if (idx >= 0) map.layers[idx] = collisionLayer;
else map.layers.push(collisionLayer);

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log(`[gen-collision] ${rects.length} rectangles écrits dans la couche "collision".`);
