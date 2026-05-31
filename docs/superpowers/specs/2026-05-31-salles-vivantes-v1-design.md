# Salles vivantes v1 — Animations procédurales + pods revendiquables

**Date :** 2026-05-31
**Statut :** Design validé (option A), prêt pour plan
**Branche :** main → déploiement `/v2`

## Objectif

Donner de la vie aux salles **sans aucun asset supplémentaire**, via des animations
procédurales (pattern de la cheminée existante), et rendre les 2 pods LimeZu du POC
revendiquables à l'approche en réutilisant le système F6 existant. Test sur les 2 pods,
puis réplication partout.

> Les portes animées / gym viendront avec le pack **Modern Interiors complet** (que le user
> possède mais doit re-télécharger en version non-« Free »). Hors périmètre ici.

## Périmètre (option A validée)

1. **Idle « respiration »** des persos à l'arrêt.
2. **Écran qui scintille** sur les pods (halo procédural).
3. **Pods revendiquables à l'approche** (réutilise proximité + WorkstationPanel existants).

Hors périmètre : plante qui ondule (nécessiterait de convertir la tuile en sprite — YAGNI),
portes animées (pack complet), gym.

## Contexte technique (existant)

- **Avatars** (`Player.ts`, `RemotePlayer.ts`) : sprite physique `body` + couches
  `pants/shirt/hair/hairBack` qui suivent la position. Flag `moving`. Mode « dance » déjà
  présent (`cursors.dance && !moving`).
- **Cheminée animée** (`GameScene.createFireplace`) : `add.graphics()` + halo + `tweens.add`
  avec alpha/scale yoyo en boucle. **Pattern de référence pour les anims procédurales.**
- **Proximité/claim** (`GameScene` ~l.760-786) : pour chaque `WORKSTATIONS`, calcule le poste
  le plus proche (rayon 48px / inZone) → `setNearbyWorkstationId` → `WorkstationPanel`
  affiche l'action. Claim via `workstation:claim`. Défs dans `client/src/workstations.ts`
  **et** `server/src/workstations.ts` (doivent rester identiques).
- Pods POC : origines tuiles **(29,16)** et **(34,16)** ; écran à `(oc+1, or)` ; bureau 3
  tuiles à la ligne `or+1`.

## Architecture (3 unités isolées)

### 1. Idle « respiration » — `Player.ts` / `RemotePlayer.ts`
- Quand le perso n'est pas en mouvement (`!moving`) depuis > ~400 ms, appliquer une
  **respiration douce en `scaleY`** (1.0 ↔ ~1.03, période ~1.4 s, sinus) sur **toutes les
  couches** de l'avatar (body + pants + shirt + hair + hairBack).
- **N'affecte pas la position** (scale, pas translation) → physique/collision intactes.
  Impact taille du corps physique négligeable (~3%).
- Dès que `moving` repasse à vrai → reset immédiat `scaleY = 1`.
- S'applique aux joueurs **local et distants** → tout le monde a l'air vivant.
- Désactivé pendant le mode « dance » (pour ne pas cumuler).

### 2. Écran qui scintille — `GameScene`
- Pour chaque pod, ajouter un **halo bleu** (`add.graphics` ou sprite additif) centré sur la
  tuile écran : pod A écran à tuile (30,16) → px (976, 528) ; pod B à (35,16) → px (1136, 528).
- Tween alpha en boucle (yoyo) — léger scintillement « écran allumé ». Même technique que la
  cheminée.
- **Feedback d'approche** : quand `nearbyWorkstationId` correspond au pod, intensifier le halo
  (alpha plus élevé) → l'écran « réagit » à l'arrivée.
- Positions des écrans centralisées dans une petite constante (dérivée des origines de pods).

### 3. Pods revendiquables — `workstations.ts` (client + serveur)
- Ajouter 2 défs `Workstation` (zones ~96×96 centrées sur chaque bureau) :
  - `poste-limezu-1` « Bureau LimeZu 1 » : centre desk pod A ≈ px (976, 560) → minX 928, maxX 1024, minY 512, maxY 608.
  - `poste-limezu-2` « Bureau LimeZu 2 » : centre desk pod B ≈ px (1136, 560) → minX 1088, maxX 1184, minY 512, maxY 608.
- **Identiques** dans `client/src/workstations.ts` et `server/src/workstations.ts`.
- Le système de proximité existant les prend en charge automatiquement (surbrillance + panel +
  claim). **Pas d'auto-claim** : action volontaire via le panel.

## Critères de succès

- [ ] Les persos à l'arrêt « respirent » discrètement ; aucun impact sur déplacement/collision.
- [ ] Les écrans des 2 pods scintillent ; plus intenses à l'approche.
- [ ] S'approcher d'un pod LimeZu ouvre le `WorkstationPanel` (revendication volontaire).
- [ ] Aucune régression sur les 16 postes existants ni sur la prod.
- [ ] Validé sur `/v2`.

## Risques

- **Idle scaleY** : si le rendu paraît « gonflé »/janky, réduire l'amplitude (≤1.02) ou retomber
  sur une amplitude nulle (désactivable par constante). Vérif visuelle headless + sur /v2.
- **Sync client/serveur workstations** : les 2 fichiers doivent rester identiques (déjà
  documenté dans le code). Test : démarrer, s'approcher, vérifier le panel.
