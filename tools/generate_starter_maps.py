#!/usr/bin/env python3
"""
generate_starter_maps.py
========================
Writes the STARTER versions of maps-src/farm.tmj, village.tmj and house.tmj
from the tile names in maps-src/tileset.json (made by build_assets.py).

These maps are a starting point. From now on they are meant to be edited by
hand in Tiled - so DON'T re-run this script once someone has edited the maps,
or their work will be overwritten. (It refuses to run if a map is newer than
this script unless you pass --force.)

Layers in every map:
    ground   floors, grass, water          (water blocks movement)
    decor    bases of objects, fences      (drawn under the player)
    above    roofs, tree tops              (drawn OVER the player)
    objects  spawns, warps, NPCs, etc.     (see src/data/areas.js)
"""
import json
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'maps-src')
META = json.load(open(os.path.join(OUT, 'tileset.json')))
N = META['names']
rnd = random.Random(11)

# Rows of each multi-tile object that are drawn over the player.
ABOVE_ROWS = {'hut': 4, 'hutsm': 4, 'palm': 2, 'mango': 3, 'stall': 1, 'shipbin': 1}

TILESET = {
    'firstgid': 1, 'name': 'tiles', 'image': '../assets/tiles.png',
    'imagewidth': META['width'], 'imageheight': META['height'], 'tilewidth': 16, 'tileheight': 16,
    'tilecount': META['count'], 'columns': META['columns'], 'margin': 0, 'spacing': 0,
    'tiles': [{'id': i, 'properties': [{'name': 'collides', 'type': 'bool', 'value': True}]} for i in META['collides']],
}


class Map:
    def __init__(self, w, h, base):
        self.w, self.h = w, h
        self.layers = {k: [[None] * w for _ in range(h)] for k in ('ground', 'decor', 'above')}
        for y in range(h):
            for x in range(w):
                self.layers['ground'][y][x] = base() if callable(base) else base
        self.objects = []

    def set(self, layer, x, y, name):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.layers[layer][y][x] = name

    def rect(self, layer, x, y, w, h, name):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.set(layer, xx, yy, name)

    def region(self, cells, prefix):
        """Paint a set of (x, y) cells with 3x3 border pieces (prefix_tl ... _br).
        Cells outside the map count as inside, so regions can run off the edge."""
        def inside(x, y):
            return (x, y) in cells or not (0 <= x < self.w and 0 <= y < self.h)
        for (x, y) in cells:
            n, s, w_, e = inside(x, y - 1), inside(x, y + 1), inside(x - 1, y), inside(x + 1, y)
            row = 't' if not n else ('b' if not s else 'm')
            col = 'l' if not w_ else ('r' if not e else 'c')
            self.set('ground', x, y, '%s_%s%s' % (prefix, row, col))

    def stamp(self, name, x, y):
        w, h = META['stamps'][name]
        split = ABOVE_ROWS[name]
        for r in range(h):
            for c in range(w):
                key = '%s_%d_%d' % (name, c, r)
                if key not in N:
                    continue
                self.set('above' if r < split else 'decor', x + c, y + r, key)

    def obj(self, name, typ, x, y, w=16, h=16, **props):
        """x, y, w, h in PIXELS (use tiles*16)."""
        p = [{'name': k, 'type': 'int' if isinstance(v, int) else 'string', 'value': v} for k, v in props.items()]
        self.objects.append({'id': len(self.objects) + 1, 'name': name, 'type': typ, 'x': x, 'y': y,
                             'width': w, 'height': h, 'rotation': 0, 'visible': True, 'properties': p})

    def tobj(self, name, typ, tx, ty, tw=1, th=1, **props):
        self.obj(name, typ, tx * 16, ty * 16, tw * 16, th * 16, **props)

    def to_tiled(self):
        layers = []
        for i, name in enumerate(('ground', 'decor', 'above')):
            data = [(N[t] + 1) if t else 0 for row in self.layers[name] for t in row]
            layers.append({'id': i + 1, 'name': name, 'type': 'tilelayer', 'width': self.w, 'height': self.h,
                           'x': 0, 'y': 0, 'opacity': 1, 'visible': True, 'data': data})
        layers.append({'id': 4, 'name': 'objects', 'type': 'objectgroup', 'draworder': 'topdown',
                       'x': 0, 'y': 0, 'opacity': 1, 'visible': True, 'objects': self.objects})
        return {'compressionlevel': -1, 'type': 'map', 'version': '1.10', 'tiledversion': '1.10.2',
                'orientation': 'orthogonal', 'renderorder': 'right-down', 'infinite': False,
                'width': self.w, 'height': self.h, 'tilewidth': 16, 'tileheight': 16,
                'nextlayerid': 5, 'nextobjectid': len(self.objects) + 1,
                'layers': layers, 'tilesets': [TILESET]}


def grass():
    return rnd.choice(['grass'] * 14 + ['grass_tuft1', 'grass_tuft2', 'grass_tuft3', 'grass_tuft4'])


def rect_cells(x, y, w, h):
    return {(xx, yy) for xx in range(x, x + w) for yy in range(y, y + h)}


def save(m, name):
    path = os.path.join(OUT, name + '.tmj')
    with open(path, 'w') as f:
        json.dump(m.to_tiled(), f, indent=1)
    print('wrote', path)


def farm():
    m = Map(40, 30, grass)
    # Border: bushes and trees, with an opening on the east (to the village).
    for x in range(40):
        m.set('decor', x, 0, 'bush'); m.set('decor', x, 29, 'bush')
    for y in range(30):
        m.set('decor', 0, y, 'bush')
        if y not in (12, 13, 14):
            m.set('decor', 39, y, 'bush')
    # Your house
    m.stamp('hut', 3, 2)
    m.obj('door_house', 'warp', 3 * 16 + 24, 7 * 16, 16, 16, target='house', spawn='from_farm')
    m.obj('from_house', 'spawn', 3 * 16 + 24, 9 * 16, 16, 16)
    m.stamp('shipbin', 9, 6)
    m.tobj('bin', 'ship', 9, 7)
    # Paths: from the door down, then east to the village
    m.region(rect_cells(4, 8, 3, 5) | rect_cells(4, 12, 36, 3), 'path')
    # Field: dark earth with a border; the farmland object is the inside.
    m.region(rect_cells(11, 17, 26, 11), 'field')
    m.tobj('field', 'farmland', 12, 18, 24, 9)
    for x in range(11, 37):
        if x not in (22, 23, 24):
            m.set('decor', x, 16, 'fence_h')
    m.set('decor', 21, 16, 'fence_post'); m.set('decor', 25, 16, 'fence_post')
    m.set('decor', 26, 15, 'sign')
    m.tobj('field_sign', 'sign', 26, 15, text='sign_field')
    # Trees and scenery
    for (x, y) in [(13, 3), (30, 3), (34, 7)]:
        m.stamp('mango', x, y)
    for (x, y) in [(20, 2), (24, 5), (2, 20), (5, 24)]:
        m.stamp('palm', x, y)
    for (x, y, t) in [(17, 9, 'rock'), (28, 9, 'rock2'), (8, 18, 'rock'), (3, 15, 'bush'), (36, 21, 'bush'), (7, 26, 'rock2')]:
        m.set('decor', x, y, t)
    m.tobj('from_village', 'spawn', 37, 13, facing='left')
    m.tobj('exit_village', 'warp', 39, 12, 1, 3, target='village', spawn='from_farm')
    m.tobj('hen1', 'critter', 12, 9, kind='hen')
    m.tobj('chick1', 'critter', 13, 10, kind='chick')
    save(m, 'farm')


def village():
    m = Map(40, 30, grass)
    # Beach and sea along the bottom
    m.rect('ground', 0, 22, 40, 2, 'sand')
    m.rect('ground', 0, 24, 40, 1, 'water_shore')
    m.rect('ground', 0, 25, 40, 2, 'water')
    m.rect('ground', 0, 27, 40, 1, 'water_deep_edge')
    m.rect('ground', 0, 28, 40, 2, 'water_deep')
    # Red-earth village square, joined to the path from the farm (west).
    m.region(rect_cells(5, 8, 30, 12) | rect_cells(0, 12, 6, 3), 'laterite')
    # Border
    for x in range(40):
        m.set('decor', x, 0, 'bush')
    for y in range(0, 22):
        m.set('decor', 39, y, 'bush')
        if y not in (12, 13, 14):
            m.set('decor', 0, y, 'bush')
    # Houses (doors closed for now - future interiors)
    m.stamp('hut', 6, 1)
    m.stamp('hutsm', 15, 2)
    m.stamp('hut', 26, 1)
    m.stamp('hutsm', 33, 3)
    # Market stall with Pa Sorie standing at it
    m.stamp('stall', 19, 10)
    m.tobj('sorie', 'npc', 20, 12, npc='sorie', facing='down')
    m.set('decor', 23, 11, 'crate'); m.set('decor', 18, 11, 'crate2')
    m.set('decor', 13, 11, 'sign')
    m.tobj('notice', 'sign', 13, 11, text='sign_village')
    # Aunty Kadi near the beach
    m.tobj('kadi', 'npc', 29, 17, npc='kadi', facing='left')
    m.set('decor', 31, 16, 'clay_pot')
    m.set('decor', 10, 17, 'bench'); m.set('decor', 11, 17, 'bench')
    # Palms along the beach, a mango tree in the square
    for (x, y) in [(1, 19), (8, 19), (15, 20), (24, 19), (31, 19), (36, 18)]:
        m.stamp('palm', x, y)
    m.stamp('mango', 35, 9)
    m.set('decor', 20, 23, 'coconut')
    m.tobj('from_farm', 'spawn', 2, 13, facing='right')
    m.tobj('exit_farm', 'warp', 0, 12, 1, 3, target='farm', spawn='from_village')
    for i, (x, y) in enumerate([(9, 14), (11, 15), (25, 15)]):
        m.tobj('hen%d' % i, 'critter', x, y, kind='hen' if i != 1 else 'chick')
    for i, (x, y) in enumerate([(6, 23), (22, 22), (34, 23)]):
        m.tobj('crab%d' % i, 'critter', x, y, kind='crab')
    save(m, 'village')


def house():
    m = Map(20, 12, 'void')
    m.rect('decor', 0, 0, 20, 12, 'void')
    m.rect('decor', 5, 3, 10, 7, None)
    m.rect('ground', 5, 3, 10, 7, 'floor')
    m.rect('decor', 5, 2, 10, 1, 'wall_in')
    m.set('decor', 9, 10, None); m.set('ground', 9, 10, 'floor')
    m.set('decor', 6, 4, 'mat_bed')
    m.set('decor', 13, 3, 'clay_pot'); m.set('decor', 12, 3, 'crate')
    m.set('decor', 6, 8, 'bench')
    m.tobj('bed_spawn', 'spawn', 7, 4, facing='left')
    m.tobj('from_farm', 'spawn', 9, 8, facing='up')
    m.tobj('bed', 'bed', 6, 4)
    m.tobj('door_out', 'warp', 9, 10, target='farm', spawn='from_house')
    save(m, 'house')


if __name__ == '__main__':
    me = os.path.getmtime(__file__)
    edited = [n for n in ('farm', 'village', 'house')
              if os.path.exists(os.path.join(OUT, n + '.tmj')) and os.path.getmtime(os.path.join(OUT, n + '.tmj')) > me + 5]
    if edited and '--force' not in sys.argv:
        sys.exit('These maps look hand-edited, not overwriting: %s (use --force)' % ', '.join(edited))
    farm(); village(); house()
