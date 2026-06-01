// Réception premium (32px) : ajoute les tilesets LivingRoom + grand Room_Builder
// à la map, pose un parquet bois sur la partie lounge (hors garage), et place des
// meubles cosy (fauteuils rotin, pouf, palmiers, plantes) autour du tapis.
// Retire le vieux sofa basic. Idempotent.
// Lancement : cd client && node scripts/gen-reception.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const W = map.width;

// --- ajoute un tileset s'il manque, retourne son firstgid ---
function ensureTileset(name, image, imgW, imgH) {
  let t = map.tilesets.find((x) => x.name === name);
  if (t) return t;
  const cols = Math.round(imgW / 32);
  const rows = Math.round(imgH / 32);
  const firstgid = Math.max(...map.tilesets.map((x) => x.firstgid + x.tilecount));
  t = { name, image, firstgid, tilewidth: 32, tileheight: 32, columns: cols, tilecount: cols * rows, imagewidth: imgW, imageheight: imgH, margin: 0, spacing: 0 };
  map.tilesets.push(t);
  return t;
}

const rbBig = ensureTileset('room_builder_big', '../assets/tilesets/Room_Builder_32x32.png', 2432, 3616); // 76x113
const lr = ensureTileset('livingroom', '../assets/tilesets/2_LivingRoom_Black_Shadow_32x32.png', 512, 1440); // 16x45
const office = map.tilesets.find((t) => t.name === 'office_shadow');

// GID helper par tileset (tient compte du nb de colonnes propre à chaque sheet)
const gid = (t, col, row) => t.firstgid + row * t.columns + col;

const layer = (name) => map.layers.find((l) => l.name === name && l.type === 'tilelayer');
const floor = layer('limezu_floor');
const furn = layer('furniture');
const deco = layer('decoration');
const set = (L, c, r, g) => { if (c >= 0 && c < W && r >= 0 && r < map.height) L.data[r * W + c] = g; };
// place une pièce = liste [dc,dr,col,row] depuis un tileset, à l'ancre (mc,mr)
const place = (L, t, piece, mc, mr) => { for (const [dc, dr, col, row] of piece) set(L, mc + dc, mr + dr, gid(t, col, row)); };

// ---------- 1. parquet bois sur le lounge (réception hors garage) ----------
const WOOD = gid(rbBig, 17, 11); // parquet bois continu (validé au PoC)
// réception intérieure = cols 1-14, lignes 11-21 ; garage = cols 1-8 lignes 11-14
for (let r = 11; r <= 21; r++)
  for (let c = 1; c <= 14; c++) {
    const inGarage = c >= 1 && c <= 8 && r >= 11 && r <= 14;
    if (!inGarage) set(floor, c, r, WOOD);
  }

// ---------- 2. retire le vieux sofa basic + petits objets à remplacer ----------
for (const [c, r] of [[3, 18], [4, 18], [5, 18], [4, 19], [11, 20], [12, 20]]) furn.data[r * W + c] = 0;

// ---------- 3. meubles cosy LivingRoom autour du tapis (tapis = 8-9 x 18-19) ----------
const LR = {
  armchair: [[0, 0, 2, 5], [1, 0, 3, 5], [0, 1, 2, 6], [1, 1, 3, 6]], // fauteuil rotin (face sud)
  armchair2: [[0, 0, 5, 5], [1, 0, 6, 5], [0, 1, 5, 6], [1, 1, 6, 6]], // fauteuil bois
  pouf: [[0, 0, 7, 2], [1, 0, 8, 2], [0, 1, 7, 3], [1, 1, 8, 3]],      // pouf capitonné
  palm: [[0, 0, 10, 0], [0, 1, 10, 1]],                               // palmier
  plant: [[0, 0, 0, 5], [0, 1, 0, 6]],                                // succulente
  lamp: [[0, 0, 0, 7]],                                               // lampe sur pied
};
// cluster salon : 2 fauteuils encadrant le tapis + pouf-table en dessous
place(furn, lr, LR.armchair, 6, 18);   // fauteuil gauche du tapis
place(furn, lr, LR.armchair2, 10, 18); // fauteuil droit du tapis
place(furn, lr, LR.pouf, 8, 20);       // pouf central sous le tapis
// palmiers dans les coins bas
place(furn, lr, LR.palm, 1, 20);
place(furn, lr, LR.palm, 13, 20);
// déco
place(furn, lr, LR.lamp, 2, 17);
place(furn, lr, LR.plant, 13, 17);

// ---------- 4. cadres office au mur haut de l'entrée (déco) ----------
const OF = { frame: [[0, 0, 0, 12], [0, 1, 0, 13]] };
place(deco, office, OF.frame, 10, 11);
place(deco, office, OF.frame, 13, 11);

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log('OK — Réception premium : parquet bois + LivingRoom (fauteuils/pouf/palmiers), sofa basic retiré');
