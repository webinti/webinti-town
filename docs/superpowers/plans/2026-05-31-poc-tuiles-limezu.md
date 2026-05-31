# POC tuiles LimeZu — Bureau test « façon Gather » — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher deux « pods » de bureau LimeZu (avec / sans ombre) près du spawn open space, en levant la limite mono-tileset de `GameScene`, pour valider sur `/v2` la pipeline d'intégration des tuiles LimeZu.

**Architecture:** Un module pur (`officePoc.mjs`) calcule les `firstgid` et génère les placements de tuiles d'un pod ; un script de génération (`gen-office-poc.mjs`) écrit les tilesets, les layers et les rectangles de collision dans `default.tmj` ; `BootScene` charge les 3 sheets LimeZu ; `GameScene.buildTilemap()` est généralisé pour binder N tilesets au lieu d'un seul.

**Tech Stack:** TypeScript, Phaser 3, Vite, Node ESM (`.mjs`), Vitest. Tuiles 32×32 LimeZu Modern Office.

**Spec :** `docs/superpowers/specs/2026-05-31-poc-tuiles-limezu-design.md`

---

## Données de référence (mesurées / observées)

Sheets copiés dans `client/public/assets/tilesets/` :

| Sheet (nom tmj) | Fichier | Dimensions | cols × lignes | tilecount |
|-----------------|---------|-----------|---------------|-----------|
| `room_builder` | `Room_Builder_Office_32x32.png` | 512×448 | 16 × 14 | 224 |
| `office_shadow` | `Modern_Office_Black_Shadow_32x32.png` | 512×1696 | 16 × 53 | 848 |
| `office_shadowless` | `Modern_Office_Shadowless_32x32.png` | 512×1696 | 16 × 53 | 848 |

Tileset existant : `basic` (firstgid 1, 256 tuiles) → gids 1..256. **Prochain firstgid = 257.**

Firstgid attribués (dans cet ordre) :
- `room_builder` : **257** (224 tuiles → 257..480)
- `office_shadow` : **481** (848 tuiles → 481..1328)
- `office_shadowless` : **1329** (848 tuiles → 1329..2176)

`localId(col, row) = row * 16 + col` ; `gid = firstgid + localId`.

Tuiles choisies (col, row) — **identifiées visuellement, ajustables à l'étape 5** :

| Élément | Sheet | (col,row) | localId |
|---------|-------|-----------|---------|
| Sol gris bureau | room_builder | (10,5) | 90 |
| Bureau arrière gauche | office | (4,17) | 276 |
| Bureau arrière droit | office | (5,17) | 277 |
| Bureau avant gauche | office | (4,18) | 292 |
| Bureau avant droit | office | (5,18) | 293 |
| Écran (face) | office | (13,8) | 141 |
| Chaise (dos, vue de haut) | office | (0,8) | 128 |
| Plante haut | office | (5,7) | 117 |
| Plante bas | office | (5,8) | 133 |

Disposition d'un pod (layer unique, tuiles non superposées), origine `(oc, or)` = coin haut-gauche :

```
ligne or   : [écran ]  .                      (oc, or)
ligne or+1 : [deskBL] [deskBR]   [planteHaut] (oc..oc+1, or+1 ; plante oc+2)
ligne or+2 : [deskFL] [deskFR]   [planteBas]  (oc..oc+1, or+2 ; plante oc+2)
ligne or+3 : [chaise]  .                       (oc, or+3 ; perso s'assoit ici, face au nord)
```

Patch de sol : rectangle `(oc-1, or-1)` → `(oc+3, or+4)` (5 cols × 6 lignes) sous le pod.
Rectangle de collision (plateau bureau) : `x=oc*32, y=(or+1)*32, w=64, h=64`.

Placement sur la map (60×42) — spawn open space = tuile (32,15) :
- **POD A (office_shadow)** origine `(29, 14)`
- **POD B (office_shadowless)** origine `(34, 14)`

---

## Task 1 : Module pur `officePoc.mjs` (logique tuiles/gid/pod)

**Files:**
- Create: `client/scripts/officePoc.mjs`
- Test: `client/scripts/officePoc.test.mjs`

- [ ] **Step 1 : Écrire le test qui échoue**

Create `client/scripts/officePoc.test.mjs` :
```js
import { describe, it, expect } from 'vitest';
import { localId, podTiles, floorPatch, nextFirstgid } from './officePoc.mjs';

describe('localId', () => {
  it('convertit (col,row) en index local (16 colonnes)', () => {
    expect(localId(0, 0)).toBe(0);
    expect(localId(4, 17)).toBe(276);
    expect(localId(10, 5)).toBe(90);
  });
});

describe('nextFirstgid', () => {
  it('renvoie firstgid + tilecount du dernier tileset', () => {
    expect(nextFirstgid([{ firstgid: 1, tilecount: 256 }])).toBe(257);
    expect(nextFirstgid([
      { firstgid: 1, tilecount: 256 },
      { firstgid: 257, tilecount: 224 },
    ])).toBe(481);
  });
});

describe('podTiles', () => {
  const FG = { office: 481 };
  it('place écran/bureau/chaise/plante aux bons (col,row) avec les bons gid', () => {
    const tiles = podTiles(29, 14, FG.office);
    // écran à (29,14) gid 481+141
    expect(tiles).toContainEqual({ col: 29, row: 14, gid: 622 });
    // bureau arrière gauche (29,15) gid 481+276
    expect(tiles).toContainEqual({ col: 29, row: 15, gid: 757 });
    // bureau arrière droit (30,15) gid 481+277
    expect(tiles).toContainEqual({ col: 30, row: 15, gid: 758 });
    // bureau avant gauche (29,16) gid 481+292
    expect(tiles).toContainEqual({ col: 29, row: 16, gid: 773 });
    // bureau avant droit (30,16) gid 481+293
    expect(tiles).toContainEqual({ col: 30, row: 16, gid: 774 });
    // chaise (29,17) gid 481+128
    expect(tiles).toContainEqual({ col: 29, row: 17, gid: 609 });
    // plante haut (31,15) gid 481+117 ; bas (31,16) gid 481+133
    expect(tiles).toContainEqual({ col: 31, row: 15, gid: 598 });
    expect(tiles).toContainEqual({ col: 31, row: 16, gid: 614 });
  });
  it('ne superpose aucune tuile (couples col,row uniques)', () => {
    const tiles = podTiles(29, 14, FG.office);
    const keys = tiles.map((t) => `${t.col},${t.row}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('floorPatch', () => {
  it('remplit un rectangle 5x6 autour de l’origine avec le gid de sol', () => {
    const tiles = floorPatch(29, 14, 257); // room_builder firstgid 257, sol localId 90
    expect(tiles.length).toBe(5 * 6);
    expect(tiles).toContainEqual({ col: 28, row: 13, gid: 347 });
    expect(tiles).toContainEqual({ col: 32, row: 18, gid: 347 });
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `cd client && npx vitest run scripts/officePoc.test.mjs`
Expected: FAIL — `Failed to resolve import "./officePoc.mjs"`.

- [ ] **Step 3 : Écrire l'implémentation minimale**

Create `client/scripts/officePoc.mjs` :
```js
// Logique pure de placement des tuiles LimeZu pour le POC bureau.
// Aucune I/O : testable unitairement (cf. officePoc.test.mjs).

const COLS = 16; // toutes les sheets LimeZu utilisées font 16 colonnes.

export function localId(col, row) {
  return row * COLS + col;
}

export function nextFirstgid(tilesets) {
  const last = tilesets[tilesets.length - 1];
  return last.firstgid + last.tilecount;
}

// Coordonnées (col,row) des tuiles dans la sheet office, identifiées visuellement.
const T = {
  monitor: [13, 8],
  deskBackL: [4, 17],
  deskBackR: [5, 17],
  deskFrontL: [4, 18],
  deskFrontR: [5, 18],
  chair: [0, 8],
  plantTop: [5, 7],
  plantBot: [5, 8],
};
const FLOOR = [10, 5]; // sol room_builder

// Génère les placements d'un pod, origine (oc,or) = coin haut-gauche.
export function podTiles(oc, or, officeFirstgid) {
  const g = (coord) => officeFirstgid + localId(coord[0], coord[1]);
  return [
    { col: oc, row: or, gid: g(T.monitor) },
    { col: oc, row: or + 1, gid: g(T.deskBackL) },
    { col: oc + 1, row: or + 1, gid: g(T.deskBackR) },
    { col: oc, row: or + 2, gid: g(T.deskFrontL) },
    { col: oc + 1, row: or + 2, gid: g(T.deskFrontR) },
    { col: oc, row: or + 3, gid: g(T.chair) },
    { col: oc + 2, row: or + 1, gid: g(T.plantTop) },
    { col: oc + 2, row: or + 2, gid: g(T.plantBot) },
  ];
}

// Patch de sol 5x6 autour de l'origine (déborde d'1 tuile autour du pod).
export function floorPatch(oc, or, roomBuilderFirstgid) {
  const gid = roomBuilderFirstgid + localId(FLOOR[0], FLOOR[1]);
  const tiles = [];
  for (let dy = -1; dy <= 4; dy++) {
    for (let dx = -1; dx <= 3; dx++) {
      tiles.push({ col: oc + dx, row: or + dy, gid });
    }
  }
  return tiles;
}

// Rectangle de collision du plateau (2x2 sous l'écran).
export function deskCollisionRect(oc, or, tile = 32) {
  return { x: oc * tile, y: (or + 1) * tile, width: 2 * tile, height: 2 * tile };
}
```

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run: `cd client && npx vitest run scripts/officePoc.test.mjs`
Expected: PASS (tous les `describe` verts).

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/scripts/officePoc.mjs client/scripts/officePoc.test.mjs
git commit -m "feat(poc-limezu): module pur placement tuiles pod bureau + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 : Script de génération `gen-office-poc.mjs` (écrit default.tmj)

**Files:**
- Create: `client/scripts/gen-office-poc.mjs`
- Modify: `client/public/maps/default.tmj` (via exécution du script)

- [ ] **Step 1 : Écrire le script**

Create `client/scripts/gen-office-poc.mjs` :
```js
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
  { oc: 29, or: 14, office: 'office_shadow' },
  { oc: 34, or: 14, office: 'office_shadowless' },
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
```

- [ ] **Step 2 : Lancer le script**

Run: `cd client && node scripts/gen-office-poc.mjs`
Expected: `OK — 3 tilesets, 2 pods, 2 collisions. firstgids: { room_builder: 257, office_shadow: 481, office_shadowless: 1329 }`

- [ ] **Step 3 : Vérifier le tmj produit**

Run:
```bash
cd /home/openclaw/projects/webinti-town
python3 -c "
import json
m=json.load(open('client/public/maps/default.tmj'))
print('tilesets:', [(t['name'],t['firstgid']) for t in m['tilesets']])
print('layers:', [l['name'] for l in m['layers']])
fl=[l for l in m['layers'] if l['name']=='limezu_test'][0]
print('tuiles non nulles dans limezu_test:', sum(1 for v in fl['data'] if v))
co=[l for l in m['layers'] if l['name']=='collision'][0]
print('collisions poc_desk:', sum(1 for o in co['objects'] if o.get('name')=='poc_desk'))
"
```
Expected: tilesets incluent `room_builder/office_shadow/office_shadowless` aux firstgid 257/481/1329 ; layers incluent `limezu_floor` et `limezu_test` ; 16 tuiles non nulles (2 pods × 8) ; 2 collisions `poc_desk`.

- [ ] **Step 4 : Vérifier la rétro-compat (tilemap toujours valide)**

Run: `cd client && node -e "JSON.parse(require('fs').readFileSync('public/maps/default.tmj','utf8')); console.log('JSON valide')"`
Expected: `JSON valide`

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/scripts/gen-office-poc.mjs client/public/maps/default.tmj client/public/assets/tilesets/*.png
git commit -m "feat(poc-limezu): script génération pods + tilesets/layers/collisions dans default.tmj

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 : `BootScene` charge les 3 sheets LimeZu

**Files:**
- Modify: `client/src/phaser/scenes/BootScene.ts:21` (après le chargement de `tileset_basic`)

- [ ] **Step 1 : Ajouter les chargements d'images**

Dans `BootScene.preload()`, juste après la ligne `this.load.image('tileset_basic', ...)`, ajouter :
```ts
    // POC LimeZu — tilesets Modern Office (32x32). Clé = `tileset_<nom tmj>`.
    this.load.image('tileset_room_builder', `${BASE}assets/tilesets/Room_Builder_Office_32x32.png${V}`);
    this.load.image('tileset_office_shadow', `${BASE}assets/tilesets/Modern_Office_Black_Shadow_32x32.png${V}`);
    this.load.image('tileset_office_shadowless', `${BASE}assets/tilesets/Modern_Office_Shadowless_32x32.png${V}`);
```

- [ ] **Step 2 : Vérifier la compilation TS**

Run: `cd client && npx tsc -b`
Expected: aucune erreur.

- [ ] **Step 3 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/phaser/scenes/BootScene.ts
git commit -m "feat(poc-limezu): BootScene charge les 3 sheets LimeZu Modern Office

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 : `GameScene.buildTilemap()` multi-tilesets (déblocage clé)

**Files:**
- Modify: `client/src/phaser/scenes/GameScene.ts:403-410`

- [ ] **Step 1 : Remplacer le binding mono-tileset par N tilesets**

Dans `GameScene.buildTilemap()`, remplacer ce bloc :
```ts
    const tilesetName = map.tilesets[0]?.name ?? 'basic';
    const tileset = map.addTilesetImage(tilesetName, 'tileset_basic');
    if (!tileset) {
      this.buildFallbackMap();
      return;
    }
    for (const layerData of map.layers) {
      const layer = map.createLayer(layerData.name, tileset, 0, 0);
```
par :
```ts
    // Chaque tileset du .tmj est bindé à la clé image `tileset_<nom>`
    // (convention : voir BootScene). Rétro-compatible : basic -> tileset_basic.
    const tilesets = map.tilesets
      .map((ts) => map.addTilesetImage(ts.name, `tileset_${ts.name}`))
      .filter((t): t is Phaser.Tilemaps.Tileset => t !== null);
    if (tilesets.length === 0) {
      this.buildFallbackMap();
      return;
    }
    for (const layerData of map.layers) {
      const layer = map.createLayer(layerData.name, tilesets, 0, 0);
```

- [ ] **Step 2 : Vérifier la compilation TS**

Run: `cd client && npx tsc -b`
Expected: aucune erreur (le typage `Phaser.Tilemaps.Tileset` est correct).

- [ ] **Step 3 : Lancer toute la suite de tests (non-régression)**

Run: `cd client && npm test`
Expected: tous les tests passent (collisionRects, officePoc, screenViewerMath, etc.).

- [ ] **Step 4 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/phaser/scenes/GameScene.ts
git commit -m "feat(poc-limezu): GameScene binde N tilesets (déblocage multi-tilesets)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5 : Build `/v2`, déploiement, vérification visuelle & tuning

**Files:**
- Aucun fichier source modifié par défaut (sauf tuning des constantes en cas d'écart visuel).

- [ ] **Step 1 : Build `/v2`**

Run: `cd client && npm run build:v2`
Expected: build réussi, sortie dans `client/dist/v2/`.

- [ ] **Step 2 : Déployer sur `live.webinti.com/v2`**

Suivre la procédure de déploiement habituelle du projet (build base-aware `/v2` puis publication ; cf. memory `project_prod_deploy` — build + restart, prod intouchée). Ne PAS toucher la prod racine.

- [ ] **Step 3 : Vérification visuelle (manuelle, par le user)**

Ouvrir `https://live.webinti.com/v2`, spawn open space, marcher jusqu'aux pods. Vérifier les critères de succès du spec :
- Les 2 pods s'affichent **nets** (pas de flou) sur un patch de sol LimeZu.
- POD A (avec ombre) vs POD B (sans ombre) côte à côte, comparables à la capture Gather.
- Le perso **ne traverse pas** le plateau des bureaux ; la chaise reste franchissable.
- Aucune régression sur l'affichage des tuiles `basic` existantes.

- [ ] **Step 4 : Tuning si écart visuel (boucle rapide)**

Si une tuile est mauvaise (mauvais meuble, mauvaise orientation, plante absente, etc.) :
1. Régénérer une grille annotée pour repérer la bonne tuile :
   `cd client && cp <script annotate> _annotate.mjs && node _annotate.mjs && rm _annotate.mjs`
   (ou réutiliser `/tmp/office_rows*.png`).
2. Ajuster les constantes `T` / `FLOOR` dans `client/scripts/officePoc.mjs`.
3. `cd client && node scripts/gen-office-poc.mjs && npm run build:v2`, redéployer, revérifier.
4. Répéter jusqu'à validation du rendu.

- [ ] **Step 5 : Commit final (état validé)**

```bash
cd /home/openclaw/projects/webinti-town
git add -A
git commit -m "feat(poc-limezu): pods bureau LimeZu validés sur /v2 (style à trancher par le user)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Auto-revue (couverture spec)

- ✅ Pipeline multi-tilesets réutilisable → Task 3 (BootScene) + Task 4 (GameScene).
- ✅ Assets 32×32 extraits → sheets déjà copiés (Task 2 commit les inclut).
- ✅ 2 pods façon Gather + patch de sol → Task 1 (`podTiles`/`floorPatch`) + Task 2.
- ✅ Collision plateau, chaise franchissable → Task 1 (`deskCollisionRect`, chaise hors rect) + Task 2.
- ✅ Script de génération idempotent → Task 2.
- ✅ Déploiement `/v2`, prod intouchée → Task 5.
- ✅ Validation style par le user → Task 5 Step 3.
- ⚠️ Licence LimeZu (usage commercial) : à vérifier avant promotion prod, hors périmètre POC `/v2` (noté dans le spec).

## Note de risque

Les indices de tuiles (Task 1, constantes `T`/`FLOOR`) sont des estimations visuelles fiables mais non garanties au pixel près sur un sheet de 848 tuiles. La Task 5 Step 4 est la boucle de correction prévue : c'est par construction un POC « voir puis ajuster ». Le `firstgid` est calculé automatiquement (pas de risque de décalage manuel).
