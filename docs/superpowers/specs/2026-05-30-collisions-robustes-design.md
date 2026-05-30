# Collisions robustes — couche de collision dédiée

**Date :** 2026-05-30
**Statut :** Validé (design), à implémenter
**Contexte :** Phase A d'un chantier plus large (A : collisions, B : art premium gratuit).

## Problème

L'objectif est d'avoir des collisions « inviolables » : impossible de traverser un
mur, de sortir du bâtiment par erreur, ou de tunneler à travers un mur fin en
boostant au kart. Un projet comparable (même stack, fait avec Claude Code) souffre
de collisions cassées (on traverse tout) — vraisemblablement parce que le perso y
est déplacé en position directe, sans physique.

Notre moteur est déjà sur de bonnes bases :
- Mouvement par **vraie physique** Phaser Arcade (`body.setVelocity`) → les colliders fonctionnent.
- `setCollideWorldBounds(true)` sur le joueur → impossible de quitter les limites du monde.
- Vitesses modérées : marche 160, kart 320, boost 480 px/s ≈ 8 px/frame à 60 fps →
  **aucun risque de tunneling** sur des murs de 32 px.

Le travail n'est donc pas de « réparer » mais de **blinder + rendre visible/contrôlable**,
et de **découpler la collision de l'art** pour que le passage au tileset premium
(phase B) n'oblige pas à tout refaire.

## Décisions validées

- **Ce qui est solide :** murs + **gros mobilier** (comptoirs cuisine, bureaux, canapés,
  grandes jardinières). Les petits décos (tapis, petites plantes au sol) restent traversables.
- **Déplacement :** le joueur peut aller **partout**, intérieur comme extérieur
  (herbe / parking), en prévision de la piste de kart (F12).
- **Approche retenue :** couche de collision **dédiée en rectangles**, indépendante de l'art.

## Architecture

Une couche de collision dédiée devient la **seule source de vérité** pour ce qui bloque
le joueur. Les couches de tuiles (`ground/walls/furniture/decoration`) redeviennent
**purement visuelles** — on débranche `setCollisionByProperty`.

```
default.tmj
 ├─ ground / walls / furniture / decoration   → VISUEL uniquement (aucune collision)
 ├─ objects / spawns                            → inchangé (panneaux, zones de postes)
 └─ collision  ← NOUVEAU : object layer de rectangles → ce qui bloque, et rien d'autre
```

Au chargement, `GameScene` lit la couche `collision`, crée **un corps statique invisible
par rectangle**, et un **unique** `collider(player, groupeCollision)`. Fini les deux
mécanismes (tuiles + groupe fallback) qui peuvent se contredire.

Compatibilité ascendante : si la couche `collision` est absente (ex. map fallback
procédurale), on retombe sur le comportement actuel (collision par propriété de tuile +
`wallsGroup`). La nouvelle couche est prioritaire quand elle existe.

## Format des données

Object layer nommée `collision` dans le `.tmj`, contenant des rectangles Tiled standard :

```json
{ "name": "collision", "type": "objectgroup",
  "objects": [ { "x": 0, "y": 320, "width": 32, "height": 384 }, ... ] }
```

Coordonnées en **pixels monde**. Lisible et éditable à la main (workflow : Claude édite,
l'utilisateur valide à l'écran et signale les ajustements). Survit au changement d'art :
en phase B, on ajuste les rectangles plutôt que de repartir de zéro.

## Génération initiale

Script offline `scripts/gen-collision.mjs` (dev only) :
1. Lit les couches `walls` + `furniture` de `default.tmj`.
2. Repère les cellules solides : tuiles de mur qui collisionnent aujourd'hui (propriété
   `collides`) **moins** les tuiles « porte » (gid 47), **plus** les gids de gros mobilier
   désignés comme solides (liste à affiner avec le mode debug).
3. **Fusionne** les cellules solides en un minimum de gros rectangles (fusion gourmande :
   bandes horizontales puis fusion verticale des bandes identiques).
4. Injecte le résultat comme object layer `collision` dans `default.tmj`.

La fusion produit peu de rectangles → faciles à relire et à régler à la main ensuite.

## Mode debug collision

Touche **`C`** (ignorée quand un champ de saisie a le focus, via `inputFocused`) :
- superpose en **rouge translucide** tous les rectangles de collision ;
- trace le contour des **limites du monde** ;
- (optionnel) trace la boîte de collision du joueur.

C'est à la fois la **boucle de réglage** (« là il manque un mur » / « ce bureau ne devrait
pas bloquer ») et la **démo** qui valorise le système. Rendu via un `Graphics` à depth élevé,
redessiné à chaque toggle (collisions statiques → pas besoin de redessiner chaque frame).

## Composants (fichiers)

| Fichier | Rôle | Testé |
|---|---|---|
| `client/src/phaser/collision/collisionRects.ts` | Fonction **pure** : grille de cellules solides → liste de rectangles fusionnés | ✅ unitaire |
| `client/src/phaser/collision/CollisionLayer.ts` | Construit les corps statiques depuis les rectangles + dessine l'overlay debug | — |
| `client/scripts/gen-collision.mjs` | Génération offline de la couche `collision` | — |
| `client/src/phaser/scenes/GameScene.ts` | Câblage : lecture couche, collider unique, toggle `C` | — |

`Player.ts` : aucun changement (déjà sous physique, `collideWorldBounds` déjà actif).

## Flux de données

1. **Offline** : `gen-collision.mjs` → écrit la couche `collision` dans `default.tmj`.
2. **Boot** : tilemap chargé (avec cache-buster `?v=` déjà en place).
3. **GameScene.create** : `getObjectLayer('collision')` → `CollisionLayer` construit le
   `StaticGroup` → `collider(player.sprite, group)`. Débranchement des colliders de tuiles.
4. **Runtime** : touche `C` → `CollisionLayer.toggleDebug()` affiche/masque l'overlay.

## Tests

- **Unitaire (vitest)** : `collisionRects` — grilles connues → rectangles attendus
  (cellule isolée, ligne, bloc plein, forme en L, trous/portes préservés).
- **Manuel :**
  - foncer dans chaque mur et chaque gros meuble → bloqué ;
  - traverser un petit déco (tapis, petite plante) → passe ;
  - tenter de sortir de la map par tous les bords → bloqué (world bounds) ;
  - **boost kart (480 px/s) face à un mur** → pas de tunneling ;
  - activer `C` → l'overlay rouge couvre exactement les zones solides, rien de plus.

## Hors périmètre (phase A)

- Le nouvel art / tileset premium gratuit (= phase B).
- La piste de kart F12.
- Le pathfinding / auto-walk (le teleport « aller au poste » reste tel quel).
