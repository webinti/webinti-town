#!/usr/bin/env python3
"""
extend-map-racetrack — étend la map SOURCE vers l'EST pour y ajouter un grand
circuit de kart extérieur dédié, sans décaler l'existant.

Repart TOUJOURS de la copie pristine `default.tmj.preracetrack` (créée une fois)
et régénère `default.tmj` → idempotent, on peut ajuster les params et relancer.

Géométrie (tuiles de 32px) :
  - Largeur map 84 → NEW_W (ajout de colonnes à l'est).
  - FIELD : grande zone pelouse à l'est de la gym (nouvelles colonnes).
  - CONNECTOR : couloir pelouse reliant le jardin (ouest) au field (au-dessus
    de la gym).
  - Anneau asphalté (ASPHALT) = la piste ; intérieur pelouse.
  - Collisions de pourtour pour ne pas marcher dans le vide / hors-map.

Après ce script : lancer `npm run prepare-map` pour régénérer default.built.tmj.
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'client/public/maps')
SRC = os.path.join(MAPS, 'default.tmj.preracetrack')  # source pristine
OUT = os.path.join(MAPS, 'default.tmj')

GRASS = 1     # GID pelouse (tileset basic)
ASPHALT = 347 # GID sol gris (tileset room_builder, = sol du couloir gym)

# ── Paramètres de tracé (en TUILES) ────────────────────────────────────────
NEW_W = 116                 # 84 + 32 colonnes
# Field : nouvelles colonnes, pelouse
FIELD = dict(x0=84, x1=114, y0=1, y1=40)     # inclusif, tuiles pelouse
# Connector : couloir jardin → field, au-dessus de la gym
CONN = dict(x0=60, x1=83, y0=1, y1=8)
# Anneau asphalté (rectangle), épaisseur de piste THICK tuiles
RING = dict(x0=86, x1=113, y0=3, y1=38)
THICK = 2


def main():
    with open(SRC, encoding='utf-8') as f:
        m = json.load(f)
    W, H = m['width'], m['height']
    assert W == 84, f'attendu largeur source 84, vu {W}'

    # ── 1. Étendre la largeur de chaque tilelayer ───────────────────────────
    for l in m['layers']:
        if l.get('type') != 'tilelayer':
            continue
        old = l['data']
        new = [0] * (NEW_W * H)
        for ty in range(H):
            for tx in range(W):
                new[ty * NEW_W + tx] = old[ty * W + tx]
        l['data'] = new
        l['width'] = NEW_W
    m['width'] = NEW_W

    # Helper : écrire une tuile sur un layer nommé
    layers = {l['name']: l for l in m['layers'] if l.get('type') == 'tilelayer'}
    ground = layers['ground']['data']

    def set_ground(tx, ty, gid):
        if 0 <= tx < NEW_W and 0 <= ty < H:
            ground[ty * NEW_W + tx] = gid

    # ── 2. Pelouse : remplit toute tuile de sol VIDE à l'est de x>=60 (couvre le
    # field, le connector, et les poches de vide autour de la gym — celles-ci
    # restent scellées par les collisions, mais affichent de l'herbe plutôt qu'un
    # trou noir). On n'écrase jamais une tuile existante (jardin/gym/sol intérieur).
    FILL_X0 = CONN['x0']
    for ty in range(0, H):
        for tx in range(FILL_X0, NEW_W):
            if ground[ty * NEW_W + tx] == 0:
                set_ground(tx, ty, GRASS)

    # ── 3. Anneau asphalté ──────────────────────────────────────────────────
    for ty in range(RING['y0'], RING['y1'] + 1):
        for tx in range(RING['x0'], RING['x1'] + 1):
            on_border = (
                tx < RING['x0'] + THICK or tx > RING['x1'] - THICK or
                ty < RING['y0'] + THICK or ty > RING['y1'] - THICK
            )
            if on_border:
                set_ground(tx, ty, ASPHALT)
            # sinon : reste pelouse (intérieur du circuit)

    # ── 4. Collisions de pourtour (objectgroup 'collision') ─────────────────
    coll = next(l for l in m['layers'] if l.get('name') == 'collision')
    next_id = max((o.get('id', 0) for o in coll['objects']), default=0) + 1

    def add_wall(px, py, w, h):
        nonlocal next_id
        coll['objects'].append({
            'id': next_id, 'name': '', 'type': '', 'rotation': 0,
            'visible': True, 'x': px, 'y': py, 'width': w, 'height': h,
        })
        next_id += 1

    T = 32
    fx0, fx1, fy0, fy1 = FIELD['x0'], FIELD['x1'], FIELD['y0'], FIELD['y1']
    # Field : murs nord / sud / est ; ouest scellé sous le connector
    add_wall(fx0 * T, (fy0 - 1) * T, (fx1 - fx0 + 1) * T, T)          # nord
    add_wall(fx0 * T, (fy1 + 1) * T, (fx1 - fx0 + 1) * T, T)          # sud
    add_wall((fx1 + 1) * T, 0, T, H * T)                             # est (bord map)
    add_wall((fx0 - 1) * T, CONN['y1'] * T, T, (fy1 + 1 - CONN['y1']) * T)  # ouest (sous connector)
    # Connector : murs nord ; sud scellé là où ce n'est pas la gym (x60..63)
    add_wall(CONN['x0'] * T, (CONN['y0'] - 1) * T, (CONN['x1'] - CONN['x0'] + 1) * T, T)  # nord
    add_wall(CONN['x0'] * T, (CONN['y1'] + 1) * T, 4 * T, T)         # sud-ouest (x60..63)
    # Intérieur du circuit (pelouse centrale) = bloc plein → force la trajectoire
    # sur l'asphalte (anti-coupe + vrai ressenti de piste). On marche/roule sur
    # l'anneau, pas au travers.
    ix0, iy0 = RING['x0'] + THICK, RING['y0'] + THICK
    ix1, iy1 = RING['x1'] - THICK, RING['y1'] - THICK
    add_wall(ix0 * T, iy0 * T, (ix1 - ix0 + 1) * T, (iy1 - iy0 + 1) * T)

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(m, f, ensure_ascii=False)

    print(f'OK — map étendue {W}x{H} → {NEW_W}x{H} (px {NEW_W*T}x{H*T})')
    print(f'  field pelouse  : tuiles x{fx0}..{fx1} y{fy0}..{fy1}')
    print(f'  connector      : tuiles x{CONN["x0"]}..{CONN["x1"]} y{CONN["y0"]}..{CONN["y1"]}')
    print(f'  anneau asphalte: tuiles x{RING["x0"]}..{RING["x1"]} y{RING["y0"]}..{RING["y1"]} (epaisseur {THICK})')
    print(f'  collisions     : +{len(coll["objects"])} objets au total')


if __name__ == '__main__':
    main()
