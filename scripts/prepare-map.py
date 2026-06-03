#!/usr/bin/env python3
"""
prepare-map — transforme la map SOURCE éditée dans Tiled en map prête pour le jeu.

  source : client/public/maps/default.tmj      (TU l'édites librement dans Tiled)
  sortie : client/public/maps/default.built.tmj (le jeu charge celle-ci)

Ce que ça fait, sans jamais toucher à la source :
  - copie dans le projet les images de tilesets qui pointent ailleurs (ex. ~/Downloads)
  - corrige les chemins d'image en ../assets/tilesets/<fichier>
  - REPACK les mégaplanches trop grandes pour le GPU (> LIMIT px) : n'extrait que
    les tuiles réellement utilisées dans une petite image, et remappe les gids
  - laisse les tilesets normaux tels quels

Usage:
  python3 scripts/prepare-map.py            # une passe
  python3 scripts/prepare-map.py --watch     # régénère à chaque sauvegarde Tiled
"""
import json, os, sys, time, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, 'client/public/maps')
ASSETS = os.path.join(ROOT, 'client/public/assets/tilesets')
SRC = os.path.join(MAPS, 'default.tmj')
OUT = os.path.join(MAPS, 'default.built.tmj')
LIMIT = 8192            # marge sûre sous la limite GPU WebGL (~16384)
FLIP = 0x80000000 | 0x40000000 | 0x20000000

try:
    from PIL import Image
except ImportError:
    print('[prepare-map] ERREUR: Pillow manquant. Installe-le : pip3 install Pillow')
    sys.exit(1)


def build_once():
    with open(SRC, encoding='utf-8') as f:
        m = json.load(f)

    notes = []
    for ts in m['tilesets']:
        if 'image' not in ts:           # collection d'images : ignoré (non utilisé ici)
            continue
        base = os.path.basename(ts['image'])
        dst = os.path.join(ASSETS, base)

        # localiser l'image source (chemin relatif au dossier maps)
        src_img = os.path.normpath(os.path.join(MAPS, ts['image']))
        if not os.path.exists(src_img):
            src_img = dst  # déjà dans les assets ?
        if not os.path.exists(src_img):
            notes.append(f"  ! image introuvable pour '{ts['name']}' ({base}) — ignoré")
            continue

        im = Image.open(src_img).convert('RGBA')
        w, h = im.size

        if max(w, h) > LIMIT:
            # --- REPACK : n'extraire que les tuiles utilisées ---
            fg = ts['firstgid']
            cols = ts['columns']
            end = fg + ts['tilecount'] - 1
            used = sorted({(g & ~FLIP) - fg
                           for l in m['layers'] if l['type'] == 'tilelayer'
                           for g in l['data'] if fg <= (g & ~FLIP) <= end})
            if not used:
                used = [0]
            mapping = {old: i for i, old in enumerate(used)}
            n, ncols = len(used), 16
            nrows = (n + ncols - 1) // ncols
            packed = Image.new('RGBA', (ncols * 32, nrows * 32), (0, 0, 0, 0))
            for old, new in mapping.items():
                sx, sy = (old % cols) * 32, (old // cols) * 32
                dx, dy = (new % ncols) * 32, (new // ncols) * 32
                packed.paste(im.crop((sx, sy, sx + 32, sy + 32)), (dx, dy))
            packed_name = os.path.splitext(base)[0] + '.packed.png'
            packed.save(os.path.join(ASSETS, packed_name))
            ts['image'] = f'../assets/tilesets/{packed_name}'
            ts['columns'] = ncols
            ts['tilecount'] = n
            ts['imagewidth'] = ncols * 32
            ts['imageheight'] = nrows * 32
            for l in m['layers']:
                if l['type'] != 'tilelayer':
                    continue
                d = l['data']
                for i, g in enumerate(d):
                    flags, gid = g & FLIP, g & ~FLIP
                    if fg <= gid <= end:
                        d[i] = (fg + mapping[gid - fg]) | flags
            notes.append(f"  ~ '{ts['name']}' repacké {w}x{h} -> {ncols*32}x{nrows*32} ({n} tuiles)")
        else:
            # tileset normal : s'assurer que l'image est dans les assets + chemin propre
            if os.path.abspath(src_img) != os.path.abspath(dst):
                shutil.copyfile(src_img, dst)
                notes.append(f"  + '{ts['name']}' copié dans assets/tilesets/{base}")
            ts['image'] = f'../assets/tilesets/{base}'

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(m, f)
    n_ts = len([t for t in m['tilesets'] if 'image' in t])
    print(f"[prepare-map] default.built.tmj généré ({n_ts} tilesets)")
    for line in notes:
        print(line)


def main():
    if '--watch' in sys.argv:
        print('[prepare-map] watch sur default.tmj (Ctrl+C pour arrêter)')
        last = 0
        while True:
            try:
                mt = os.path.getmtime(SRC)
                if mt != last:
                    last = mt
                    try:
                        build_once()
                    except Exception as e:  # noqa: BLE001
                        print('[prepare-map] erreur:', e)
                time.sleep(1)
            except KeyboardInterrupt:
                break
    else:
        build_once()


if __name__ == '__main__':
    main()
