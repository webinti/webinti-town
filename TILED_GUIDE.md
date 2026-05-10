# Édition de la map avec Tiled

La map de Webinti Town est au format **Tiled** natif. Tu peux l'éditer visuellement avec l'éditeur officiel **gratuit**, et le jeu se met à jour automatiquement (Vite HMR).

## 1. Installer Tiled

- Télécharge depuis https://www.mapeditor.org/ (Mac/Win/Linux, ou via `brew install --cask tiled` sur Mac)
- Application gratuite, open source, ~50 Mo

## 2. Ouvrir la map

Ouvrir le fichier :

```
/Users/Tim/Documents/Claude/Gather/client/public/maps/default.tmj
```

Tu verras :
- À droite : panneau **Layers** avec `ground`, `walls`, `furniture`, `decoration`, `objects`, `spawns`
- En bas à droite : panneau **Tilesets** avec la palette de tuiles `basic` (256 emplacements, ~115 dessinées)
- Au centre : la carte 60×42

## 3. Éditer

### Sélectionner une couche
Clique sur la couche dans le panneau **Layers**. Toutes tes modifications affecteront cette couche.

### Outils principaux (raccourcis clavier)

- **B** — Stamp Brush : pose la tuile sélectionnée au clic
- **R** — Rectangle Fill : remplit une zone rectangulaire
- **F** — Flood Fill (pot de peinture)
- **E** — Eraser : efface une tuile (set à 0)
- **S** — Select : sélection rectangulaire pour copier/coller (`Cmd+C`/`Cmd+V`)

### Choisir une tuile
Clique sur une tuile dans le panneau **Tilesets** (en bas à droite). Elle devient l'élément actif pour le brush.

### Couches typiques
- **ground** : sol (herbe, parquet, moquette, etc.) — toujours rempli
- **walls** : murs et portes — toutes les tuiles ici **bloquent** le joueur (collision via propriété `collides:true`)
- **furniture** : mobilier — bloque aussi (sauf certaines tuiles déco)
- **decoration** : tapis, peintures murales — **ne bloque jamais**
- **objects** (object layer, vide pour l'instant) : futurs objets interactifs
- **spawns** (object layer) : points d'apparition. 4 spawns existent

### Ajouter un point de spawn
1. Sélectionne la couche `spawns`
2. Outil **Insert Point** (raccourci T)
3. Clique sur la map à la position voulue
4. Donne-lui un nom dans le panneau **Properties**

## 4. Activer/désactiver les collisions sur une tuile

Si tu poses une tuile et que le joueur ne peut pas passer alors qu'il devrait (ou inversement) :

1. Clique sur la tuile dans le panneau **Tilesets** (en bas à droite)
2. Clic-droit → **Tile Properties**
3. Coche/décoche `collides`

Ça affectera **toutes** les occurrences de cette tuile dans la map.

## 5. Sauvegarder

`Cmd+S` (ou `Ctrl+S` sur Win/Linux).

**Important** : enregistre au format **`.tmj` (JSON)**, pas `.tmx` (XML). Tiled garde le format d'origine donc en réouvrant `default.tmj` ça reste en JSON.

## 6. Voir le résultat

Vite détecte les changements dans `/public` et recharge automatiquement. Si le navigateur n'actualise pas, fais un **F5** (ou Cmd+R) sur l'onglet Webinti Town.

## 7. Pièges courants

- **Tuile qui bloque mais ne devrait pas** : tu l'as posée sur la couche `furniture` ou `walls`. Déplace-la sur `decoration`.
- **La porte ne s'ouvre pas** : les portes sont des tuiles murales sans collision (id 46 = porte fermée, walkable). Si tu poses une autre tuile par-dessus, elle peut bloquer.
- **Mobilier décalé visuellement** : Tiled aligne tout sur la grille 32×32. Pour des objets multi-tuiles (canapé 3 pièces, table de réunion 6×2), pose chaque tuile l'une à côté de l'autre — le générateur a découpé les meubles en pièces compatibles.
- **Importer un nouveau tileset (LimeZu, etc.)** : `Map → Add External Tileset`, pointe vers ton PNG. Configure tilewidth/height. Garde le firstgid si possible pour ne pas casser les références existantes.

## 8. Références rapides

- **Tuiles de sol** : gid 1 = herbe, gid 17+ = sols intérieurs
- **Murs** : gid 33-48 (briques, fenêtres, coins, portes, partitions)
- **Mobilier** : gid 65-128 (bureaux, chaises, canapés, plantes, cuisine, etc.)
- **Déco** : gid 129-192 (tapis, arbres, lampes, bancs, arcade, billard, piano)

Voir le commentaire en haut de `/tmp/gen_tileset_v2.py` pour la liste complète.

## 9. Workflow conseillé

1. Pars de `default.tmj` comme base
2. Fais une copie (`default.tmj.bak`) avant grosse modif
3. Édite par petites passes, sauvegarde, vérifie en jeu
4. Quand satisfait, commit
