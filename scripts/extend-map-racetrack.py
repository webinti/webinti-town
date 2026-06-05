#!/usr/bin/env python3
"""
extend-map-racetrack — étend la map SOURCE vers l'EST et y peint un VRAI circuit
de kart dessiné (anneau arrondi, surface rouge, lignes de couloirs, vibreurs
blancs, barrières jaune/noir), sans décaler l'existant.

Repart TOUJOURS de la copie pristine `default.tmj.preracetrack` → idempotent.

Pipeline :
  1. élargit la map 84 → NEW_W (colonnes ajoutées à l'est)
  2. remplit la nouvelle zone de pelouse (sous la piste ; le rendu de piste a un
     fond TRANSPARENT donc la pelouse de la map traverse → pas de raccord)
  3. RENDU PIL d'une image de piste (RGBA, transparente hors-piste) → tileset
     `racetrack.png` ; ajoute le tileset + un calque 'racetrack' qui la pose
  4. collisions : intérieur plein (force la trajectoire) + barrières + connecteur

Après : `npm run prepare-map` régénère default.built.tmj.
"""
import json, os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'client/public/maps')
TILESETS = os.path.join(ROOT, 'client/public/assets/tilesets')
SRC = os.path.join(MAPS, 'default.tmj.preracetrack')
OUT = os.path.join(MAPS, 'default.tmj')
RACE_PNG = os.path.join(TILESETS, 'racetrack.png')

T = 32
GRASS = 1            # GID pelouse (sous la piste)

# ── Géométrie (tuiles) ──────────────────────────────────────────────────────
NEW_W = 116                                  # 84 + 32 colonnes
FIELD = dict(x0=84, x1=115, y0=0, y1=41)     # nouvelles colonnes (zone piste)
CONN = dict(x0=60, x1=83, y0=1, y1=8)        # couloir jardin → field

# Image de piste = exactement la taille du field, en px
FW = (FIELD['x1'] - FIELD['x0'] + 1) * T     # 1024
FH = (FIELD['y1'] - FIELD['y0'] + 1) * T     # 1344
FOX = FIELD['x0'] * T                         # origine px monde du field (x=2688)
FOY = FIELD['y0'] * T                         # (y=0)

# ── Paramètres visuels de la piste (px, repère image field) ─────────────────
M = 40            # marge bord field → bord extérieur piste
TW = 168          # largeur de piste
RO = 230          # rayon coin extérieur
RI = max(28, RO - TW)
NLANES = 6        # nombre de couloirs (lignes blanches)
# Couleurs
COL_TRACK = (190, 64, 66, 255)     # rouge piste (style athlétisme)
COL_LANE = (236, 236, 236, 190)    # lignes de couloirs
COL_CURB = (245, 245, 245, 255)    # vibreurs (bord intérieur/extérieur)
COL_YEL = (245, 205, 40, 255)
COL_BLK = (28, 28, 28, 255)

# Rectangles extérieur / intérieur de l'anneau (image field)
OUT_BOX = (M, M, FW - M, FH - M)
IN_BOX = (M + TW, M + TW, FW - M - TW, FH - M - TW)


def rrect(d, box, r, **kw):
    d.rounded_rectangle(box, radius=r, **kw)


def render_track():
    img = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 1. Barrière jaune/noir : anneau rayé juste à l'extérieur de la piste.
    stripe = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripe)
    SW = 22
    for i in range(-FH, FW + FH, SW):
        color = COL_YEL if (i // SW) % 2 == 0 else COL_BLK
        sd.polygon([(i, 0), (i + SW, 0), (i + SW - FH, FH), (i - FH, FH)], fill=color)
    bar_mask = Image.new('L', (FW, FH), 0)
    bd = ImageDraw.Draw(bar_mask)
    bd.rounded_rectangle((M - 16, M - 16, FW - M + 16, FH - M + 16), radius=RO + 16, fill=255)
    bd.rounded_rectangle(OUT_BOX, radius=RO, fill=0)
    img.paste(stripe, (0, 0), bar_mask)

    # 2. Surface de piste (rouge), puis on évide l'intérieur (pelouse traverse).
    rrect(d, OUT_BOX, RO, fill=COL_TRACK)
    rrect(d, IN_BOX, RI, fill=(0, 0, 0, 0))

    # 3. Lignes de couloirs (concentriques entre extérieur et intérieur).
    for i in range(1, NLANES):
        ins = TW * i / NLANES
        box = (M + ins, M + ins, FW - M - ins, FH - M - ins)
        r = max(6, RO - ins)
        rrect(d, box, r, outline=COL_LANE, width=2)

    # 4. Vibreurs blancs aux deux bords de la piste.
    rrect(d, OUT_BOX, RO, outline=COL_CURB, width=5)
    rrect(d, IN_BOX, RI, outline=COL_CURB, width=5)

    # 5. Ligne départ/arrivée : damier en travers de la ligne du bas (centre x).
    cx = FW // 2
    by0, by1 = FH - M - TW, FH - M    # bande de piste du bas
    sq = 14
    for gy in range(int(by0), int(by1), sq):
        for k, gx in enumerate(range(cx - 28, cx + 28, sq)):
            row = (gy - int(by0)) // sq
            color = COL_BLK if (k + row) % 2 == 0 else COL_CURB
            d.rectangle([gx, gy, gx + sq, gy + sq], fill=color)

    img.save(RACE_PNG)
    return img


def main():
    track_img = render_track()

    with open(SRC, encoding='utf-8') as f:
        m = json.load(f)
    W, H = m['width'], m['height']
    assert W == 84, f'attendu largeur source 84, vu {W}'

    # ── 1. Élargir chaque tilelayer ─────────────────────────────────────────
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

    layers = {l['name']: l for l in m['layers'] if l.get('type') == 'tilelayer'}
    ground = layers['ground']['data']

    # ── 2. Pelouse sur toute tuile vide à l'est (field + connector + poches) ──
    for ty in range(0, H):
        for tx in range(CONN['x0'], NEW_W):
            if ground[ty * NEW_W + tx] == 0:
                ground[ty * NEW_W + tx] = GRASS

    # ── 3. Tileset + calque 'racetrack' ─────────────────────────────────────
    cols = (FIELD['x1'] - FIELD['x0'] + 1)       # 32
    rows = (FIELD['y1'] - FIELD['y0'] + 1)       # 42
    firstgid = max(ts['firstgid'] + ts.get('tilecount', 0) for ts in m['tilesets'])
    m['tilesets'].append({
        'firstgid': firstgid,
        'name': 'racetrack',
        'image': '../assets/tilesets/racetrack.png',
        'imagewidth': FW, 'imageheight': FH,
        'tilewidth': T, 'tileheight': T,
        'columns': cols, 'tilecount': cols * rows,
        'margin': 0, 'spacing': 0,
    })
    # data du calque : poser chaque tuile NON entièrement transparente
    alpha = track_img.split()[3]
    data = [0] * (NEW_W * H)
    for ry in range(rows):
        for rx in range(cols):
            tile = alpha.crop((rx * T, ry * T, rx * T + T, ry * T + T))
            if tile.getbbox() is None:
                continue   # tuile vide → laisser 0
            localid = ry * cols + rx
            tx, ty = FIELD['x0'] + rx, FIELD['y0'] + ry
            data[ty * NEW_W + tx] = firstgid + localid
    race_layer = {
        'type': 'tilelayer', 'name': 'racetrack', 'visible': True, 'opacity': 1,
        'x': 0, 'y': 0, 'width': NEW_W, 'height': H, 'data': data,
    }
    # insérer juste après 'ground' (au-dessus de la pelouse, sous le reste)
    gi = next(i for i, l in enumerate(m['layers']) if l.get('name') == 'ground')
    m['layers'].insert(gi + 1, race_layer)

    # ── 4. Collisions ───────────────────────────────────────────────────────
    coll = next(l for l in m['layers'] if l.get('name') == 'collision')
    nid = max((o.get('id', 0) for o in coll['objects']), default=0) + 1

    def wall(px, py, w, h):
        nonlocal nid
        coll['objects'].append({'id': nid, 'name': '', 'type': '', 'rotation': 0,
                                'visible': True, 'x': px, 'y': py, 'width': w, 'height': h})
        nid += 1

    # Intérieur plein (bloc inscrit dans l'anneau intérieur) → force l'asphalte.
    ix0 = FOX + IN_BOX[0] + RI
    iy0 = FOY + IN_BOX[1] + RI
    ix1 = FOX + IN_BOX[2] - RI
    iy1 = FOY + IN_BOX[3] - RI
    wall(ix0, iy0, ix1 - ix0, iy1 - iy0)

    # Barrières extérieures (4 murs droits au bord ext. de la piste). Le mur
    # gauche laisse une OUVERTURE au niveau du connecteur (entrée paddock).
    ox0, oy0, ox1, oy1 = FOX + OUT_BOX[0], FOY + OUT_BOX[1], FOX + OUT_BOX[2], FOY + OUT_BOX[3]
    wall(ox0, oy0 - T, ox1 - ox0, T)                 # haut
    wall(ox0, oy1, ox1 - ox0, T)                     # bas
    wall(ox1, oy0, T, oy1 - oy0)                      # droite
    conn_y0, conn_y1 = CONN['y0'] * T, (CONN['y1'] + 1) * T
    wall(ox0 - T, oy0, T, max(0, conn_y0 - oy0))      # gauche au-dessus du connecteur
    wall(ox0 - T, conn_y1, T, max(0, oy1 - conn_y1))  # gauche en-dessous

    # Scellés du connecteur (vide autour de la gym).
    wall(CONN['x0'] * T, (CONN['y0'] - 1) * T, (CONN['x1'] - CONN['x0'] + 1) * T, T)  # nord
    wall(CONN['x0'] * T, (CONN['y1'] + 1) * T, 4 * T, T)                               # sud-ouest

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(m, f, ensure_ascii=False)

    print(f'OK — map {W}x{H} → {NEW_W}x{H} ; tileset racetrack firstgid={firstgid}')
    print(f'  image piste : {FW}x{FH}px → {RACE_PNG}')
    print(f'  collisions  : {len(coll["objects"])} objets')
    # Checkpoints suggérés (ligne médiane de piste, en px MONDE) :
    cl = M + TW / 2
    cps = [
        ('0 bas/depart', FOX + FW / 2, FOY + FH - cl),
        ('1 droite', FOX + FW - cl, FOY + FH / 2),
        ('2 haut', FOX + FW / 2, FOY + cl),
        ('3 gauche', FOX + cl, FOY + FH / 2),
    ]
    print('  checkpoints (centre x,y monde) :')
    for n, x, y in cps:
        print(f'    {n}: ({x:.0f}, {y:.0f})')


if __name__ == '__main__':
    main()
