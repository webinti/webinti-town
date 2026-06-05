#!/usr/bin/env python3
"""
extend-map-racetrack — étend la map vers l'EST et y peint un VRAI circuit de kart
avec COURBES (chemin libre via spline Catmull-Rom), sans décaler l'existant.

Repart TOUJOURS de `default.tmj.preracetrack` (pristine) → idempotent.

Pipeline :
  1. élargit la map 84 → NEW_W (colonnes à l'est)
  2. pelouse sur la nouvelle zone (la piste a un fond transparent → l'herbe passe)
  3. RENDU PIL de la piste le long d'un CHEMIN : barrières jaune/noir, vibreurs
     blancs, asphalte rouge, ligne médiane pointillée, damier départ → tileset
     `racetrack.png` + calque 'racetrack'
  4. collision STRICTE : tout ce qui n'est pas la piste (ni le paddock d'entrée)
     est un mur → on suit forcément le tracé. Plus scellés du connecteur.
  5. imprime les checkpoints (le long du tracé) et la grille de karts à recopier.

Après : `npm run prepare-map`.
"""
import json, os, math
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'client/public/maps')
TILESETS = os.path.join(ROOT, 'client/public/assets/tilesets')
SRC = os.path.join(MAPS, 'default.tmj.preracetrack')
OUT = os.path.join(MAPS, 'default.tmj')
RACE_PNG = os.path.join(TILESETS, 'racetrack.png')

T = 32
GRASS = 1
NEW_W = 116
FIELD = dict(x0=84, x1=115, y0=0, y1=41)
CONN = dict(x0=60, x1=83, y0=1, y1=8)

FW = (FIELD['x1'] - FIELD['x0'] + 1) * T     # 1024
FH = (FIELD['y1'] - FIELD['y0'] + 1) * T     # 1344
FOX = FIELD['x0'] * T                          # origine monde x = 2688
FOY = FIELD['y0'] * T                          # 0

# ── Tracé : points de contrôle (repère image field), boucle fermée ──────────
# Départ en bas-centre (près de la grille), sens horaire-ish avec une chicane.
CONTROL = [
    (512, 1205),   # 0 bas-centre — DÉPART
    (235, 1120),   # bas-gauche
    (150, 820),    # gauche bas
    (175, 470),    # gauche haut
    (300, 235),    # haut-gauche
    (560, 180),    # haut-centre
    (815, 250),    # haut-droite
    (885, 520),    # droite haut
    (690, 660),    # chicane (rentre)
    (885, 870),    # chicane (ressort)
    (815, 1110),   # bas-droite
]

# Largeurs (px)
TW = 150          # largeur d'asphalte
CURB = 6          # vibreur blanc (chaque bord)
BAR = 14          # barrière jaune/noir
ENTRANCE = dict(x0=0, x1=250, y0=24, y1=300)   # paddock : connecteur → piste

COL_TRACK = (190, 64, 66, 255)
COL_CENTER = (240, 240, 240, 150)
COL_CURB = (245, 245, 245, 255)
COL_YEL = (245, 205, 40, 255)
COL_BLK = (28, 28, 28, 255)
N_CHECKPOINTS = 6


def catmull_rom(points, samples_per_seg=24):
    """Spline Catmull-Rom passant par les points (boucle fermée)."""
    n = len(points)
    out = []
    for i in range(n):
        p0 = points[(i - 1) % n]
        p1 = points[i]
        p2 = points[(i + 1) % n]
        p3 = points[(i + 2) % n]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
                       (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
                       (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
                       (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
                       (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    out.append(out[0])
    return out


PATH = catmull_rom(CONTROL)


def dist_point_seg(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def dist_to_path(px, py):
    best = 1e9
    for i in range(len(PATH) - 1):
        ax, ay = PATH[i]
        bx, by = PATH[i + 1]
        d = dist_point_seg(px, py, ax, ay, bx, by)
        if d < best:
            best = d
    return best


def render_track():
    img = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    line = [(int(x), int(y)) for x, y in PATH]

    # 1. Barrière jaune/noir (anneau autour de la piste) via masque + rayures.
    outer = TW + 2 * CURB + 2 * BAR
    inner = TW + 2 * CURB
    mask = Image.new('L', (FW, FH), 0)
    md = ImageDraw.Draw(mask)
    md.line(line, fill=255, width=outer, joint='curve')
    md.line(line, fill=0, width=inner, joint='curve')
    stripe = Image.new('RGBA', (FW, FH), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stripe)
    SW = 20
    for i in range(-FH, FW + FH, SW):
        c = COL_YEL if (i // SW) % 2 == 0 else COL_BLK
        sd.polygon([(i, 0), (i + SW, 0), (i + SW - FH, FH), (i - FH, FH)], fill=c)
    img.paste(stripe, (0, 0), mask)

    # 2. Vibreurs blancs (bord), puis asphalte par-dessus.
    d.line(line, fill=COL_CURB, width=TW + 2 * CURB, joint='curve')
    d.line(line, fill=COL_TRACK, width=TW, joint='curve')

    # 3. Ligne médiane pointillée.
    dash, gap, acc, draw_on = 26, 22, 0.0, True
    for i in range(len(PATH) - 1):
        ax, ay = PATH[i]
        bx, by = PATH[i + 1]
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-6:
            continue
        pos = 0.0
        while pos < seg:
            step = min((dash if draw_on else gap) - acc, seg - pos)
            if draw_on:
                t0, t1 = pos / seg, (pos + step) / seg
                d.line([(ax + (bx - ax) * t0, ay + (by - ay) * t0),
                        (ax + (bx - ax) * t1, ay + (by - ay) * t1)],
                       fill=COL_CENTER, width=3)
            acc += step
            pos += step
            if acc >= (dash if draw_on else gap):
                acc = 0.0
                draw_on = not draw_on

    # 4. Ligne départ/arrivée : damier en travers de la piste au point 0.
    sx, sy = PATH[0]
    sq = 13
    for r in range(-1, TW // (2 * sq) + 1):
        for c in range(int(-TW / 2 / sq) - 1, int(TW / 2 / sq) + 1):
            color = COL_BLK if (r + c) % 2 == 0 else COL_CURB
            x0 = int(sx + c * sq)
            y0 = int(sy - 6 + r * sq)
            d.rectangle([x0, y0, x0 + sq, y0 + sq], fill=color)

    img.save(RACE_PNG)
    return img


def main():
    track_img = render_track()
    DRIVE_R = TW / 2 + CURB + 12   # rayon "roulable" (un peu > visuel)

    with open(SRC, encoding='utf-8') as f:
        m = json.load(f)
    W, H = m['width'], m['height']
    assert W == 84

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
    for ty in range(H):
        for tx in range(CONN['x0'], NEW_W):
            if ground[ty * NEW_W + tx] == 0:
                ground[ty * NEW_W + tx] = GRASS

    # Tileset + calque racetrack
    cols = FIELD['x1'] - FIELD['x0'] + 1
    rows = FIELD['y1'] - FIELD['y0'] + 1
    firstgid = max(ts['firstgid'] + ts.get('tilecount', 0) for ts in m['tilesets'])
    m['tilesets'].append({
        'firstgid': firstgid, 'name': 'racetrack',
        'image': '../assets/tilesets/racetrack.png',
        'imagewidth': FW, 'imageheight': FH, 'tilewidth': T, 'tileheight': T,
        'columns': cols, 'tilecount': cols * rows, 'margin': 0, 'spacing': 0,
    })
    alpha = track_img.split()[3]
    rdata = [0] * (NEW_W * H)
    for ry in range(rows):
        for rx in range(cols):
            if alpha.crop((rx * T, ry * T, rx * T + T, ry * T + T)).getbbox() is None:
                continue
            tx, ty = FIELD['x0'] + rx, FIELD['y0'] + ry
            rdata[ty * NEW_W + tx] = firstgid + (ry * cols + rx)
    race_layer = {'type': 'tilelayer', 'name': 'racetrack', 'visible': True,
                  'opacity': 1, 'x': 0, 'y': 0, 'width': NEW_W, 'height': H, 'data': rdata}
    gi = next(i for i, l in enumerate(m['layers']) if l.get('name') == 'ground')
    m['layers'].insert(gi + 1, race_layer)

    # ── Collision STRICTE : tuiles non-roulables du field → murs ────────────
    def drivable(fx, fy):
        cx, cy = fx * T + T / 2, fy * T + T / 2            # centre tuile (field-local)
        if (ENTRANCE['x0'] <= cx <= ENTRANCE['x1'] and
                ENTRANCE['y0'] <= cy <= ENTRANCE['y1']):
            return True
        return dist_to_path(cx, cy) <= DRIVE_R

    coll = next(l for l in m['layers'] if l.get('name') == 'collision')
    nid = max((o.get('id', 0) for o in coll['objects']), default=0) + 1

    def wall(px, py, w, h):
        nonlocal nid
        coll['objects'].append({'id': nid, 'name': '', 'type': '', 'rotation': 0,
                                'visible': True, 'x': px, 'y': py, 'width': w, 'height': h})
        nid += 1

    walls_added = 0
    for fy in range(rows):
        rx = 0
        while rx < cols:
            if drivable(rx, fy):
                rx += 1
                continue
            run = rx
            while run < cols and not drivable(run, fy):
                run += 1
            wall(FOX + rx * T, FOY + fy * T, (run - rx) * T, T)
            walls_added += 1
            rx = run

    # Scellés du connecteur (vide autour de la gym).
    wall(CONN['x0'] * T, (CONN['y0'] - 1) * T, (CONN['x1'] - CONN['x0'] + 1) * T, T)
    wall(CONN['x0'] * T, (CONN['y1'] + 1) * T, 4 * T, T)

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(m, f, ensure_ascii=False)

    # ── Checkpoints le long du tracé (longueur d'arc régulière) ─────────────
    seglen = [math.hypot(PATH[i + 1][0] - PATH[i][0], PATH[i + 1][1] - PATH[i][1])
              for i in range(len(PATH) - 1)]
    total = sum(seglen)
    targets = [total * k / N_CHECKPOINTS for k in range(N_CHECKPOINTS)]
    cps, acc, ti = [], 0.0, 0
    for i in range(len(seglen)):
        while ti < len(targets) and targets[ti] <= acc + seglen[i]:
            f = (targets[ti] - acc) / seglen[i] if seglen[i] else 0
            x = PATH[i][0] + (PATH[i + 1][0] - PATH[i][0]) * f
            y = PATH[i][1] + (PATH[i + 1][1] - PATH[i][1]) * f
            cps.append((FOX + x, FOY + y))
            ti += 1
        acc += seglen[i]

    # Grille de karts : 4 points juste avant le départ (fin de boucle).
    grid = [PATH[len(PATH) - 1 - k * 10] for k in (2, 3, 4, 5)]
    grid = [(FOX + x, FOY + y) for x, y in grid]

    print(f'OK — map {W}x{H} → {NEW_W}x{H} ; {walls_added} murs ; {len(coll["objects"])} collisions')
    print('  CHECKPOINTS (recopier dans circuit.ts, gates ~110x110) :')
    for n, (x, y) in enumerate(cps):
        print(f'    {n}: x={x - 55:.0f}, y={y - 55:.0f}  (centre {x:.0f},{y:.0f})')
    print('  GRILLE KARTS (recopier dans server/src/karts.ts) :')
    for n, (x, y) in enumerate(grid):
        print(f'    kart-{6+n}: parkingX={x:.0f}, parkingY={y:.0f}')


if __name__ == '__main__':
    main()
