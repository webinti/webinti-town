# Salles vivantes v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter respiration idle des persos + écrans qui scintillent sur les pods + rendre les 2 pods LimeZu revendiquables à l'approche, sans aucun asset supplémentaire.

**Architecture:** Une fonction pure `breathScaleY` (testée) calcule l'échelle de respiration ; un helper partagé l'applique aux couches d'avatar dans `Player` et `RemotePlayer`. `GameScene` ajoute des halos procéduraux (pattern cheminée) sur les écrans des pods, intensifiés à l'approche. Deux postes ajoutés à `workstations.ts` (client+serveur) réutilisent le système de proximité/claim existant.

**Tech Stack:** TypeScript, Phaser 3, Vitest. Aucune nouvelle dépendance, aucun asset.

**Spec :** `docs/superpowers/specs/2026-05-31-salles-vivantes-v1-design.md`

---

## Task 1 : Fonction pure `breathScaleY` + tests

**Files:**
- Create: `client/src/phaser/idleBreath.ts`
- Test: `client/src/phaser/idleBreath.test.ts`

- [ ] **Step 1 : Écrire le test qui échoue**

Create `client/src/phaser/idleBreath.test.ts` :
```ts
import { describe, it, expect } from 'vitest';
import { breathScaleY } from './idleBreath';

describe('breathScaleY', () => {
  it('vaut 1 avant le délai (perso vient de s’arrêter)', () => {
    expect(breathScaleY(0)).toBe(1);
    expect(breathScaleY(399)).toBe(1);
  });
  it('vaut 1 pile au démarrage de la respiration (cos(0))', () => {
    // à idleMs = delay, t=0 -> 0.5-0.5*cos(0)=0 -> scale 1
    expect(breathScaleY(400)).toBeCloseTo(1, 5);
  });
  it('atteint ~1+amplitude à mi-période', () => {
    // t = period/2 -> cos(pi) = -1 -> 0.5-0.5*(-1)=1 -> scale 1+amp
    expect(breathScaleY(400 + 700)).toBeCloseTo(1.03, 3);
  });
  it('reste borné dans [1, 1+amplitude]', () => {
    for (let ms = 0; ms < 5000; ms += 37) {
      const s = breathScaleY(ms);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(1.03 + 1e-9);
    }
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `cd client && npx vitest run src/phaser/idleBreath.test.ts`
Expected: FAIL — `Failed to resolve import "./idleBreath"`.

- [ ] **Step 3 : Écrire l'implémentation**

Create `client/src/phaser/idleBreath.ts` :
```ts
// Respiration idle procédurale (aucun asset). Renvoie un facteur scaleY à
// appliquer aux couches de l'avatar quand le perso est immobile.
const DELAY_MS = 400; // temps d'immobilité avant de commencer à respirer
const PERIOD_MS = 1400; // durée d'un cycle inspiration/expiration
const AMPLITUDE = 0.03; // +3% en pic

export function breathScaleY(idleMs: number): number {
  if (idleMs < DELAY_MS) return 1;
  const t = idleMs - DELAY_MS;
  const phase = (2 * Math.PI * t) / PERIOD_MS;
  return 1 + AMPLITUDE * (0.5 - 0.5 * Math.cos(phase));
}
```

- [ ] **Step 4 : Lancer le test pour vérifier le succès**

Run: `cd client && npx vitest run src/phaser/idleBreath.test.ts`
Expected: PASS (4 tests verts).

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/phaser/idleBreath.ts client/src/phaser/idleBreath.test.ts
git commit -m "feat(salles-vivantes): fonction pure breathScaleY + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2 : Appliquer la respiration dans Player et RemotePlayer

**Files:**
- Create: `client/src/phaser/applyBreath.ts`
- Modify: `client/src/phaser/entities/Player.ts` (méthode `update`)
- Modify: `client/src/phaser/entities/RemotePlayer.ts` (méthode `update`)

- [ ] **Step 1 : Helper partagé d'application**

Create `client/src/phaser/applyBreath.ts` :
```ts
import type Phaser from 'phaser';

// Couches d'avatar partagées par Player et RemotePlayer.
export interface AvatarLayers {
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  pantsLayer?: Phaser.GameObjects.Sprite;
  shirtLayer?: Phaser.GameObjects.Sprite;
  hairLayer?: Phaser.GameObjects.Sprite;
  hairBackLayer?: Phaser.GameObjects.Sprite;
}

// Applique un scaleY uniforme à toutes les couches présentes (scale -> rendu
// uniquement ; n'altère pas la position du corps).
export function applyBreath(a: AvatarLayers, scaleY: number): void {
  a.sprite.setScale(1, scaleY);
  a.pantsLayer?.setScale(1, scaleY);
  a.shirtLayer?.setScale(1, scaleY);
  a.hairLayer?.setScale(1, scaleY);
  a.hairBackLayer?.setScale(1, scaleY);
}
```

- [ ] **Step 2 : Intégrer dans `Player.update`**

Dans `client/src/phaser/entities/Player.ts` :

(a) Ajouter les imports en haut du fichier (après les imports existants) :
```ts
import { breathScaleY } from '../idleBreath';
import { applyBreath } from '../applyBreath';
```

(b) Ajouter un champ d'instance près de `moving = false;` (vers la ligne 26) :
```ts
  private idleMs = 0;
```

(c) Dans `update(...)`, juste après la ligne qui calcule `this.moving = vx !== 0 || vy !== 0;` (vers la ligne 159) et la prise en compte du mode dance (après `const dancing = ...` / le bloc qui force `this.moving = true`), insérer avant le `return` final de la méthode :
```ts
    // Respiration idle (procédurale) — n'affecte pas la physique.
    if (this.moving) {
      this.idleMs = 0;
      applyBreath(this, 1);
    } else {
      this.idleMs += dt;
      applyBreath(this, breathScaleY(this.idleMs));
    }
```
> `dt` est déjà le paramètre de durée de frame utilisé par `advanceWalkTick`. `this` satisfait `AvatarLayers` (mêmes noms de propriétés).

- [ ] **Step 3 : Intégrer dans `RemotePlayer.update`**

Dans `client/src/phaser/entities/RemotePlayer.ts` :

(a) Imports en haut :
```ts
import { breathScaleY } from '../idleBreath';
import { applyBreath } from '../applyBreath';
```

(b) Champs d'instance (près de `targetX`/`hasLayers`, vers la ligne 27) :
```ts
  private idleMs = 0;
  private lastX = 0;
  private lastY = 0;
```

(c) À la fin de `update(dt: number)` (la méthode qui interpole la position vers `targetX/targetY`), après que la position du sprite a été mise à jour, insérer :
```ts
    // Respiration idle : "immobile" = position quasi inchangée cette frame.
    const movedDist = Math.hypot(this.sprite.x - this.lastX, this.sprite.y - this.lastY);
    this.lastX = this.sprite.x;
    this.lastY = this.sprite.y;
    if (movedDist > 0.3) {
      this.idleMs = 0;
      applyBreath(this, 1);
    } else {
      this.idleMs += dt;
      applyBreath(this, breathScaleY(this.idleMs));
    }
```
> Si `update` n'a pas de paramètre `dt`, utiliser `this.scene.game.loop.delta` à la place de `dt`. Vérifier la signature réelle avant d'éditer.

- [ ] **Step 4 : Vérifier la compilation**

Run: `cd client && npx tsc -b`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/phaser/applyBreath.ts client/src/phaser/entities/Player.ts client/src/phaser/entities/RemotePlayer.ts
git commit -m "feat(salles-vivantes): respiration idle appliquée aux avatars (local + distants)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3 : Écrans qui scintillent sur les pods (GameScene)

**Files:**
- Modify: `client/src/phaser/scenes/GameScene.ts` (nouvelle méthode `createScreenGlows` + appel + maj proximité)

- [ ] **Step 1 : Ajouter la config + la création des halos**

Dans `client/src/phaser/scenes/GameScene.ts`, ajouter un champ d'instance près des autres (ex. près de `private fireplace?...`) :
```ts
  private screenGlows: Array<{ wsId: string; glow: Phaser.GameObjects.Graphics; near: boolean }> = [];
```

Ajouter cette méthode (à côté de `createFireplace`) :
```ts
  // Halos bleus "écran allumé" sur les pods LimeZu (procédural, aucun asset).
  // Positions = tuile écran de chaque pod : pod A (30,16), pod B (35,16).
  private createScreenGlows(): void {
    const SCREENS = [
      { wsId: 'poste-limezu-1', x: 30 * 32 + 16, y: 16 * 32 + 16 },
      { wsId: 'poste-limezu-2', x: 35 * 32 + 16, y: 16 * 32 + 16 },
    ];
    for (const s of SCREENS) {
      const glow = this.add.graphics({ x: s.x, y: s.y });
      glow.fillStyle(0x4aa3ff, 0.5).fillRect(-12, -10, 24, 16);
      glow.setBlendMode(Phaser.BlendModes.ADD);
      glow.setDepth(9.5);
      glow.setAlpha(0.3);
      this.tweens.add({ targets: glow, alpha: 0.55, duration: 900, ease: 'Sine.easeInOut', yoyo: true, repeat: -1 });
      this.screenGlows.push({ wsId: s.wsId, glow, near: false });
    }
  }
```

- [ ] **Step 2 : Appeler `createScreenGlows` après le build de la map**

Dans `GameScene`, repérer où la map est construite (fin de `buildTilemap()` ou juste après son appel dans `create()`), et ajouter :
```ts
    this.createScreenGlows();
```

- [ ] **Step 3 : Intensifier le halo à l'approche**

Dans le bloc de calcul de proximité (vers la ligne 784, après `storeState.setNearbyWorkstationId(nearestId)`), ajouter :
```ts
    // Feedback d'approche : l'écran du pod ciblé grossit légèrement.
    for (const sg of this.screenGlows) {
      const shouldBeNear = sg.wsId === nearestId;
      if (shouldBeNear !== sg.near) {
        sg.near = shouldBeNear;
        this.tweens.add({ targets: sg.glow, scale: shouldBeNear ? 1.5 : 1, duration: 200, ease: 'Quad.easeOut' });
      }
    }
```

- [ ] **Step 4 : Vérifier la compilation**

Run: `cd client && npx tsc -b`
Expected: aucune erreur.

- [ ] **Step 5 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/phaser/scenes/GameScene.ts
git commit -m "feat(salles-vivantes): écrans scintillants sur les pods + feedback d'approche

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4 : Enregistrer les 2 pods comme postes revendiquables

**Files:**
- Modify: `client/src/workstations.ts`
- Modify: `server/src/workstations.ts`
- Test: `client/src/workstations.test.ts` (create)

- [ ] **Step 1 : Écrire le test qui échoue**

Create `client/src/workstations.test.ts` :
```ts
import { describe, it, expect } from 'vitest';
import { WORKSTATIONS } from './workstations';

describe('WORKSTATIONS — pods LimeZu', () => {
  it('contient les 2 pods LimeZu avec leurs zones', () => {
    const p1 = WORKSTATIONS.find((w) => w.id === 'poste-limezu-1');
    const p2 = WORKSTATIONS.find((w) => w.id === 'poste-limezu-2');
    expect(p1).toEqual({ id: 'poste-limezu-1', name: 'Bureau LimeZu 1', minX: 928, minY: 512, maxX: 1024, maxY: 608 });
    expect(p2).toEqual({ id: 'poste-limezu-2', name: 'Bureau LimeZu 2', minX: 1088, minY: 512, maxX: 1184, maxY: 608 });
  });
  it('aucun id de poste dupliqué', () => {
    const ids = WORKSTATIONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2 : Lancer le test pour vérifier l'échec**

Run: `cd client && npx vitest run src/workstations.test.ts`
Expected: FAIL (les pods n'existent pas encore).

- [ ] **Step 3 : Ajouter les 2 défs (client)**

Dans `client/src/workstations.ts`, juste avant la ligne `{ id: 'salle-conf', ... }`, ajouter :
```ts
  // ── Pods LimeZu (POC tuiles premium, open space) ──
  { id: 'poste-limezu-1', name: 'Bureau LimeZu 1', minX: 928, minY: 512, maxX: 1024, maxY: 608 },
  { id: 'poste-limezu-2', name: 'Bureau LimeZu 2', minX: 1088, minY: 512, maxX: 1184, maxY: 608 },
```

- [ ] **Step 4 : Ajouter les 2 défs identiques (serveur)**

Dans `server/src/workstations.ts`, au même endroit (avant `salle-conf` ou en fin de tableau, à l'identique du client) :
```ts
  // ── Pods LimeZu (POC tuiles premium, open space) ──
  { id: 'poste-limezu-1', name: 'Bureau LimeZu 1', minX: 928, minY: 512, maxX: 1024, maxY: 608 },
  { id: 'poste-limezu-2', name: 'Bureau LimeZu 2', minX: 1088, minY: 512, maxX: 1184, maxY: 608 },
```

- [ ] **Step 5 : Lancer le test + compilation**

Run: `cd client && npx vitest run src/workstations.test.ts && npx tsc -b`
Expected: tests PASS, compilation OK.

- [ ] **Step 6 : Commit**

```bash
cd /home/openclaw/projects/webinti-town
git add client/src/workstations.ts client/src/workstations.test.ts server/src/workstations.ts
git commit -m "feat(salles-vivantes): 2 pods LimeZu revendiquables (client+serveur synchronisés)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5 : Build serveur + `/v2`, vérification headless, déploiement

**Files:** aucun (build + vérif).

- [ ] **Step 1 : Suite de tests complète (non-régression)**

Run: `cd client && npm test`
Expected: tous les tests passent (idleBreath, workstations, officePoc, collisionRects, etc.).

- [ ] **Step 2 : Build serveur (les workstations serveur ont changé)**

Run: `cd server && npm run build` (ou la commande de build serveur du projet)
Expected: build réussi. Puis redémarrer le service si nécessaire : `sudo systemctl restart webinti-server` (NOPASSWD autorisé).

- [ ] **Step 3 : Build `/v2`**

Run: `cd client && npm run build:v2`
Expected: build réussi (sortie `client/dist/v2/`, servie par nginx).

- [ ] **Step 4 : Vérification headless en jeu**

Réutiliser le script playwright-core (chromium cache `~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`) : charger `https://live.webinti.com/v2/`, rejoindre avec un pseudo, attendre, capturer les erreurs console, screenshoter. Vérifier :
- 0 erreur console / 0 échec de chargement.
- Le perso bouge et collisionne normalement (la respiration ne bloque rien).
- Les écrans des pods scintillent.

- [ ] **Step 5 : Vérification manuelle (user) sur `/v2`**

Le user ouvre `live.webinti.com/v2`, vérifie : respiration discrète des persos, écrans scintillants, et qu'en s'approchant d'un pod LimeZu le `WorkstationPanel` s'ouvre (revendication volontaire).

- [ ] **Step 6 : Commit final éventuel (tuning amplitude/halo)**

```bash
cd /home/openclaw/projects/webinti-town
git add -A
git commit -m "chore(salles-vivantes): tuning final validé sur /v2

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Auto-revue (couverture spec)

- ✅ Idle respiration (local+distants, scale, reset au mouvement, off pendant dance) → Task 1 + Task 2.
- ✅ Écran scintillant + feedback approche → Task 3.
- ✅ Pods revendiquables (client+serveur sync) → Task 4.
- ✅ Validation /v2 + non-régression → Task 5.
- ⚠️ Amplitude idle ajustable (constante `AMPLITUDE` dans `idleBreath.ts`) si rendu « gonflé » — Task 5 step 5/6.

## Notes de risque

- **Signature `dt` de RemotePlayer.update** : à confirmer avant édition (Task 2 step 3) ; fallback `this.scene.game.loop.delta`.
- **Point d'appel `createScreenGlows`** : doit être après que la scène/caméra existe (dans/après `buildTilemap`).
- **Dance déjà présent** : le bloc idle ne s'exécute que si `!this.moving` ; or dance force `moving=true`, donc la respiration est naturellement désactivée pendant la danse (pas de cumul).
