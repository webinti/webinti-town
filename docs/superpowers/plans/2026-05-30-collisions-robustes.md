# Collisions robustes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la collision par-tuile par une couche de collision dédiée en rectangles (indépendante de l'art), avec un mode debug visuel, pour garantir des collisions inviolables.

**Architecture:** Un script offline génère une object layer `collision` (rectangles fusionnés) dans `default.tmj` à partir des murs/mobilier solides actuels. Au runtime, GameScene lit cette couche, crée un corps statique invisible par rectangle, et un unique collider joueur↔collision. Une touche `C` superpose les rectangles en rouge. Les couches de tuiles redeviennent purement visuelles.

**Tech Stack:** Phaser 3 (Arcade Physics, Tilemaps), TypeScript (runtime), Node ESM `.mjs` (outils offline), vitest (tests).

---

## File Structure

| Fichier | Responsabilité |
|---|---|
| `client/scripts/collisionRects.mjs` | Fonction **pure** : grille booléenne → rectangles fusionnés (px). Aucune dépendance Phaser/IO. |
| `client/scripts/collisionRects.test.mjs` | Tests vitest de la fusion. |
| `client/scripts/gen-collision.mjs` | Offline : lit `default.tmj`, calcule les cellules solides, fusionne, injecte la couche `collision`. |
| `client/src/phaser/collision/CollisionLayer.ts` | Runtime : construit les corps statiques depuis les rectangles + dessine l'overlay debug. |
| `client/src/phaser/scenes/GameScene.ts` | Câblage : lecture de la couche, collider unique, touche `C`, débranchement des collisions par-tuile. |

---

## Task 0: Staging `/v2` (assets base-aware + build v2)

But : permettre de tester sur `live.webinti.com/v2` sans toucher l'app live (servie depuis `client/dist` à la racine). On rend les chemins d'assets relatifs au `BASE_URL`, puis on build la v2 dans le sous-dossier `client/dist/v2/` (servi automatiquement à `/v2` par nginx, sans modif infra). `dist/v2` ne touche jamais les fichiers racine de `dist`.

**Files:**
- Modify: `client/src/phaser/scenes/BootScene.ts`
- Modify: `client/src/react/JoinScreen.tsx`
- Modify: `client/package.json`

- [ ] **Step 1: Rendre les chemins de BootScene base-aware**

Dans `BootScene.ts`, juste après la ligne `const V = ...`, ajouter :

```ts
const BASE = import.meta.env.BASE_URL; // '/' en prod racine, '/v2/' pour la v2
```

Puis remplacer les 8 chemins absolus par des chemins préfixés `${BASE}` (BASE finit par `/`) :

```ts
    this.load.image('tileset_basic', `${BASE}assets/tilesets/basic.png${V}`);
    this.load.tilemapTiledJSON('map_default', `${BASE}maps/default.tmj${V}`);

    this.load.image('kart', `${BASE}assets/karts/kart.png${V}`);

    this.load.spritesheet('layer_body', `${BASE}assets/avatars/body.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_hair', `${BASE}assets/avatars/hair.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_hair_back', `${BASE}assets/avatars/hair_back.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_shirt', `${BASE}assets/avatars/shirt.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
    this.load.spritesheet('layer_pants', `${BASE}assets/avatars/pants.png${V}`, {
      frameWidth: 32,
      frameHeight: 48,
    });
```

- [ ] **Step 2: Rendre les chemins de JoinScreen base-aware**

Dans `JoinScreen.tsx`, remplacer les 5 `backgroundImage` (lignes ~131-163) par des template literals préfixés par `import.meta.env.BASE_URL` :

```tsx
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/hair_back.png')`,
```
```tsx
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/body.png')`,
```
```tsx
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/pants.png')`,
```
```tsx
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/shirt.png')`,
```
```tsx
          backgroundImage: `url('${import.meta.env.BASE_URL}assets/avatars/hair.png')`,
```

- [ ] **Step 3: Ajouter le script build:v2**

Dans `client/package.json`, ajouter dans `"scripts"` :

```json
    "build:v2": "tsc -b && vite build --base=/v2/ --outDir dist/v2 --emptyOutDir",
```

- [ ] **Step 4: Vérifier que le build racine n'est pas cassé (live intact)**

Run: `cd client && npm run build`
Expected: `✓ built` sans erreur (les chemins `${BASE}...` donnent `/assets/...` en build racine).

- [ ] **Step 5: Commit**

```bash
git add client/src/phaser/scenes/BootScene.ts client/src/react/JoinScreen.tsx client/package.json
git commit -m "feat(staging): chemins assets base-aware + script build:v2"
```

---

## Task 1: Fonction pure de fusion en rectangles

**Files:**
- Create: `client/scripts/collisionRects.mjs`
- Test: `client/scripts/collisionRects.test.mjs`

- [ ] **Step 1: Écrire le test qui échoue**

Create `client/scripts/collisionRects.test.mjs`:

```js
import { describe, it, expect } from 'vitest';
import { mergeCollisionRects } from './collisionRects.mjs';

// grid: tableau plat de booléens (length = w*h), true = cellule solide.
const T = 32;

describe('mergeCollisionRects', () => {
  it('grille vide -> aucun rectangle', () => {
    expect(mergeCollisionRects([false, false, false, false], 2, 2, T)).toEqual([]);
  });

  it('cellule isolée -> 1 rectangle 32x32', () => {
    expect(mergeCollisionRects([true], 1, 1, T)).toEqual([
      { x: 0, y: 0, width: 32, height: 32 },
    ]);
  });

  it('ligne horizontale de 3 -> 1 rectangle 96x32', () => {
    expect(mergeCollisionRects([true, true, true], 3, 1, T)).toEqual([
      { x: 0, y: 0, width: 96, height: 32 },
    ]);
  });

  it('colonne verticale de 3 -> 1 rectangle 32x96', () => {
    expect(mergeCollisionRects([true, true, true], 1, 3, T)).toEqual([
      { x: 0, y: 0, width: 32, height: 96 },
    ]);
  });

  it('bloc 2x2 plein -> 1 rectangle 64x64', () => {
    expect(mergeCollisionRects([true, true, true, true], 2, 2, T)).toEqual([
      { x: 0, y: 0, width: 64, height: 64 },
    ]);
  });

  it('deux cellules séparées par un trou -> 2 rectangles', () => {
    // ligne de 3 : solide, vide, solide
    expect(mergeCollisionRects([true, false, true], 3, 1, T)).toEqual([
      { x: 0, y: 0, width: 32, height: 32 },
      { x: 64, y: 0, width: 32, height: 32 },
    ]);
  });
});
```

- [ ] **Step 2: Lancer le test pour vérifier l'échec**

Run: `cd client && npx vitest run scripts/collisionRects.test.mjs`
Expected: FAIL — `Failed to resolve import "./collisionRects.mjs"` (le module n'existe pas encore).

- [ ] **Step 3: Implémenter le module**

Create `client/scripts/collisionRects.mjs`:

```js
/**
 * Fusion gourmande d'une grille de cellules solides en rectangles.
 * Pour chaque cellule solide non encore consommée : on étend au maximum vers
 * la droite (run horizontal), puis on étend ce run vers le bas tant que toutes
 * les cellules de la largeur sont solides et libres. On marque le bloc consommé.
 *
 * @param {boolean[]} grid  tableau plat, length = width*height, indexé y*width+x
 * @param {number} width    nombre de colonnes
 * @param {number} height   nombre de lignes
 * @param {number} tile     taille d'une tuile en pixels
 * @returns {{x:number,y:number,width:number,height:number}[]} rectangles en pixels
 */
export function mergeCollisionRects(grid, width, height, tile) {
  const used = new Array(width * height).fill(false);
  const at = (x, y) => grid[y * width + x] && !used[y * width + x];
  const rects = [];

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      if (!at(x, y)) {
        x++;
        continue;
      }
      // Étendre vers la droite.
      let x2 = x;
      while (x2 < width && at(x2, y)) x2++;
      // Étendre vers le bas : toutes les colonnes [x, x2) doivent être libres.
      let y2 = y + 1;
      for (; y2 < height; y2++) {
        let full = true;
        for (let xx = x; xx < x2; xx++) {
          if (!at(xx, y2)) {
            full = false;
            break;
          }
        }
        if (!full) break;
      }
      // Marquer le bloc consommé.
      for (let yy = y; yy < y2; yy++) {
        for (let xx = x; xx < x2; xx++) {
          used[yy * width + xx] = true;
        }
      }
      rects.push({
        x: x * tile,
        y: y * tile,
        width: (x2 - x) * tile,
        height: (y2 - y) * tile,
      });
      x = x2;
    }
  }
  return rects;
}
```

- [ ] **Step 4: Lancer le test pour vérifier le succès**

Run: `cd client && npx vitest run scripts/collisionRects.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add client/scripts/collisionRects.mjs client/scripts/collisionRects.test.mjs
git commit -m "feat(collisions): fonction pure de fusion grille->rectangles + tests"
```

---

## Task 2: Script de génération de la couche `collision`

**Files:**
- Create: `client/scripts/gen-collision.mjs`
- Modify (généré, pas à la main): `client/public/maps/default.tmj`

- [ ] **Step 1: Écrire le script de génération**

Create `client/scripts/gen-collision.mjs`:

```js
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
```

- [ ] **Step 2: Lancer la génération**

Run: `cd client && node scripts/gen-collision.mjs`
Expected: affiche `[gen-collision] N rectangles écrits dans la couche "collision".` (N entre ~15 et ~60).

- [ ] **Step 3: Vérifier que la couche existe et est cohérente**

Run:
```bash
cd client && node -e "const m=require('./public/maps/default.tmj'); const c=m.layers.find(l=>l.name==='collision'); console.log('type',c.type,'objets',c.objects.length); console.log('exemple',JSON.stringify(c.objects[0]));"
```
Expected: `type objectgroup objets N` et un exemple `{"id":...,"x":...,"y":...,"width":...,"height":...,...}` avec des valeurs multiples de 32.

- [ ] **Step 4: Commit**

```bash
git add client/scripts/gen-collision.mjs client/public/maps/default.tmj
git commit -m "feat(collisions): script de génération + couche collision dans default.tmj"
```

---

## Task 3: Classe runtime CollisionLayer

**Files:**
- Create: `client/src/phaser/collision/CollisionLayer.ts`

- [ ] **Step 1: Écrire la classe**

Create `client/src/phaser/collision/CollisionLayer.ts`:

```ts
import Phaser from 'phaser';

export interface CollisionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Couche de collision dédiée. Construit un corps statique invisible par
 * rectangle (source de vérité unique pour ce qui bloque le joueur) et fournit
 * un overlay debug rouge togglable.
 */
export class CollisionLayer {
  readonly group: Phaser.Physics.Arcade.StaticGroup;
  private readonly scene: Phaser.Scene;
  private readonly rects: CollisionRect[];
  private debugGfx?: Phaser.GameObjects.Graphics;
  private debugOn = false;

  constructor(scene: Phaser.Scene, rects: CollisionRect[]) {
    this.scene = scene;
    this.rects = rects;
    this.group = scene.physics.add.staticGroup();
    for (const r of rects) {
      const rect = scene.add.rectangle(
        r.x + r.width / 2,
        r.y + r.height / 2,
        r.width,
        r.height,
      );
      rect.setVisible(false);
      scene.physics.add.existing(rect, true); // true = corps statique
      this.group.add(rect);
    }
  }

  toggleDebug(): void {
    if (this.debugOn) {
      this.debugOn = false;
      this.debugGfx?.setVisible(false);
      return;
    }
    this.debugOn = true;
    if (!this.debugGfx) this.debugGfx = this.scene.add.graphics().setDepth(1000);
    const g = this.debugGfx;
    g.clear();
    g.fillStyle(0xff0000, 0.35);
    g.lineStyle(1, 0xff0000, 0.9);
    for (const r of this.rects) {
      g.fillRect(r.x, r.y, r.width, r.height);
      g.strokeRect(r.x, r.y, r.width, r.height);
    }
    // Contour des limites du monde (vert).
    const b = this.scene.physics.world.bounds;
    g.lineStyle(2, 0x00ff00, 0.9);
    g.strokeRect(b.x, b.y, b.width, b.height);
    g.setVisible(true);
  }
}
```

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run: `cd client && npx tsc -b`
Expected: aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add client/src/phaser/collision/CollisionLayer.ts
git commit -m "feat(collisions): classe runtime CollisionLayer (corps statiques + overlay debug)"
```

---

## Task 4: Câblage dans GameScene

**Files:**
- Modify: `client/src/phaser/scenes/GameScene.ts`

Contexte des emplacements actuels :
- Déclarations de champs : vers les lignes 48-52 (`wallsLayer`, `furnitureLayer`, `wallsGroup`).
- Boucle de création des couches avec `setCollisionByProperty` : lignes ~401-412 dans `buildTilemap()`.
- Lecture de l'object layer `objects` (panneaux) : lignes ~413-444.
- Ajout des colliders : lignes ~138-146 dans `create()`.

- [ ] **Step 1: Importer CollisionLayer et ajouter le champ**

Add to imports en haut de `GameScene.ts` (à côté des autres imports relatifs) :

```ts
import { CollisionLayer, type CollisionRect } from '../collision/CollisionLayer';
```

Add le champ près des autres déclarations de couches (vers la ligne 50) :

```ts
  private collisionLayer?: CollisionLayer;
```

- [ ] **Step 2: Débrancher la collision par-tuile dans la boucle des couches**

Dans `buildTilemap()`, remplacer le bloc actuel :

```ts
      const name = layerData.name.toLowerCase();
      if (/wall|collide|collision/.test(name)) {
        layer.setCollisionByProperty({ collides: true });
        this.wallsLayer = layer;
      } else if (/furniture/.test(name)) {
        layer.setCollisionByProperty({ collides: true });
        this.furnitureLayer = layer;
      }
```

par (on garde les références pour le fallback legacy, mais on n'active PAS la collision tuile ici) :

```ts
      const name = layerData.name.toLowerCase();
      if (/wall|collide|collision/.test(name)) {
        this.wallsLayer = layer;
      } else if (/furniture/.test(name)) {
        this.furnitureLayer = layer;
      }
```

- [ ] **Step 3: Lire l'object layer `collision` et construire CollisionLayer**

Dans `buildTilemap()`, juste APRÈS la boucle `for (const layerData of map.layers)` et AVANT `const objLayer = map.getObjectLayer('objects');`, insérer :

```ts
    const collObj = map.getObjectLayer('collision');
    if (collObj) {
      const rects: CollisionRect[] = collObj.objects.map((o) => ({
        x: Number(o.x ?? 0),
        y: Number(o.y ?? 0),
        width: Number(o.width ?? 0),
        height: Number(o.height ?? 0),
      }));
      this.collisionLayer = new CollisionLayer(this, rects);
    } else {
      // Legacy : pas de couche dédiée -> collision par propriété de tuile.
      this.wallsLayer?.setCollisionByProperty({ collides: true });
      this.furnitureLayer?.setCollisionByProperty({ collides: true });
    }
```

- [ ] **Step 4: Brancher le collider unique dans create()**

Dans `create()`, remplacer le bloc actuel :

```ts
    if (this.wallsLayer) {
      this.physics.add.collider(this.player.sprite, this.wallsLayer);
    }
    if (this.furnitureLayer) {
      this.physics.add.collider(this.player.sprite, this.furnitureLayer);
    }
    if (this.wallsGroup) {
      this.physics.add.collider(this.player.sprite, this.wallsGroup);
    }
```

par :

```ts
    if (this.collisionLayer) {
      this.physics.add.collider(this.player.sprite, this.collisionLayer.group);
    } else {
      // Legacy / map fallback procédurale.
      if (this.wallsLayer) this.physics.add.collider(this.player.sprite, this.wallsLayer);
      if (this.furnitureLayer) this.physics.add.collider(this.player.sprite, this.furnitureLayer);
      if (this.wallsGroup) this.physics.add.collider(this.player.sprite, this.wallsGroup);
    }
```

- [ ] **Step 5: Ajouter la touche debug `C`**

Dans `create()`, après `this.cameras.main.startFollow(...)` (vers la ligne 167), ajouter :

```ts
    // Mode debug collision : C superpose les rectangles solides en rouge.
    this.input.keyboard?.on('keydown-C', () => {
      if (useGameStore.getState().inputFocused) return;
      this.collisionLayer?.toggleDebug();
    });
```

(`useGameStore` est déjà importé dans GameScene — réutiliser l'import existant.)

- [ ] **Step 6: Compiler**

Run: `cd client && npx tsc -b`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add client/src/phaser/scenes/GameScene.ts
git commit -m "feat(collisions): GameScene utilise la couche collision dédiée + touche debug C"
```

---

## Task 5: Build, vérification manuelle et déploiement

**Files:** aucun (validation).

- [ ] **Step 1: Lancer la suite de tests**

Run: `cd client && npm test`
Expected: tous les tests passent (dont `collisionRects.test.mjs`).

- [ ] **Step 2: Build de la v2 (staging, n'affecte PAS le live)**

Run: `cd client && npm run build:v2`
Expected: `✓ built` sans erreur ; les fichiers vont dans `client/dist/v2/`. Le `dist/` racine (live) reste inchangé.

Vérifier que la v2 a sa propre map avec collisions :
```bash
cd client && node -e "const m=require('./dist/v2/maps/default.tmj'); console.log('collision layer:', !!m.layers.find(l=>l.name==='collision'));"
```
Expected: `collision layer: true`.

- [ ] **Step 3: Vérification manuelle en jeu sur `https://live.webinti.com/v2`** (hard refresh `Ctrl+Shift+R`)

Cocher chaque point :
- [ ] Foncer dans chaque mur → bloqué, pas de traversée.
- [ ] Foncer dans un gros meuble (comptoir cuisine, bureau, canapé) → bloqué.
- [ ] Tenter de sortir de la map par les 4 bords → bloqué (world bounds).
- [ ] Passer par les portes élargies → OK.
- [ ] Monter sur un kart, **boost (Shift)** face à un mur → pas de tunneling.
- [ ] Appuyer sur **`C`** → overlay rouge sur toutes les zones solides + contour vert des limites ; ré-appuyer → disparaît.
- [ ] Vérifier qu'aucun **petit déco** censé être traversable ne bloque ; sinon, noter sa position pour retrait (édition manuelle des rectangles ou exclusion de gid dans gen-collision).

- [ ] **Step 4: Ajustements éventuels**

Si des collisions sont à corriger (manque/excès), éditer les rectangles concernés dans la couche `collision` de `default.tmj` (ou ajuster la liste de gids solides dans `gen-collision.mjs` puis régénérer), rebuild, re-vérifier. Commit :

```bash
git add client/public/maps/default.tmj
git commit -m "fix(collisions): ajustement des rectangles après vérification en jeu"
```

- [ ] **Step 5 (optionnel) : Promotion en prod**

Une fois validé sur `/v2`, promouvoir vers le live avec un build racine :

Run: `cd client && npm run build`

Cela régénère `client/dist` (racine) que nginx sert sur `/`. Pas de redémarrage backend nécessaire. **Confirmer avec l'utilisateur avant de promouvoir.**

---

## Notes de réglage (phase A → phase B)

- La couche `collision` est **indépendante de l'art** : au passage au tileset premium (phase B), on conserve/ajuste les rectangles au lieu de tout refaire.
- Pour exclure un petit déco du blocage : soit retirer son rectangle à la main, soit l'exclure de la grille solide dans `gen-collision.mjs`.
- La fonction de fusion est testée unitairement ; la génération et le runtime se valident en jeu via le mode debug `C`.
