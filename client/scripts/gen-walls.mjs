// Convertit les murs brique (basic) de l'office en murs LimeZu propres (bloc plein
// room_builder), en préservant les tuiles de porte/ouverture. Idempotent.
// Lancement : cd client && node scripts/gen-walls.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { localId } from './officePoc.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, '..', 'public', 'maps', 'default.tmj');
const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
const W = map.width;

const basic = map.tilesets.find((t) => t.name === 'basic').firstgid;
const room = map.tilesets.find((t) => t.name === 'room_builder').firstgid;

// Tuiles à PRÉSERVER dans la couche walls (portes/ouvertures basic col14,row2).
const DOOR_GID = basic + localId(14, 2); // gid 47
const KEEP = new Set([DOOR_GID]);

// Mur cible : bloc plein navy LimeZu (room_builder col8,row0) — déjà utilisé par la gym.
const WALL_GID = room + localId(8, 0); // gid 265

const walls = map.layers.find((l) => l.name === 'walls' && l.type === 'tilelayer');
let converted = 0, kept = 0;
for (let i = 0; i < walls.data.length; i++) {
  const g = walls.data[i];
  if (!g) continue;
  if (KEEP.has(g)) { kept++; continue; }
  if (g !== WALL_GID) converted++;
  walls.data[i] = WALL_GID;
}

writeFileSync(MAP_PATH, JSON.stringify(map));
console.log(`OK — murs LimeZu : ${converted} tuiles converties -> gid ${WALL_GID}, ${kept} portes préservées (gid ${DOOR_GID})`);
