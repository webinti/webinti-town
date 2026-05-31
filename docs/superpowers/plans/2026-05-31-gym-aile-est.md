# Gym — Aile est — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Agrandir la map vers l'est et y poser la grande gym pré-faite LimeZu (19×15) reliée par un couloir, en restant 100% tilemap-natif.

**Architecture:** Une fonction pure ré-indexe la data des tilelayers quand on élargit la map (testée TDD). Un script de génération élargit `default.tmj`, enregistre les 2 couches de design gym comme tilesets, pose gym + couloir, ouvre le mur est et ajoute les collisions. `GameScene` (déjà multi-tilesets) étend automatiquement monde/caméra via `mapW`.

**Tech Stack:** Node ESM, Vitest, Phaser 3 (tilemap). Aucune nouvelle dépendance.

**Spec :** `docs/superpowers/specs/2026-05-31-gym-aile-est-design.md`

## Constantes de placement
- Map : 60×42 → **84×42** (+24 cols).
- Gym design : 19×15, tileset columns=19, tilecount=285.
- Gym bloc : cols **64-82**, lignes **9-23**.
- Couloir : cols **60-63**, lignes **15-16**.
- Ouverture mur est : col 59 (rect collision actuel `x=1888 y=352 w=32 h=992`) → scinder en
  deux (au-dessus ligne 15 et en-dessous ligne 16).
- Firstgid : calcul auto après le dernier tileset (cf. `nextFirstgid`).

---

## Task 1 : Fonction pure de ré-indexation largeur + tests

**Files:**
- Create: `client/scripts/mapResize.mjs`
- Test: `client/scripts/mapResize.test.mjs`

- [ ] **Step 1 : test qui échoue**
```js
import { describe, it, expect } from 'vitest';
import { widenRow, widenData } from './mapResize.mjs';

describe('widenData', () => {
  it('élargit une grille 2x2 -> 4x2 en complétant de 0 à droite', () => {
    // data row-major [r0c0,r0c1, r1c0,r1c1]
    const out = widenData([1, 2, 3, 4], 2, 2, 4);
    expect(out).toEqual([1, 2, 0, 0, 3, 4, 0, 0]);
  });
  it('conserve la longueur newW*H', () => {
    expect(widenData([1, 2, 3, 4], 2, 2, 5).length).toBe(10);
  });
  it('widenRow complète une ligne', () => {
    expect(widenRow([7, 8], 4)).toEqual([7, 8, 0, 0]);
  });
});
```

- [ ] **Step 2 : lancer → échec**
Run: `cd client && npx vitest run scripts/mapResize.test.mjs` → FAIL (module absent).

- [ ] **Step 3 : implémentation**
```js
// Élargissement pur de la data d'une couche tuiles (row-major) : on garde les
// W premières colonnes de chaque ligne, on complète à droite par des 0 jusqu'à newW.
export function widenRow(row, newW) {
  const out = row.slice(0, newW);
  while (out.length < newW) out.push(0);
  return out;
}

export function widenData(data, W, H, newW) {
  const out = [];
  for (let y = 0; y < H; y++) {
    const row = data.slice(y * W, y * W + W);
    out.push(...widenRow(row, newW));
  }
  return out;
}
```

- [ ] **Step 4 : lancer → succès**
Run: `cd client && npx vitest run scripts/mapResize.test.mjs` → PASS.

- [ ] **Step 5 : commit**
```bash
cd /home/openclaw/projects/webinti-town
git add client/scripts/mapResize.mjs client/scripts/mapResize.test.mjs
git commit -m "feat(gym): fonction pure ré-indexation largeur map + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 : Script gen-gym.mjs (élargit map + pose gym + couloir + collisions)

**Files:**
- Create: `client/scripts/gen-gym.mjs`
- Modify: `client/public/maps/default.tmj` (via exécution)

- [ ] **Step 1 : écrire le script**
Le script (idempotent) :
1. Charge `default.tmj`. Si `map.width >= 84`, considère déjà élargi → re-applique proprement
   (idempotence : retirer tilesets `gym_floor/gym_equip`, couches `gym_floor/gym_equip/gym_corridor`,
   collisions `name=='gym'`, puis re-poser ; repartir de width=60 mémorisé via un champ
   `map.properties` `baseWidth`=60).
2. Élargit : `newW=84`. Pour chaque tilelayer : `data = widenData(data, W, 84)`, `width=84`.
   Met `map.width=84`.
3. Enregistre tilesets `gym_floor` (Gym_layer_1_32x32.png, cols 19, 285 tuiles) et `gym_equip`
   (Gym_layer_2_32x32.png, idem), firstgid via `nextFirstgid`.
4. Pose le bloc gym (cols 64-82, lignes 9-23) : couche `gym_floor` = gids `fg_floor+0..284` en
   ordre ligne par ligne ; couche `gym_equip` = `fg_equip+0..284`.
5. Couloir : couche `gym_corridor` — sol Room Builder (gid sol = `room_builder` firstgid + 90)
   sur cols 60-63 lignes 15-16 ; + tuiles mur Room Builder au-dessus (ligne 14) et en dessous
   (ligne 17) du couloir.
6. Ouverture mur est : dans `collision`, trouver le rect `x=1888,y=352,h=992` et le remplacer
   par deux rects : `y=352..480` (au-dessus ligne 15) et `y=544..1344` (en-dessous ligne 16).
7. Collisions gym (`name='gym'`) : périmètre du bloc gym (4 murs) + couloir (murs haut/bas).
   (Équipements internes : ajoutés en itération après vérif visuelle — pas bloquant.)
8. `writeFileSync` minifié.

(Le code complet réutilise `widenData`, `nextFirstgid`, et un helper `placeBlock(layer, oc, or, cols, firstgid, n)`.)

- [ ] **Step 2 : exécuter**
Run: `cd client && node scripts/gen-gym.mjs`
Expected: log `OK — map 84x42, gym posée (cols 64-82), couloir, collisions`.

- [ ] **Step 3 : vérifs structurelles**
Run python : map.width==84 ; toutes tilelayers width==84 et len(data)==84*42 ; tilesets incluent
`gym_floor/gym_equip` ; couches `gym_floor/gym_equip/gym_corridor` présentes ; collision a des
objets `name=='gym'`. JSON valide.

- [ ] **Step 4 : commit**
```bash
git add client/scripts/gen-gym.mjs client/public/maps/default.tmj client/public/assets/tilesets/Gym_layer_*.png
git commit -m "feat(gym): script génération aile gym (map 84x42 + design + couloir + collisions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 : BootScene charge les tilesets gym

**Files:** Modify `client/src/phaser/scenes/BootScene.ts`

- [ ] **Step 1 : ajouter les chargements** (après les tilesets office) :
```ts
    this.load.image('tileset_gym_floor', `${BASE}assets/tilesets/Gym_layer_1_32x32.png${V}`);
    this.load.image('tileset_gym_equip', `${BASE}assets/tilesets/Gym_layer_2_32x32.png${V}`);
```
- [ ] **Step 2 : tsc** → `cd client && npx tsc -b` (0 erreur).
- [ ] **Step 3 : commit**
```bash
git add client/src/phaser/scenes/BootScene.ts
git commit -m "feat(gym): BootScene charge les tilesets de design gym"
```

---

## Task 4 : Build /v2 + vérification headless + tuning

- [ ] **Step 1 : tests complets** `cd client && npm test` (tous verts).
- [ ] **Step 2 : build /v2** `cd client && npm run build:v2`.
- [ ] **Step 3 : vérif headless** : playwright-core (chromium cache), rejoindre, marcher vers
  l'est (ArrowRight) jusqu'au couloir/gym, screenshoter. Vérifier : 0 erreur console, gym affichée
  pixel-perfect, couloir accessible, collisions OK. Capturer un crop de la gym.
- [ ] **Step 4 : tuning** si décalage gym (ordre gids/columns) ou couloir mal aligné → ajuster
  constantes dans `gen-gym.mjs`, re-générer, re-build, re-vérifier.
- [ ] **Step 5 : vérif user sur /v2** + commit final éventuel.

---

## Task 5 (suivi, hors 1er jet) : porte animée + collisions équipements
- Porte animée à l'entrée gym (spritesheet `animated_door`, anim Phaser, ouverture à l'approche).
- Collisions fines des gros équipements internes (machines/racks) après vérif visuelle.
(Documenté ici pour mémoire ; livré en itération après validation du 1er jet.)

## Auto-revue
- ✅ Agrandissement + ré-index → Task 1 (pur, testé) + Task 2.
- ✅ Gym pixel-perfect (tilesets design) → Task 2 + Task 3.
- ✅ Couloir + ouverture mur → Task 2.
- ✅ Monde/caméra auto (mapW) → aucun code (Task 4 vérifie).
- ⚠️ Porte animée + collisions équipements → Task 5 (itération), conforme au spec (fallback statique).
