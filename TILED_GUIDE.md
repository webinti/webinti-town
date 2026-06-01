# Éditer la map Webinti Town avec Tiled (workflow local)

La map est au format **Tiled** natif (`client/public/maps/default.tmj`). Tu l'édites
visuellement dans Tiled, tu prévisualises en local (Vite HMR), et quand c'est bon on
déploie sur `/v2`.

---

## 0. Pré-requis : récupérer la dernière version

Avant d'ouvrir Tiled, mets ton repo local à jour pour avoir la map + les **2 nouveaux
tilesets** (parquet + meubles cosy) :

```bash
git pull
```

Sinon tu n'auras ni le parquet ni les meubles LivingRoom dans la palette.

---

## 1. Installer / ouvrir

- Tiled : https://www.mapeditor.org/ (gratuit). `brew install --cask tiled` sur Mac.
- Ouvrir : `client/public/maps/default.tmj` (dans ton clone local).

Tu verras 3 panneaux : **Layers** (couches), **Tilesets** (palettes en bas), la carte au centre.

---

## 2. Les couches (panneau Layers)

| Couche          | Rôle                                              | Bloque ? |
|-----------------|---------------------------------------------------|----------|
| `ground`        | sol de base (herbe, dalles extérieures)           | non      |
| **`limezu_floor`** | **sols des salles (parquet, béton, moquette…)** | non      |
| `walls`         | murs + portes                                     | **oui**  |
| `furniture`     | mobilier                                          | **oui**  |
| `decoration`    | tapis, cadres muraux                              | non      |
| `collision`     | (objets) rectangles de collision custom           | —        |

👉 **Le sol des salles se peint sur `limezu_floor`**, PAS sur `ground`.

---

## 3. ⭐ Changer le parquet de la Réception en 5 étapes

1. **Clique la couche `limezu_floor`** dans le panneau Layers (elle devient active).
2. En bas, **onglet de palette `room_builder_big`** (le grand tileset 76 colonnes = tous les sols).
3. **Clique le parquet voulu**. Le n° affiché en bas (tile ID) te dit lequel c'est :
   - `1992` → **parquet brun moyen sobre** (mon préféré pour « pro »)
   - `2468` ou `2467` → **bois clair uni** (très sobre, look stratifié mat)
   - `853` → l'orangé actuel (à remplacer)
   - …ou balade-toi dans le bloc des sols pour en trouver un autre (voir piège ⚠️ ci-dessous)
4. **Outil Rectangle Fill** (touche **R**), puis **trace un rectangle** sur toute la zone
   lounge de la Réception (en bas/centre de la salle, hors coin garage gris).
5. **`Ctrl+S`** pour sauvegarder (garde le format `.tmj` / JSON).

⚠️ **Piège seamless** : dans `room_builder_big`, seule la tuile *de remplissage* d'un
matériau est sans joint. Si en remplissant tu vois des **lignes blanches ou sombres qui se
répètent**, tu as pris une tuile de *bord* → décale-toi d'1 tuile et reprends. Les IDs
`1992 / 2467 / 2468` ci-dessus sont déjà des remplissages propres.

---

## 4. Prévisualiser en local (instantané)

Dans le dossier du projet :

```bash
npm run dev
```

Ouvre l'URL localhost affichée. Vite recharge à chaque save Tiled (HMR) → tu vois le sol
changer en direct, **sans build**. Itère autant que tu veux.

---

## 5. Déployer sur /v2 quand c'est validé

```bash
git add client/public/maps/default.tmj
git commit -m "feat(reception): parquet sobre"
git push
```

Puis préviens-moi : je `git pull` sur le VPS + `npm run build:v2` → visible sur
`live.webinti.com/v2/` (hard reload `Ctrl+Shift+R`).

---

## 6. Autres tilesets dispo dans la map

`basic` · `room_builder` (office) · `office_shadow` (mobilier bureau) ·
`office_shadowless` · `gym_floor` · `gym_equip` · **`room_builder_big`** (sols/parquets) ·
**`livingroom`** (fauteuils rotin, pouf, palmiers, plantes cosy).

## 7. Pièges courants

- **Tuile qui bloque alors qu'elle ne devrait pas** : posée sur `furniture`/`walls`.
  Mets-la sur `decoration` (tapis) ou `limezu_floor` (sol).
- **Meuble multi-tuiles décalé** : Tiled aligne sur la grille 32×32 ; pose chaque tuile du
  meuble l'une à côté de l'autre.
- **Toujours sauvegarder en `.tmj` (JSON)**, jamais `.tmx` (XML).
- **Ne change pas l'ordre / les `firstgid` des tilesets** (ça casse toutes les références).
