// Rendu composite PNG de la map (toutes les couches tuiles) pour vérif visuelle.
// Usage: node scripts/render-map.mjs [out.png] [c0 c1 r0 r1]  (région tuiles optionnelle)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const map = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'maps', 'default.tmj'), 'utf8'));
const T = map.tilewidth, W = map.width, H = map.height;
const out = process.argv[2] || '/tmp/map.png';
const [c0, c1, r0, r1] = process.argv.length >= 7
  ? process.argv.slice(3, 7).map(Number) : [0, W - 1, 0, H - 1];
const RW = (c1 - c0 + 1) * T, RH = (r1 - r0 + 1) * T;

// charge chaque tileset en RAW rgba + meta colonnes
const TS = [];
for (const t of map.tilesets) {
  const file = join(__dirname, '..', t.image.replace(/^\.\.\//, 'public/').replace('public/assets', 'public/assets'));
  const path = join(__dirname, '..', 'public', t.image.replace(/^\.\.\//, ''));
  const img = sharp(path);
  const meta = await img.metadata();
  const raw = await img.ensureAlpha().raw().toBuffer();
  TS.push({ firstgid: t.firstgid, tilecount: t.tilecount, cols: Math.round(meta.width / T), w: meta.width, raw });
}
TS.sort((a, b) => a.firstgid - b.firstgid);
const tsOf = (gid) => { let b = null; for (const t of TS) if (gid >= t.firstgid && gid < t.firstgid + t.tilecount) b = t; return b; };

const canvas = Buffer.alloc(RW * RH * 4, 0); // transparent
function blit(ts, local, dcol, drow) {
  const scol = local % ts.cols, srow = Math.floor(local / ts.cols);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const si = ((srow * T + y) * ts.w + (scol * T + x)) * 4;
      const a = ts.raw[si + 3]; if (a === 0) continue;
      const dx = dcol * T + x, dy = drow * T + y;
      const di = (dy * RW + dx) * 4;
      // alpha over
      const ia = a / 255, na = 1 - ia;
      canvas[di] = ts.raw[si] * ia + canvas[di] * na;
      canvas[di + 1] = ts.raw[si + 1] * ia + canvas[di + 1] * na;
      canvas[di + 2] = ts.raw[si + 2] * ia + canvas[di + 2] * na;
      canvas[di + 3] = Math.max(canvas[di + 3], a);
    }
  }
}
for (const l of map.layers) {
  if (l.type !== 'tilelayer' || !Array.isArray(l.data)) continue;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const gid = l.data[r * W + c]; if (!gid) continue;
    const ts = tsOf(gid); if (!ts) continue;
    blit(ts, gid - ts.firstgid, c - c0, r - r0);
  }
}
await sharp(canvas, { raw: { width: RW, height: RH, channels: 4 } }).png().toFile(out);
console.log(`rendu ${out} (${RW}x${RH}, region c${c0}-${c1} r${r0}-${r1})`);
