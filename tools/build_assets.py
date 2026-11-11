#!/usr/bin/env python3
"""
build_assets.py
===============
Builds the game's item icons, characters and window art from the pictures in art-src/:

    python tools/build_assets.py          (needs Python 3 + Pillow, and the art packs)

It writes:
    assets/items.png          16x16 inventory icons, in the order of ICONS below (items.js "icon")
    assets/chars/*.png        character bodies, hairstyles, critters
    assets/ui/*.png           window skin and buttons

TILES are not made here: the map maker (python tools/map_maker.py) draws assets/tiles.png and
assets/objects.png from the tile list, maps-src/tiles.json.

NOTHING IS DRAWN IN CODE: every picture comes from a sheet in art-src/:
    art-src/petixel/   the purchased Petixel packs (kept off GitHub)
    art-src/made/      pictures made from the packs (composed or edited), also kept off GitHub
    art-src/own/       the game's own drawings (on GitHub): placeholders to replace or improve
Edit those sheets (Aseprite, LibreSprite...), not this file, to change a picture. A recolouring
named here comes from the tile list's "recolors".

ART LICENCE: the Petixel packs were purchased on itch.io. We may edit them
freely, but they must NOT be used to train image-generation AI. Keep that in
mind before sharing the art-src folder anywhere.
"""
import json
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
ART = os.path.join(ROOT, 'art-src')
T = 16
FARM = 'petixel/farmlands/Tileset_Farmlands.png'

# Inventory icons: (key, sheet, column, row[, recolouring]). Add new ones at the END: items.js
# refers to them by position ("icon").
ICONS = [
    ('hoe', 'own/items.png', 0, 0),
    ('can', 'own/items.png', 1, 0),
    ('seed_maize', 'made/items.png', 0, 0),
    ('seed_groundnut', 'made/items.png', 1, 0),
    ('seed_krainkrain', 'made/items.png', 2, 0),
    ('seed_pepper', 'made/items.png', 3, 0),
    ('seed_cassava', 'made/items.png', 4, 0),
    ('maize', 'own/items.png', 3, 0),
    ('groundnut', FARM, 7, 13),
    ('krainkrain', FARM, 7, 15),
    ('pepper', FARM, 7, 12),
    ('cassava', FARM, 6, 12, 'cassava'),
    ('cowrie', 'own/items.png', 2, 0),
]

# Hairstyles offered in the game: game key -> Petixel file name.
HAIR = [
    ('curls', 'BuzzCurly'), ('flattop', 'FlatTop'), ('twists', 'ShortSpiky'),
    ('spiky', 'MiddleSpiky'), ('puffs', 'Child_DoubleBuns'), ('toppuff', 'Palmtree'),
    ('braid', 'FrenchBraid'), ('cornrows', 'Child_FrenchBraid'), ('bun', 'VintageBun'),
    ('ponytail', 'LowPonyTail'), ('bob', 'Bob'), ('mohawk', 'Mohawk'), ('elder', 'Grandpa'),
]


def load(rel):
    return Image.open(os.path.join(ART, rel)).convert('RGBA')


def recolors():
    with open(os.path.join(ROOT, 'maps-src', 'tiles.json'), encoding='utf-8') as f:
        return json.load(f).get('recolors', {})


def recolor(img, pairs):
    """Swap exact colours: pairs [["rrggbb", "rrggbb"], ...]."""
    table = {tuple(int(a[i:i + 2], 16) for i in (0, 2, 4)): tuple(int(b[i:i + 2], 16) for i in (0, 2, 4)) for a, b in pairs}
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            p = px[x, y]
            if p[3] and p[:3] in table:
                px[x, y] = table[p[:3]] + (p[3],)
    return out


def build_items():
    rc = recolors()
    sheet = Image.new('RGBA', (8 * T, ((len(ICONS) + 7) // 8) * T), (0, 0, 0, 0))
    for i, icon in enumerate(ICONS):
        key, src, c, r = icon[:4]
        im = load(src).crop((c * T, r * T, c * T + T, r * T + T))
        if len(icon) > 4:
            im = recolor(im, rc[icon[4]])
        sheet.alpha_composite(im, ((i % 8) * T, (i // 8) * T))
    sheet.save(os.path.join(ROOT, 'assets', 'items.png'))
    return {icon[0]: i for i, icon in enumerate(ICONS)}


def build_chars():
    out = os.path.join(ROOT, 'assets', 'chars')
    os.makedirs(out, exist_ok=True)
    for body in 'MF':
        load('petixel/characters/!$CharaBase_Black_%s.png' % body).save(os.path.join(out, 'body_%s.png' % body.lower()))
    # All hairstyles side by side in one sheet (48x128 each), black version.
    sheet = Image.new('RGBA', (48 * len(HAIR), 128), (0, 0, 0, 0))
    for i, (key, fname) in enumerate(HAIR):
        sheet.alpha_composite(load('petixel/hair/!$CharaHair_%s_noireau.png' % fname), (i * 48, 0))
    sheet.save(os.path.join(out, 'hair.png'))
    load('petixel/atolls/!$Crab.png').save(os.path.join(out, 'crab.png'))
    load('petixel/farmlands/!$Hen.png').save(os.path.join(out, 'hen.png'))
    load('petixel/farmlands/!$Chick.png').save(os.path.join(out, 'chick.png'))
    return [k for k, _ in HAIR]


def build_ui():
    out = os.path.join(ROOT, 'assets', 'ui')
    os.makedirs(out, exist_ok=True)
    load('petixel/ui/Window.png').save(os.path.join(out, 'window.png'))
    load('petixel/ui/ButtonSet.png').save(os.path.join(out, 'buttons.png'))
    load('petixel/ui/Balloon.png').crop((0, 0, 384, 96)).save(os.path.join(out, 'balloon.png'))


if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)
    print('items:', build_items())
    print('hair:', build_chars())
    build_ui()
    print('done (tiles: use the map maker)')
