# POC tuiles LimeZu — Bureau test « façon Gather »

**Date :** 2026-05-31
**Statut :** Design validé, prêt pour plan d'implémentation
**Branche cible :** staging `/v2` (prod intouchée)

## Objectif

Valider de bout en bout la **pipeline d'intégration des tuiles LimeZu** (Modern Office) dans
le moteur Phaser, avec un rendu **fidèle au style Gather**, professionnel et concluant.
Ce POC n'est pas jetable : il pose les fondations techniques (`GameScene` multi-tilesets)
qui serviront ensuite à « Gather-ifier » toute la map.

Référence visuelle cible : capture Gather.town fournie par le user (postes « Product team »
= style LimeZu Modern Interiors).

### Périmètre (choix validés)

- **Un seul bureau test** (choix C) — pas toute la map. « Le reste » viendra après.
- Posé **directement dans la map actuelle**, près du spawn open space `(1024, 480)`, pour
  comparaison immédiate avec les tuiles placeholder existantes.
- **Deux variantes côte à côte** : mobilier **avec ombre** (`Black_Shadow`) vs **sans ombre**
  (`Shadowless`), pour que le user tranche le style en le voyant sur `/v2`.
- Bureau **solide** (collision) — valide la cohabitation mobilier LimeZu + système de
  collisions par rectangles récemment livré.

### Hors périmètre (plus tard)

- Remplacement des personnages par des persos style LimeZu (prévu, cf. memory
  `project_f11_characters_limezu`).
- Habillage complet de la map (les 4 zones).
- Intégration de Modern Interiors / Exteriors (seul Modern Office est utilisé ici).

## Contexte technique (existant)

- Map `client/public/maps/default.tmj` : **60×42 tuiles de 32px**.
- **Un seul tileset** déclaré : `basic` → `../assets/tilesets/basic.png` (512×512, placeholder).
- `GameScene.buildTilemap()` ne charge que `map.tilesets[0]` et le bind à la clé image
  `tileset_basic`. **C'est la limite à lever.**
- Collisions : objectgroup `collision` (rectangles), consommé par `CollisionLayer`.
- Rendu : `pixelArt: true` déjà actif dans `client/src/phaser/config.ts` → filtrage NEAREST,
  pas de flou. Base saine pour un rendu pixel-perfect.
- Pattern de génération existant : `client/scripts/gen-collision.mjs` +
  `collisionRects.mjs` (+ tests). À suivre pour le script de génération.

## Architecture

### 1. Pipeline de rendu multi-tilesets (déblocage réutilisable)

**`BootScene.preload()`** — charger chaque PNG LimeZu sous une clé conventionnelle
`tileset_<nom>` :
- `tileset_office_shadow` → `Modern_Office_Black_Shadow_32x32.png`
- `tileset_office_shadowless` → `Modern_Office_Shadowless_32x32.png`
- `tileset_room_builder` → `Room_Builder_Office_32x32.png`

**`GameScene.buildTilemap()`** — généraliser :
```ts
const tilesets = map.tilesets
  .map((ts) => map.addTilesetImage(ts.name, `tileset_${ts.name}`))
  .filter((t): t is Phaser.Tilemaps.Tileset => t !== null);
// createLayer reçoit le tableau complet
const layer = map.createLayer(layerData.name, tilesets, 0, 0);
```
- Convention : le nom du tileset dans le `.tmj` correspond à la clé image `tileset_<nom>`.
- **Rétro-compatible** : `basic` → `tileset_basic` conservé, fallback inchangé.
- La détection des layers murs/furniture et la collision objectgroup restent identiques.

### 2. Assets extraits

Extraire les **versions 32×32** depuis les zips (`client/public/assets/`) vers
`client/public/assets/tilesets/` :
- `Room_Builder_Office_32x32.png` (sol + murs bureau)
- `Modern_Office_Black_Shadow_32x32.png` (mobilier avec ombre)
- `Modern_Office_Shadowless_32x32.png` (mobilier sans ombre)

> Les versions 32×32 sont fournies déjà mises à l'échelle proprement par LimeZu — aucun
> upscale maison, pas de perte de qualité.

### 3. Scène test — deux « pods » façon Gather

Chaque pod reconstitue un poste de travail complet (pas une tuile isolée) :
- Plateau de bureau
- Écran + PC + clavier/souris
- Chaise de bureau (côté joueur)
- Plante en décoration adjacente
- **Patch de sol LimeZu** sous les pods (sinon le mobilier « flotte » sur le placeholder
  gris → comparaison faussée). Jugement sur fond cohérent, comme Gather.

Disposition : **POD A (avec ombre)** et **POD B (sans ombre)** côte à côte, séparés de
quelques tuiles, posés près du spawn open space pour visibilité immédiate.

Implémentation map : nouveau **tilelayer dédié** (ex. `limezu_test`) au-dessus de
`decoration`, + patch de sol dans un layer dédié ou dans `ground`. Le layer dédié garde le
POC isolé (facile à étendre ou retirer).

### 4. Collisions

- Un **rectangle de collision par pod**, couvrant le plateau du bureau, ajouté à l'objectgroup
  `collision`.
- **Chaise franchissable** (on s'« assoit » dessus, comme Gather) — pas de collision dessus.
- Réutilise le `CollisionLayer` existant, aucun changement runtime côté collisions.

### 5. Script de génération

`client/scripts/gen-office-poc.mjs` (sur le modèle de `gen-collision.mjs`) :
- Déclare les nouveaux tilesets dans `default.tmj` (firstgid calculés après `basic` :
  basic = 256 tuiles → firstgid suivant = 257, puis enchaînés selon la taille de chaque sheet).
- Écrit le layer `limezu_test` (+ patch de sol) avec les bons GID.
- Ajoute les rectangles de collision des deux pods dans l'objectgroup `collision`.
- Idempotent / reproductible / versionné — pas de JSON édité à la main.

> Les indices de tuiles précis (quel GID = bureau, écran, chaise…) seront identifiés à
> l'implémentation en inspectant les sheets, et centralisés en constantes dans le script.

## Déploiement & test

1. `npm run build:v2` (build base-aware `/v2`, cache-buster intégré).
2. Déploiement sur `live.webinti.com/v2` uniquement — **prod intouchée**.
3. Le user juge sur `/v2` : compare les 2 pods à la capture Gather, tranche le style
   (avec/sans ombre). Le style retenu devient le standard pour la suite.

## Critères de succès

- [ ] `GameScene` charge plusieurs tilesets sans régression sur l'existant (`basic` OK).
- [ ] Les deux pods s'affichent **nets** (pixel-perfect, pas de flou) sur `/v2`.
- [ ] Le rendu est visuellement **proche de la référence Gather**.
- [ ] Le perso **ne traverse pas** le plateau des bureaux ; la chaise reste franchissable.
- [ ] Aucune régression sur prod (déploiement `/v2` isolé).
- [ ] Le user valide le style (avec ou sans ombre) → décision tranchée pour la suite.

## Risques / points d'attention

- **Firstgid** : erreur de calcul = mauvaises tuiles affichées. Mitigé par le script
  (calcul automatique depuis les dimensions des sheets) + vérification visuelle sur `/v2`.
- **Licence LimeZu** : `LICENSE.txt` présent dans le zip Office — vérifier l'usage commercial
  autorisé avant promotion en prod (à faire avant « le reste », pas bloquant pour le POC `/v2`).
- **Taille des sheets** : confirmer les dimensions réelles des PNG 32×32 pour le calcul des
  colonnes/firstgid.
