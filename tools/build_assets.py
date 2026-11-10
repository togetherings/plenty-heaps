#!/usr/bin/env python3
"""
build_assets.py
===============
Builds the game's images from the purchased Petixel art packs in
art-src/petixel/. Run it after changing anything in this file or in art-src:

    python3 tools/build_assets.py          (needs Python 3 + Pillow)

It writes:
    assets/tiles.png          one 16x16 tileset for every map (used by Tiled)
    assets/items.png          16x16 inventory icons
    assets/chars/*.png        character bodies, hairstyles, critters
    assets/ui/*.png           window skin and buttons
    src/data/tiles.js         names for tile positions (GENERATED - don't edit)
    maps-src/tileset.json     tile names + collisions, read by the map tools

ART LICENCE: the Petixel packs were purchased on itch.io. We may edit them
freely, but they must NOT be used to train image-generation AI. Keep that in
mind before sharing the art-src folder anywhere.

HOW TILES ARE ADDED
    Each entry in TILES below is (name, source) and gets the next free slot.
    Sources:  ('farm', col, row)   a tile from a Petixel sheet
              ('gen', function)    drawn here in code (e.g. plain sand)
              ('stamp', name, col, row)   one tile of a composed object
    Add new tiles at the END so existing maps keep working.
    Names ending in '!' block movement (the '!' is not part of the name).
"""
import json
import os
import random
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
SRC = os.path.join(ROOT, 'art-src', 'petixel')
T = 16
COLS = 16
rnd = random.Random(7)


def load(rel):
    return Image.open(os.path.join(SRC, rel)).convert('RGBA')


SHEETS = {
    'farm': load('farmlands/Tileset_Farmlands.png'),
    'atoll': load('atolls/Atolls_B.png'),
    'sav': load('savanah/Savanah_B.png'),
}

# The Petixel palette (from the window skin's colour strip). Using only these
# colours keeps code-drawn art consistent with the packs.
PAL = {
    'cream': (248, 244, 222), 'red': (255, 86, 84), 'yellow': (255, 228, 132), 'olive': (124, 158, 61),
    'mint': (146, 214, 154), 'teal': (35, 93, 106), 'beige': (208, 184, 164), 'crimson': (178, 54, 78),
    'orange': (255, 157, 81), 'dkgreen': (58, 104, 61), 'green': (61, 162, 130), 'peach': (255, 193, 174),
    'taupe': (137, 122, 111), 'tan': (230, 162, 126), 'lilac': (190, 130, 188), 'sky': (178, 208, 255),
    'blue': (72, 165, 206), 'pink': (255, 132, 180), 'dkbrown': (89, 59, 61), 'brown': (161, 93, 77),
    'purple': (131, 86, 145), 'peri': (139, 130, 211), 'dkblue': (32, 111, 169), 'plum': (122, 65, 87),
}


def tile(sheet, c, r):
    return SHEETS[sheet].crop((c * T, r * T, c * T + T, r * T + T))


def recolor(img, mapping):
    """Replace exact colours: mapping {(r,g,b): (r,g,b)}."""
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            p = px[x, y]
            if p[3] and p[:3] in mapping:
                px[x, y] = mapping[p[:3]] + (p[3],)
    return out


def blank():
    return Image.new('RGBA', (T, T), (0, 0, 0, 0))


def fill(color, specks=(), n=0):
    im = Image.new('RGBA', (T, T), color + (255,))
    for _ in range(n):
        im.putpixel((rnd.randrange(T), rnd.randrange(T)), rnd.choice(specks) + (255,))
    return im


def over(base, top):
    out = base.copy()
    out.alpha_composite(top)
    return out


# ------------------------------------------------------------------ drawn art
def heap(wet):
    """A planting heap (mound). Tilling makes these - hence 'Plenty Heap'."""
    im = blank()
    d = ImageDraw.Draw(im)
    body = PAL['dkbrown'] if wet else PAL['brown']
    top = PAL['plum'] if wet else PAL['tan']
    edge = (60, 38, 42) if wet else PAL['dkbrown']
    d.ellipse([1, 4, 14, 15], fill=body, outline=edge)
    d.line([4, 7, 11, 7], fill=top)
    d.line([3, 8, 5, 8], fill=top)
    if wet:
        d.point((10, 10), fill=PAL['dkblue'])
        d.point((6, 12), fill=PAL['dkblue'])
    return im


def seeds_tile():
    im = blank()
    for (x, y) in [(6, 9), (9, 10), (8, 7)]:
        im.putpixel((x, y), PAL['yellow'] + (255,))
        im.putpixel((x, y + 1), PAL['dkbrown'] + (255,))
    return im


def mat_bed():
    """A sleeping mat with a folded cloth, on the floor."""
    im = floor()
    d = ImageDraw.Draw(im)
    d.rectangle([1, 1, 14, 14], fill=PAL['beige'], outline=PAL['dkbrown'])
    for y in range(3, 14, 3):
        d.line([2, y, 13, y], fill=PAL['taupe'])
    d.rectangle([2, 2, 13, 5], fill=PAL['red'], outline=PAL['crimson'])   # cloth
    d.point((5, 3), fill=PAL['yellow']); d.point((9, 4), fill=PAL['yellow'])
    return im


def floor():
    """Packed-earth floor, as in a mud-walled house."""
    return fill(PAL['tan'], [PAL['brown'], PAL['peach']], 14)


def sand():
    return fill(PAL['yellow'], [PAL['cream']], 12)


def wall_band():
    """Interior wall: lime-washed band with a painted pattern."""
    im = fill(PAL['cream'])
    d = ImageDraw.Draw(im)
    d.rectangle([0, 10, 15, 15], fill=PAL['brown'])
    d.line([0, 9, 15, 9], fill=PAL['dkbrown'])
    for x in range(0, 16, 4):
        d.polygon([(x, 10), (x + 2, 13), (x + 4, 10)], fill=PAL['dkbrown'])
    return im


# ------------------------------------------------------------ composed stamps
def compose_hut(big):
    """Roof + patterned wall + door, composed into one picture."""
    sav = SHEETS['sav']
    if big:
        roof = sav.crop((8 * T, 0, 12 * T, 4 * T))
        wall = sav.crop((8 * T, 4 * T, 12 * T, 10 * T))
        w, roof_y, wall_y, door_x = 64, 0, -4, 24
    else:
        roof = sav.crop((12 * T, 2 * T, 15 * T, 6 * T))
        wall = sav.crop((12 * T, 6 * T, 15 * T, 11 * T))
        w, roof_y, wall_y, door_x = 48, 0, 14, 16
    h = 96
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    im.alpha_composite(wall, (0, wall_y)) if wall_y >= 0 else im.alpha_composite(wall.crop((0, -wall_y, w, wall.height)), (0, 0))
    im.alpha_composite(roof, (0, roof_y))
    door = load('savanah/!$SavanahDoor.png').crop((0, 0, 16, 32))
    im.alpha_composite(door, (door_x, h - 32 - 2))
    return im


def compose_palm():
    return SHEETS['atoll'].crop((8 * T, 1 * T, 11 * T, 4 * T))


def compose_mango():
    # The Farmlands fruit tree, with its red fruit recoloured as mangoes.
    tree = SHEETS['farm'].crop((3 * T, 9 * T, 6 * T, 13 * T))
    return recolor(tree, {PAL['red']: PAL['orange'], PAL['crimson']: PAL['olive']})


def compose_stall():
    """Market stall: striped awning over a wooden counter."""
    im = Image.new('RGBA', (48, 32), (0, 0, 0, 0))
    for i, c in enumerate([12, 13, 14]):
        im.alpha_composite(tile('atoll', c, 5), (i * 16, 0))
    for i in range(3):
        im.alpha_composite(tile('atoll', 12 + (i % 2), 4), (i * 16, 16))
    d = ImageDraw.Draw(im)
    for x in (4, 20, 36):  # produce on the counter
        d.ellipse([x, 17, x + 4, 21], fill=rnd.choice([PAL['red'], PAL['yellow'], PAL['orange']]), outline=PAL['dkbrown'])
    return im


STAMPS = {}


def stamp(name, img):
    STAMPS[name] = img
    return [(name, c, r) for r in range(img.height // T) for c in range(img.width // T)]


# -------------------------------------------------------------------- tiles
def crop_stages(ripe, grow):
    return [('gen', seeds_tile), ('farm', 7, 4), grow, ripe]


def sprout_withered():
    return recolor(tile('farm', 6, 4), {PAL['green']: PAL['taupe'], PAL['mint']: PAL['beige'], PAL['yellow']: PAL['brown']})


def maize_ripe():
    """Tall maize plant with a ripe cob (drawn in the pack palette)."""
    im = blank(); d = ImageDraw.Draw(im)
    d.line([8, 15, 8, 1], fill=PAL['dkgreen'], width=2)
    d.line([8, 10, 2, 6], fill=PAL['green'], width=2)
    d.line([8, 6, 14, 3], fill=PAL['green'], width=2)
    d.line([8, 13, 13, 11], fill=PAL['green'])
    d.point((8, 0), fill=PAL['olive'])
    d.ellipse([9, 5, 12, 11], fill=PAL['yellow'], outline=PAL['dkbrown'])
    d.line([10, 6, 10, 10], fill=PAL['orange'])
    return im


def maize_cob():
    im = blank(); d = ImageDraw.Draw(im)
    d.ellipse([5, 1, 11, 14], fill=PAL['yellow'], outline=PAL['dkbrown'])
    for y in range(3, 13, 2):
        d.line([7, y, 9, y], fill=PAL['orange'])
    d.polygon([(4, 15), (6, 6), (8, 15)], fill=PAL['green'], outline=PAL['dkgreen'])
    return im


def cassava_ripe():
    return recolor(tile('farm', 6, 12), {PAL['purple']: PAL['brown'], PAL['lilac']: PAL['tan'], PAL['beige']: PAL['peach'], PAL['taupe']: PAL['dkbrown']})


def laterite(c, r):
    # Farmlands dirt-path pieces, recoloured to the red laterite earth of the region.
    return recolor(tile('farm', c, r), {PAL['tan']: PAL['orange'], PAL['brown']: PAL['crimson']})


TILES = [
    ('empty', ('gen', blank)),
    # --- ground
    ('grass', ('farm', 0, 1)),
    ('grass_tuft1', ('farm', 6, 2)), ('grass_tuft2', ('farm', 7, 2)),
    ('grass_tuft3', ('farm', 6, 3)), ('grass_tuft4', ('farm', 7, 3)),
    ('sand', ('gen', sand)),
    ('water_shore!', ('atoll', 3, 0)), ('water!', ('atoll', 3, 1)),
    ('water_deep_edge!', ('atoll', 1, 3)), ('water_deep!', ('atoll', 1, 4)),
    ('void!', ('gen', lambda: fill((16, 14, 20)))),
    ('floor', ('gen', floor)),
    ('wall_in!', ('gen', wall_band)),
    ('field', ('farm', 4, 1)),
]
# Path and laterite: 3x3 border pieces (tl t tr / l c r / bl b br)
for nm, src in [('path', 'farm'), ('laterite', 'lat')]:
    for j, rowname in enumerate(['t', 'm', 'b']):
        for i, colname in enumerate(['l', 'c', 'r']):
            c, r = i, 2 + j
            TILES.append(('%s_%s%s' % (nm, rowname, colname), ('farm', c, r) if src == 'farm' else ('gen', (lambda c=c, r=r: laterite(c, r)))))
# Field border (dark dirt with grass edge)
for j, rowname in enumerate(['t', 'm', 'b']):
    for i, colname in enumerate(['l', 'c', 'r']):
        TILES.append(('field_%s%s' % (rowname, colname), ('farm', 3 + i, j)))
TILES += [
    # --- farm
    ('heap', ('gen', lambda: heap(False))), ('heap_wet', ('gen', lambda: heap(True))),
    ('crop_withered', ('gen', sprout_withered)),
]
CROPS = {
    'maize': ('gen', maize_ripe),
    'groundnut': ('farm', 7, 13),
    'krainkrain': ('farm', 7, 15),
    'pepper': ('farm', 7, 12),
    'cassava': ('gen', cassava_ripe),
}
for name, ripe in CROPS.items():
    for i, src in enumerate(crop_stages(ripe, ('farm', 6, 4))):
        TILES.append(('crop_%s_%d' % (name, i), src))
TILES += [
    # --- props (single tiles)
    ('fence_h!', ('farm', 4, 5)), ('fence_post!', ('farm', 3, 7)),
    ('rock!', ('farm', 6, 5)), ('rock2!', ('farm', 7, 5)),
    ('bush!', ('atoll', 14, 0)),
    ('sign!', ('farm', 3, 4)),
    ('crate!', ('atoll', 13, 6)), ('crate2!', ('atoll', 14, 7)),
    ('coconut', ('atoll', 11, 10)),
    ('mat_bed!', ('gen', mat_bed)),
    ('clay_pot!', ('gen', lambda: load('desert/!$ClayPot.png').crop((0, 0, 16, 16)))),
    ('bench!', ('atoll', 12, 6)),
]

# Stamps: multi-tile objects. Tile names: <stamp>_<col>_<row>.
# Collision rules per stamp (which rows/tiles block movement).
STAMP_DEFS = [
    ('hut', compose_hut(True), lambda c, r: r >= 2 and not (r == 5 and c in (1, 2))),
    ('hutsm', compose_hut(False), lambda c, r: r >= 2 and not (r == 5 and c == 1)),
    ('palm', compose_palm(), lambda c, r: (c, r) == (1, 2)),
    ('mango', compose_mango(), lambda c, r: (c, r) == (1, 3)),
    ('stall', compose_stall(), lambda c, r: r == 1),
    ('shipbin', load('farmlands/!$ShippingCrate.png').crop((0, 0, 16, 32)), lambda c, r: r == 1),
]
for sname, img, coll in STAMP_DEFS:
    for (n, c, r) in stamp(sname, img):
        TILES.append(('%s_%d_%d%s' % (n, c, r, '!' if coll(c, r) else ''), ('stamp', n, c, r)))


def render(src):
    kind = src[0]
    if kind == 'gen':
        return src[1]()
    if kind == 'stamp':
        return STAMPS[src[1]].crop((src[2] * T, src[3] * T, src[2] * T + T, src[3] * T + T))
    return tile(kind, src[1], src[2])


def build_tiles():
    rows = (len(TILES) + COLS - 1) // COLS
    sheet = Image.new('RGBA', (COLS * T, rows * T), (0, 0, 0, 0))
    names, collides = {}, []
    for i, (name, src) in enumerate(TILES):
        blocking = name.endswith('!')
        name = name.rstrip('!')
        assert name not in names, 'duplicate tile name ' + name
        names[name] = i
        if blocking:
            collides.append(i)
        sheet.alpha_composite(render(src), ((i % COLS) * T, (i // COLS) * T))
    sheet.save(os.path.join(ROOT, 'assets', 'tiles.png'))
    stamps = {n: [img.width // T, img.height // T] for n, img in STAMPS.items()}
    meta = {'columns': COLS, 'count': len(TILES), 'width': sheet.width, 'height': sheet.height,
            'names': names, 'collides': collides, 'stamps': stamps}
    with open(os.path.join(ROOT, 'maps-src', 'tileset.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    # Runtime names for the few tiles the code places itself.
    crops = {k: names['crop_%s_0' % k] for k in CROPS}
    js = ('// GENERATED by tools/build_assets.py - do not edit by hand.\n'
          '// Positions of tiles in assets/tiles.png that the code places at runtime.\n'
          '(function (FS) {\n  \'use strict\';\n  FS.Tiles = {\n'
          '    FIRST_GID: 1,\n'
          '    SOIL: %d,          // dry heap\n'
          '    SOIL_WET: %d,      // watered heap\n'
          '    WITHERED: %d,\n'
          '    CROP_FIRST: %s,  // first of 4 growth stages per crop\n'
          '    gid: function (index) { return index + FS.Tiles.FIRST_GID; }\n'
          '  };\n})(FarmSim);\n') % (names['heap'], names['heap_wet'], names['crop_withered'], json.dumps(crops))
    with open(os.path.join(ROOT, 'src', 'data', 'tiles.js'), 'w') as f:
        f.write(js)
    return len(TILES), sheet.size


# -------------------------------------------------------------------- items
def i_hoe():
    im = blank(); d = ImageDraw.Draw(im)
    d.line([3, 14, 11, 4], fill=PAL['dkbrown'], width=3)
    d.line([3, 14, 11, 4], fill=PAL['brown'], width=1)
    d.polygon([(9, 1), (15, 3), (13, 7), (10, 4)], fill=PAL['beige'], outline=PAL['dkbrown'])
    return im


def i_can():
    im = blank(); d = ImageDraw.Draw(im)
    d.rectangle([2, 6, 10, 14], fill=PAL['blue'], outline=PAL['dkbrown'])
    d.line([3, 8, 9, 8], fill=PAL['sky'])
    d.line([10, 9, 14, 5], fill=PAL['dkbrown'], width=2)
    d.arc([3, 2, 9, 9], 180, 360, fill=PAL['dkbrown'])
    return im


def i_packet(icon_tile):
    im = blank(); d = ImageDraw.Draw(im)
    d.rectangle([2, 1, 13, 15], fill=PAL['beige'], outline=PAL['dkbrown'])
    d.line([3, 3, 12, 3], fill=PAL['taupe'])
    small = render(icon_tile).resize((8, 8), Image.NEAREST)
    im.alpha_composite(small, (4, 6))
    return im


def i_cowrie():
    im = blank(); d = ImageDraw.Draw(im)
    d.ellipse([3, 2, 12, 14], fill=PAL['cream'], outline=PAL['dkbrown'])
    d.ellipse([5, 4, 8, 7], fill=PAL['peach'])
    d.line([8, 5, 8, 12], fill=PAL['dkbrown'])
    for y in (6, 8, 10):
        d.point((7, y), fill=PAL['taupe']); d.point((9, y), fill=PAL['taupe'])
    return im


def build_items():
    icons = [('hoe', i_hoe()), ('can', i_can())]
    for name, ripe in CROPS.items():
        icons.append(('seed_' + name, i_packet(ripe)))
    for name, ripe in CROPS.items():
        icons.append((name, maize_cob() if name == 'maize' else render(ripe)))
    icons.append(('cowrie', i_cowrie()))
    sheet = Image.new('RGBA', (8 * T, ((len(icons) + 7) // 8) * T), (0, 0, 0, 0))
    for i, (n, im) in enumerate(icons):
        sheet.alpha_composite(im, ((i % 8) * T, (i // 8) * T))
    sheet.save(os.path.join(ROOT, 'assets', 'items.png'))
    return {n: i for i, (n, _) in enumerate(icons)}


# --------------------------------------------------------------- characters
# Hairstyles offered in the game: game key -> Petixel file name.
HAIR = [
    ('curls', 'BuzzCurly'), ('flattop', 'FlatTop'), ('twists', 'ShortSpiky'),
    ('spiky', 'MiddleSpiky'), ('puffs', 'Child_DoubleBuns'), ('toppuff', 'Palmtree'),
    ('braid', 'FrenchBraid'), ('cornrows', 'Child_FrenchBraid'), ('bun', 'VintageBun'),
    ('ponytail', 'LowPonyTail'), ('bob', 'Bob'), ('mohawk', 'Mohawk'), ('elder', 'Grandpa'),
]


def build_chars():
    out = os.path.join(ROOT, 'assets', 'chars')
    os.makedirs(out, exist_ok=True)
    for body in 'MF':
        load('characters/!$CharaBase_Black_%s.png' % body).save(os.path.join(out, 'body_%s.png' % body.lower()))
    # All hairstyles side by side in one sheet (48x128 each), black version.
    sheet = Image.new('RGBA', (48 * len(HAIR), 128), (0, 0, 0, 0))
    for i, (key, fname) in enumerate(HAIR):
        sheet.alpha_composite(load('hair/!$CharaHair_%s_noireau.png' % fname), (i * 48, 0))
    sheet.save(os.path.join(out, 'hair.png'))
    load('atolls/!$Crab.png').save(os.path.join(out, 'crab.png'))
    load('farmlands/!$Hen.png').save(os.path.join(out, 'hen.png'))
    load('farmlands/!$Chick.png').save(os.path.join(out, 'chick.png'))
    return [k for k, _ in HAIR]


def build_ui():
    out = os.path.join(ROOT, 'assets', 'ui')
    os.makedirs(out, exist_ok=True)
    load('ui/Window.png').save(os.path.join(out, 'window.png'))
    load('ui/ButtonSet.png').save(os.path.join(out, 'buttons.png'))
    load('ui/Balloon.png').crop((0, 0, 384, 96)).save(os.path.join(out, 'balloon.png'))


if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'assets'), exist_ok=True)
    print('tiles:', build_tiles())
    print('items:', build_items())
    print('hair:', build_chars())
    build_ui()
    print('done')
