#!/usr/bin/env python3
"""
build-avatars — convertit le Character Generator LimeZu (Modern Interiors) en
spritesheets en couches prêtes pour le jeu (Player.ts / avatarFrames.ts).

Source (local, hors repo) :
  ~/Downloads/moderninteriors-win/2_Characters/Character_Generator/{Bodies,Outfits,Hairstyles,Eyes}/32x32

Sortie :
  client/public/assets/avatars/{body,outfit,hair}.png

Format de l'atlas LimeZu (décodé) :
  - chaque pose = 32 (large) x 64 (haut)
  - rangée IDLE  à y=64 ; rangée WALK à y=128
  - blocs de 6 frames par direction : bas=cols 0-5, haut=6-11, GAUCHE=12-17
    (la droite n'est PAS dessinée séparément -> on miroite la gauche)

Format de sortie (attendu par avatarFrames.animatedFrame) :
  cell = 32 x 64 ; cols = 3 phases [idle, walkA, walkB]
  row  = variant*4 + dirIndex   (dir: down=0, left=1, right=2, up=3)
  frame index = (variant*4 + dir)*3 + phase
"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GEN = os.path.expanduser('~/Downloads/moderninteriors-win/2_Characters/Character_Generator')
OUT = os.path.join(ROOT, 'client/public/assets/avatars')

CELL_W, CELL_H = 32, 64
IDLE_Y, WALK_Y = 64, 128          # y des rangées idle / walk
# colonnes de départ de chaque bloc directionnel (6 frames/bloc).
# Ordre LimeZu décodé empiriquement (symétrie + visage) :
#   col 0 = droite, col 6 = haut (dos), col 12 = gauche, col 18 = bas (face).
BLOCK = {'right': 0, 'up': 6, 'left': 12, 'down': 18}
WALK_A, WALK_B = 1, 4             # frames de marche (jambes opposées)
IDLE_F = 0                        # frame neutre

# --- sélections curatées (indices de variantes du jeu) ---
SKINS = [f'Bodies/32x32/Body_32x32_0{i}.png' for i in range(1, 10)]   # 9 teints

# 8 coiffures : 6 réalistes (courtes/moyennes) + 2 longues féminines (27 longs,
# 28 couettes). Les cheveux "réalistes" (bruns/noir) et "longs" (vifs) n'ont PAS
# les mêmes teintes dans LimeZu : chaque style porte donc sa propre palette de 4
# couleurs (slot hairColor 0..3). variant = styleIndex*4 + colorIndex.
HAIR_COLOR_COUNT = 4
NATURAL_COLORS = ['04', '02', '01', '07']   # brun foncé, brun, auburn, noir
LONG_COLORS    = ['06', '05', '01', '04']   # roux, blond, rose, bleu
HAIR_STYLE_COLORS = [
    ('01', NATURAL_COLORS), ('03', NATURAL_COLORS), ('05', NATURAL_COLORS),
    ('08', NATURAL_COLORS), ('12', NATURAL_COLORS), ('20', NATURAL_COLORS),
    ('27', LONG_COLORS),    ('28', LONG_COLORS),
]
HAIR_STYLES = [s for s, _ in HAIR_STYLE_COLORS]
HAIRS = [f'Hairstyles/32x32/Hairstyle_{s}_32x32_{c}.png'
         for s, colors in HAIR_STYLE_COLORS for c in colors]

# 13 tenues : 12 hauts unisexes + 1 robe longue (33), option clairement féminine.
OUTFIT_MODELS = ['01', '05', '07', '10', '14', '18', '21', '24', '25', '28', '31', '32', '33']
OUTFITS = [f'Outfits/32x32/Outfit_{m}_32x32_01.png' for m in OUTFIT_MODELS]   # 13 tenues

EYES = 'Eyes/32x32/Eyes_32x32_01.png'                                # yeux par défaut


def load(rel):
    p = os.path.join(GEN, rel)
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    return Image.open(p).convert('RGBA')


def pose(sheet, block_col, y, frame, eyes=None):
    """Découpe une cellule 32x64 du bloc directionnel `block_col`, frame `frame`.
    Compose les yeux (même cellule) si fournis — les planches ont des largeurs
    différentes, donc on compose au niveau cellule, pas planche entière."""
    x = (block_col + frame) * CELL_W
    cell = sheet.crop((x, y, x + CELL_W, y + CELL_H))
    if eyes is not None:
        cell.alpha_composite(eyes.crop((x, y, x + CELL_W, y + CELL_H)))
    return cell


def variant_frames(sheet, eyes=None):
    """Rend les 12 cellules (4 dirs x 3 phases) d'une variante, ordre jeu
    down/left/right/up (= avatarFrames.DIR_INDEX). Les 4 directions sont
    dessinées dans la planche LimeZu — pas de miroir."""
    def trio(block):
        return [pose(sheet, block, IDLE_Y, IDLE_F, eyes),
                pose(sheet, block, WALK_Y, WALK_A, eyes),
                pose(sheet, block, WALK_Y, WALK_B, eyes)]
    return (trio(BLOCK['down']) + trio(BLOCK['left'])
            + trio(BLOCK['right']) + trio(BLOCK['up']))   # 12 cellules


def build_layer(files, name, eyes=None):
    n = len(files)
    sheet = Image.new('RGBA', (3 * CELL_W, n * 4 * CELL_H), (0, 0, 0, 0))
    for vi, rel in enumerate(files):
        src = load(rel)
        cells = variant_frames(src, eyes)    # yeux incrustés cellule par cellule
        for k, cell in enumerate(cells):     # k = dir*3 + phase
            col = k % 3
            row = vi * 4 + (k // 3)
            sheet.alpha_composite(cell, (col * CELL_W, row * CELL_H))
    out = os.path.join(OUT, f'{name}.png')
    sheet.save(out)
    print(f'  {name}.png  {sheet.size}  ({n} variantes, {n*4*CELL_H}px de haut)')
    if sheet.height > 8192:
        print(f'    ! ATTENTION: {sheet.height}px > 8192 (limite GPU sûre)')


def main():
    os.makedirs(OUT, exist_ok=True)
    eyes = load(EYES)
    print('[build-avatars] génération des spritesheets en couches (32x64)...')
    build_layer(SKINS, 'body', eyes=eyes)
    build_layer(OUTFITS, 'outfit')
    build_layer(HAIRS, 'hair')
    print(f'[build-avatars] OK -> {OUT}')
    print(f'  skins={len(SKINS)}  outfits={len(OUTFITS)}  '
          f'hair={len(HAIRS)} ({len(HAIR_STYLES)} styles x {HAIR_COLOR_COUNT} couleurs)')


if __name__ == '__main__':
    try:
        main()
    except FileNotFoundError as e:
        print('[build-avatars] ERREUR fichier introuvable:', e)
        sys.exit(1)
