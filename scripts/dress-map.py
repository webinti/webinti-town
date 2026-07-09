#!/usr/bin/env python3
"""Habillage extérieur de la map Webinti Town.

Ajoute sur les zones d'herbe nue : variation de texture, fleurs, chemins,
arbres (blocs 3x2 Interiors déjà utilisés au jardin), lampadaires, bancs,
+ rectangles de collision pour arbres/lampadaires/bancs.

Mode preview (défaut) : écrit une copie modifiée + rendu PNG, sans toucher
au fichier source. Mode --apply : écrit le vrai default.tmj.
"""
import json
import random
import sys

import os
SRC = os.path.join(os.path.dirname(__file__), "..", "client", "public", "maps", "default.tmj")
OUT_PREVIEW = "/tmp/preview.tmj"

FLIP = 0x80000000 | 0x40000000 | 0x20000000

# --- gids (tileset basic, firstgid=1) ---
GRASS = 1
GRASS_FLOWER_TINY = 2   # brin fleuri discret
GRASS_SPECKLED = 3      # herbe mouchetée
PATH = 5                # dalle grise (même que le trottoir existant)
FLOWER_RED = 137
FLOWER_YELLOW = 138
LAMPPOST = 139
BENCH_L, BENCH_R = 140, 141
# --- arbre 3x2 (tileset Interiors, déjà utilisé au jardin rows 5-6) ---
TREE = [[19293, 19294, 19295], [19309, 19310, 19311]]

m = json.load(open(SRC))
W, H = m["width"], m["height"]


def layer(name):
    for l in m["layers"]:
        if l["name"] == name:
            return l
    raise KeyError(name)


tile_layers = [l for l in m["layers"] if l["type"] == "tilelayer"]
ground = layer("ground")["data"]
furniture = layer("furniture")["data"]
decoration = layer("decoration")["data"]
racetrack = layer("racetrack")["data"]
collision = layer("collision")["objects"]


def idx(c, r):
    return r * W + c


def bare(c, r):
    """Herbe nue : gid 1 au sol et RIEN sur aucun autre calque."""
    if not (0 <= c < W and 0 <= r < H):
        return False
    i = idx(c, r)
    if (ground[i] & ~FLIP) != GRASS:
        return False
    for l in tile_layers:
        if l["name"] == "ground":
            continue
        if l["data"][i]:
            return False
    return True


def near_track(c, r, dist):
    """Vrai si une tuile racetrack est à moins de `dist` tuiles."""
    for rr in range(max(0, r - dist), min(H, r + dist + 1)):
        for cc in range(max(0, c - dist), min(W, c + dist + 1)):
            if racetrack[idx(cc, rr)]:
                return True
    return False


skipped = []


def block_bare(c, r, w, h, track_buffer=2):
    for rr in range(r, r + h):
        for cc in range(c, c + w):
            if not bare(cc, rr):
                return False
            if near_track(cc, rr, track_buffer):
                return False
    return True


next_id = m["nextobjectid"]


def add_collision(x, y, w, h):
    global next_id
    collision.append({
        "height": h, "id": next_id, "name": "", "opacity": 1,
        "rotation": 0, "type": "", "visible": True,
        "width": w, "x": x, "y": y,
    })
    next_id += 1


# ---------------------------------------------------------------------------
# 1. CHEMINS (calque ground, remplace l'herbe nue uniquement)
# ---------------------------------------------------------------------------
path_cells = []
# Vertical : sous la sortie du couloir bâtiment→gym (cols 61-62, rows 18..32)
for r in range(18, 33):
    for c in (61, 62):
        path_cells.append((c, r))
# Horizontal : vers le circuit (rows 31-32, cols 63..84)
for c in range(63, 85):
    for r in (31, 32):
        path_cells.append((c, r))
placed_path = 0
for c, r in path_cells:
    if bare(c, r):
        ground[idx(c, r)] = PATH
        placed_path += 1
    else:
        skipped.append(("path", c, r))

# ---------------------------------------------------------------------------
# 2. ARBRES (furniture) + collision au pied
# ---------------------------------------------------------------------------
tree_spots = [
    # bande haute, continue le rythme du jardin (rows 4-6)
    (36, 5), (44, 4), (52, 5), (60, 4), (68, 5), (76, 4),
    # prairie sud entre bâtiment et circuit
    (65, 25), (72, 27), (78, 24), (64, 34), (71, 36), (79, 34), (75, 30),
    # intérieur de l'anneau du circuit (si la place le permet)
    (97, 15), (101, 25),
]
placed_trees = []
for c, r in tree_spots:
    if not block_bare(c, r, 3, 2):
        skipped.append(("tree", c, r))
        continue
    for dr, row in enumerate(TREE):
        for dc, gid in enumerate(row):
            furniture[idx(c + dc, r + dr)] = gid
    # collision sur le tronc (bas-centre du bloc 96x64)
    add_collision(c * 32 + 24, (r + 1) * 32 + 6, 48, 22)
    placed_trees.append((c, r))

# ---------------------------------------------------------------------------
# 3. LAMPADAIRES (furniture) + petite collision — positions aussi utilisées
#    par les lumières nocturnes côté code (GameScene).
# ---------------------------------------------------------------------------
lamp_spots = [(60, 20), (60, 27), (66, 30), (76, 30), (84, 30)]
placed_lamps = []
for c, r in lamp_spots:
    if not bare(c, r) or near_track(c, r, 2):
        skipped.append(("lamp", c, r))
        continue
    furniture[idx(c, r)] = LAMPPOST
    add_collision(c * 32 + 10, r * 32 + 18, 12, 12)
    placed_lamps.append((c, r))

# ---------------------------------------------------------------------------
# 4. BANCS (furniture, 2 tuiles) + collision
# ---------------------------------------------------------------------------
bench_spots = [(67, 33), (80, 28)]
placed_benches = []
for c, r in bench_spots:
    if not (bare(c, r) and bare(c + 1, r)) or near_track(c, r, 2) or near_track(c + 1, r, 2):
        skipped.append(("bench", c, r))
        continue
    furniture[idx(c, r)] = BENCH_L
    furniture[idx(c + 1, r)] = BENCH_R
    add_collision(c * 32 + 2, r * 32 + 10, 60, 16)
    placed_benches.append((c, r))

# ---------------------------------------------------------------------------
# 5. VARIATION D'HERBE + FLEURS (ground, cellules nues restantes)
# ---------------------------------------------------------------------------
rng = random.Random(20260709)
n_var = n_flo = 0
for r in range(H):
    for c in range(W):
        if not bare(c, r):
            continue
        roll = rng.random()
        if roll < 0.075:
            ground[idx(c, r)] = GRASS_SPECKLED
            n_var += 1
        elif roll < 0.09:
            ground[idx(c, r)] = GRASS_FLOWER_TINY
            n_var += 1
        elif roll < 0.098:
            ground[idx(c, r)] = FLOWER_RED if rng.random() < 0.5 else FLOWER_YELLOW
            n_flo += 1

m["nextobjectid"] = next_id

apply = "--apply" in sys.argv
out = SRC if apply else OUT_PREVIEW
json.dump(m, open(out, "w"), separators=(",", ":"))
print(f"écrit: {out}")
print(f"chemin: {placed_path} dalles | arbres: {len(placed_trees)} {placed_trees}")
print(f"lampadaires: {placed_lamps} | bancs: {placed_benches}")
print(f"herbe variée: {n_var} | fleurs: {n_flo}")
if skipped:
    print(f"ignorés ({len(skipped)}): {skipped[:20]}")
