# Gym — Aile est (design pré-fait LimeZu)

**Date :** 2026-05-31
**Statut :** Design validé (gym grande + agrandissement map), prêt pour plan
**Branche :** main → déploiement `/v2`

## Objectif

Ajouter une **salle de sport « ultra propre »** en réutilisant le **design pré-fait LimeZu**
(`Gym_Designs`, grande version 19×15), comme une **nouvelle aile à l'est** de la map,
reliée par un couloir avec une **porte animée**. Qualité = pixel-perfect (design officiel).

## Décisions validées

- **Grande gym** (design 1, 19×15 tuiles = ta capture de référence).
- **Agrandir la map** (nouvelle aile est), pas de remplacement de zone.
- S'inspirer du design « ultra propre ».

## Assets (pack complet `moderninteriors-win.zip`, 150 Mo, intègre)

- `6_Home_Designs/Gym_Designs/32x32/Gym_layer_1_32x32.png` (608×480 = 19×15) — **sol/base**.
- `6_Home_Designs/Gym_Designs/32x32/Gym_layer_2_32x32.png` (608×480) — **équipements** (transparence).
- `3_Animated_objects/16x16/spritesheets/animated_door_*.png` — portes animées (spritesheets).
- Sol/murs de couloir : `Room_Builder_Office_32x32.png` (déjà extrait).

## Contexte technique

- Map `default.tmj` : 60×42, tuiles 32px, **pleine à 100%**. Bord est = mur collision col 59
  (x=1888), lignes 11-42. `GameScene` gère déjà **N tilesets** (POC bureaux) → réutilisable.
- Astuce clé : un PNG de design (608×480, grille 32px) peut être **enregistré directement comme
  tileset** (columns=19, tilecount=285). Une couche tilemap place alors les gid `firstgid+0..284`
  dans un bloc 19×15 → **reproduit l'image exacte en tuiles**, 100% natif (collision/depth/caméra
  inchangés). Pas de slicing, pas de stamp d'image.

## Architecture

### 1. Agrandissement de la map (vers l'est)
- Largeur **60 → 84** (+24 cols : couloir ~4 + gym 19 + marge 1). Hauteur 42 inchangée.
- **Ré-indexation** de toutes les couches tuiles (data row-major) à la nouvelle largeur :
  chaque ligne garde ses 60 valeurs, complétée à droite par des 0. Fonction pure testée.
- `collision` (objectgroup, coords pixel) inchangé ; on **ajoute** des rects, on en **retire**
  un (ouverture du mur est).

### 2. Gym (bloc 19×15)
- Tilesets `gym_floor` (Gym_layer_1) et `gym_equip` (Gym_layer_2), firstgid enchaînés.
- Position : cols **64-82**, lignes **9-23** (centrée verticalement sur le couloir).
- Deux couches tilemap : `gym_floor` (sous) puis `gym_equip` (au-dessus de decoration).

### 3. Couloir + ouverture du mur est
- Couloir cols **60-63**, lignes **15-16** (2 de haut) : sol Room Builder + murs haut/bas.
- **Ouverture** dans le mur est existant (col 59) aux lignes 15-16 : retirer/raccourcir le rect
  collision `x=1888 y=352 h=992` en deux segments (au-dessus et en-dessous du passage).

### 4. Porte animée 🚪
- À l'entrée de la gym (jonction couloir/gym). Spritesheet `animated_door` chargé, animation
  Phaser (frames), **ouverture à l'approche** (réutilise la proximité existante) ; sinon boucle
  douce. Si trop complexe pour le 1er jet → porte statique d'abord, anim en itération.

### 5. Collisions
- Périmètre de la gym (murs) + gros équipements (machines/racks) en rects ajoutés à `collision`.
- Couloir : murs haut/bas. Passage libre. Porte franchissable.

### 6. Limites monde/caméra
- Automatiques : `mapW` passe à 84 → `GameScene` étend bounds monde + caméra sans code en plus.

## Méthode (script de génération)
`client/scripts/gen-gym.mjs` (modèle `gen-office-poc.mjs`), **idempotent** :
ré-indexe la largeur, enregistre les tilesets gym, pose les couches gym + couloir, ouvre le mur,
ajoute les collisions. Logique pure (ré-indexation, placement bloc, gids) dans un module testé.

## Critères de succès
- [ ] Map élargie à 84 sans régression (contenu existant intact, décalé correct).
- [ ] Gym affichée pixel-perfect (design LimeZu) à l'est, accessible par le couloir.
- [ ] Le perso traverse le couloir, entre dans la gym, ne traverse pas les machines/murs.
- [ ] Caméra/monde incluent la nouvelle aile.
- [ ] (Si inclus) porte animée à l'entrée. Sinon porte statique, anim en suivi.
- [ ] Validé sur `/v2`, prod intouchée.

## Risques
- **Ré-indexation largeur** : bug = décalage de toute la map. → fonction pure **testée** (TDD) +
  vérif headless.
- **Gym comme tileset 285 tuiles** : confirmer columns=19 et l'ordre des gid (vérif visuelle /v2).
- **Ouverture du mur** : bien re-fermer au-dessus/en-dessous du passage (pas de trou pour sortir
  du monde). Vérif collision.
- **Porte animée** : format spritesheet (frames) à confirmer ; fallback statique si besoin.
