// PoC : compose une Réception premium 48x48 directement en PNG (pas de tmj).
// Sheets LimeZu 48px. Blit (sheet,tcol,trow) -> (canvas dcol,drow).
import sharp from 'sharp';
const TS = 48;
const COLS = 13, ROWS = 10;
const W = COLS * TS, H = ROWS * TS;
const DIR = 'public/assets/tilesets48/';

const sheets = {};
async function load(key, file, cols) {
  const img = sharp(DIR + file);
  const m = await img.metadata();
  sheets[key] = { raw: await img.ensureAlpha().raw().toBuffer(), w: m.width, cols: cols || Math.round(m.width / TS) };
}
await load('floor', 'Room_Builder_48x48.png');
await load('off', 'Modern_Office_Black_Shadow_48x48.png');
await load('lr', '2_LivingRoom_Black_Shadow_48x48.png');

const canvas = Buffer.alloc(W * H * 4, 0);
function blit(sheetKey, tcol, trow, dcol, drow) {
  const s = sheets[sheetKey];
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
    const si = ((trow * TS + y) * s.w + (tcol * TS + x)) * 4;
    const a = s.raw[si + 3]; if (a === 0) continue;
    const dx = dcol * TS + x, dy = drow * TS + y;
    if (dx < 0 || dx >= W || dy < 0 || dy >= H) continue;
    const di = (dy * W + dx) * 4;
    const ia = a / 255, na = 1 - ia;
    canvas[di] = s.raw[si] * ia + canvas[di] * na;
    canvas[di + 1] = s.raw[si + 1] * ia + canvas[di + 1] * na;
    canvas[di + 2] = s.raw[si + 2] * ia + canvas[di + 2] * na;
    canvas[di + 3] = Math.max(canvas[di + 3], a);
  }
}
// piece = liste [dc,dr,tcol,trow] ; placée à (mc,mr)
function place(sheetKey, piece, mc, mr) { for (const [dc, dr, tc, tr] of piece) blit(sheetKey, tc, tr, mc + dc, mr + dr); }

// --- 1. parquet bois continu partout (tuile sans joint vertical) ---
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) blit('floor', 17, 11, c, r);

// --- pièces office (mêmes coords qu'en 32px) ---
const P = {
  deskL: [[0, 0, 7, 29]], deskM: [[0, 0, 8, 29]], deskR: [[0, 0, 9, 29]],
  monitor: [[0, 0, 14, 12]], chair: [[0, 0, 0, 9]],
  lsofa: [[0, 0, 2, 17], [1, 0, 3, 17], [2, 0, 4, 17], [0, 1, 2, 18], [1, 1, 3, 18], [2, 1, 4, 18], [2, 2, 4, 19]],
  sofa2: [[0, 0, 0, 17], [1, 0, 1, 17], [0, 1, 0, 18], [1, 1, 1, 18]],
  table: [[0, 0, 6, 18], [1, 0, 7, 18], [0, 1, 6, 19], [1, 1, 7, 19]],
  plant: [[0, 0, 6, 12], [0, 1, 6, 13]],
  frame: [[0, 0, 0, 12], [0, 1, 0, 13]],
};
// petits props office pour densité
P.laptop = [[0, 0, 10, 7]]; P.papers = [[0, 0, 7, 9]]; P.keyboard = [[0, 0, 8, 9]];
P.monBlue = [[0, 0, 13, 12]]; P.plantSm = [[0, 0, 6, 8], [0, 1, 6, 9]];
// pièces living room (footprints vérifiés)
const LR = {
  palm: [[0, 0, 10, 0], [0, 1, 10, 1]],
  armchair: [[0, 0, 2, 5], [1, 0, 3, 5], [0, 1, 2, 6], [1, 1, 3, 6]],   // rotin
  armchair2: [[0, 0, 5, 5], [1, 0, 6, 5], [0, 1, 5, 6], [1, 1, 6, 6]],  // bois
  pouf: [[0, 0, 7, 2], [1, 0, 8, 2], [0, 1, 7, 3], [1, 1, 8, 3]],
  plant: [[0, 0, 0, 5], [0, 1, 0, 6]],
  lamp: [[0, 0, 0, 7]],
};

// --- 2. comptoir d'accueil (haut-centre) + props ---
place('off', P.deskL, 5, 1); place('off', P.deskM, 6, 1); place('off', P.deskR, 7, 1);
place('off', P.monitor, 6, 0); place('off', P.chair, 6, 2);
place('off', P.laptop, 7, 1); place('off', P.papers, 5, 1);

// --- 3. palmiers (coins) + cadres (mur haut) ---
place('lr', LR.palm, 0, 0); place('lr', LR.palm, 11, 0);
place('off', P.frame, 3, 0); place('off', P.frame, 9, 0);

// --- 4. salon gauche : 2 fauteuils (face au sud) + table basse dessous + déco ---
place('lr', LR.armchair, 1, 4); place('lr', LR.armchair2, 3, 4);
place('off', P.table, 2, 6);
place('lr', LR.lamp, 0, 5); place('lr', LR.plant, 5, 5);

// --- 5. salon droit : 2 fauteuils + pouf-table central + palmier ---
place('lr', LR.armchair, 8, 4); place('lr', LR.armchair2, 10, 4);
place('lr', LR.pouf, 9, 6); place('lr', LR.palm, 11, 6);

// --- 6. verdure éparse ---
place('lr', LR.plant, 6, 8); place('lr', LR.plant, 12, 3); place('off', P.plantSm, 0, 8);

await sharp(canvas, { raw: { width: W, height: H, channels: 4 } }).png().toFile('/tmp/poc_reception.png');
console.log(`PoC rendu ${W}x${H} (48px natif)`);
