#!/usr/bin/env python3
"""Rendu PNG de la map buildée (composite des calques de tuiles).

Usage : python3 scripts/render-map.py [sortie.png]
Utile pour vérifier visuellement toute édition Tiled/script avant commit.
"""
import json, os, sys
from PIL import Image

BASE = os.path.join(os.path.dirname(__file__), "..", "client", "public")
MAP = os.path.join(BASE, "maps", "default.built.tmj")
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/map_render.png"

FLIP_H, FLIP_V, FLIP_D = 0x80000000, 0x40000000, 0x20000000

with open(MAP) as f:
    m = json.load(f)

tw, th = m["tilewidth"], m["tileheight"]
W, H = m["width"], m["height"]

# Load tilesets
tilesets = []
for ts in sorted(m["tilesets"], key=lambda t: t["firstgid"]):
    img_path = ts.get("image")
    if not img_path:
        # external tsx or collection — skip
        tilesets.append((ts["firstgid"], None, ts))
        continue
    # image path is relative to the map file
    p = os.path.normpath(os.path.join(os.path.dirname(MAP), img_path))
    if not os.path.exists(p):
        print(f"MISSING tileset image: {p}", file=sys.stderr)
        tilesets.append((ts["firstgid"], None, ts))
        continue
    im = Image.open(p).convert("RGBA")
    tilesets.append((ts["firstgid"], im, ts))

def tile_image(gid):
    for firstgid, im, ts in reversed(tilesets):
        if gid >= firstgid:
            if im is None:
                return None
            local = gid - firstgid
            cols = ts.get("columns") or (im.width // tw)
            x = (local % cols) * tw
            y = (local // cols) * th
            if y + th > im.height:
                return None
            return im.crop((x, y, x + tw, y + th))
    return None

canvas = Image.new("RGBA", (W * tw, H * th), (30, 30, 40, 255))
cache = {}

def render_layer(layer):
    if layer["type"] == "group":
        for sub in layer.get("layers", []):
            render_layer(sub)
        return
    if layer["type"] != "tilelayer" or not layer.get("visible", True):
        return
    data = layer.get("data")
    if data is None:
        return
    for i, raw in enumerate(data):
        if raw == 0:
            continue
        gid = raw & ~(FLIP_H | FLIP_V | FLIP_D)
        key = raw
        tile = cache.get(key)
        if tile is None:
            tile = tile_image(gid)
            if tile is None:
                continue
            if raw & FLIP_D:
                tile = tile.transpose(Image.TRANSPOSE)
            if raw & FLIP_H:
                tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
            if raw & FLIP_V:
                tile = tile.transpose(Image.FLIP_TOP_BOTTOM)
            cache[key] = tile
        x = (i % W) * tw
        y = (i // W) * th
        canvas.alpha_composite(tile, (x, y))

for layer in m["layers"]:
    render_layer(layer)

canvas.save(OUT)
print(f"Saved {OUT} ({canvas.width}x{canvas.height}), layers={len(m['layers'])}, map {W}x{H} tiles")
