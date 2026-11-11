#!/usr/bin/env python3
"""
The map maker: edit Plenty Heaps' maps and tiles in your browser, on your own computer.

    python tools/map_maker.py            open the map maker (http://127.0.0.1:8300/)
    python tools/map_maker.py --build    rebuild src/data/maps.js and the tile lists from maps-src/ (and check)
    python tools/map_maker.py --check    only check the maps (the game's tests run this)

Needs Python 3.8 or later and nothing else. Run it from anywhere; it works on the folder it's in.

How the maps and tiles are kept:
  maps-src/<key>.tmj        one file per map, in Tiled's format (Tiled can still open them).
                            The map's properties: id (0-63, permanent: saves use it), outdoor, and for
                            coasts tideDelay (minutes), tideSize (1 = full) and tideWater (an autotile).
  maps-src/tiles.json       THE TILE LIST: every tile the maps can use, where its picture comes from in
                            art-src/ (a sheet, a column and a row), whether it's solid, its recolouring,
                            animation frames, autotiles, the seasons' swap rules, animated objects and the
                            shore foam. Its order is the tile numbers the maps use.
  maps-src/stamps.json      multi-tile objects (a hut, a tree...) to place in one go.
  maps-src/tileset.json     made from tiles.json: the layout of the game's tile image (don't edit).
  src/data/tiles.js         made from tiles.json: what the game needs to know about tiles (don't edit).
  src/data/maps.js          what the game loads: every map and the list of areas (don't edit).
  assets/tiles.png, assets/objects.png
                            the game's tile and animated-object images. The map maker's page draws them
                            from the pictures in art-src/ when the tile list changes, so only someone with
                            the art packs on their computer can add or change tiles. Everyone can paint.

Tile numbers in maps are Tiled "gids": tile number + 1, 0 for none, plus Tiled's flip flags in the top
three bits (flipped left-right, up-down, and across the diagonal, which together rotate a tile).

Standard library only.
"""
import argparse
import base64
import copy
import hashlib
import json
import os
import re
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, "maps-src")
ART = os.path.join(ROOT, "art-src")
EDITOR = os.path.join(ROOT, "tools", "map-maker")
OUT = os.path.join(ROOT, "src", "data", "maps.js")
TILES_JS = os.path.join(ROOT, "src", "data", "tiles.js")
CATALOG = os.path.join(MAPS, "tiles.json")
TILESET = os.path.join(MAPS, "tileset.json")
STAMPS = os.path.join(MAPS, "stamps.json")
TILES_PNG = os.path.join(ROOT, "assets", "tiles.png")
OBJECTS_PNG = os.path.join(ROOT, "assets", "objects.png")

T = 16
COLS = 16                 # tiles across in assets/tiles.png
OBJECTS_WIDTH = 512       # pixels across in assets/objects.png
MAX_ID = 63               # 6 bits in the save (src/core/saveCodec.js)
MAX_SIZE = 255            # the save keeps the player's square in 8 bits each way
BUSY = 250                # objects in one map before the map maker warns
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
NAME_RE = re.compile(r"^[a-z0-9_]{1,40}$")
TILE_LAYERS = ("ground", "decor", "above")
OBJECT_TYPES = ("spawn", "warp", "room", "farmland", "ship", "bed", "sign", "npc", "critter", "anim")
HOME = ("house", "bed_spawn")   # where a new game starts (FS.Areas.HOME in src/data/areas.js)
SEASONS = ("firstrain", "bigrain", "harmattan", "warm")
TIDE_LEVELS = 5
FLIPS = 0xE0000000        # Tiled's flip flags
GID_MASK = 0x1FFFFFFF
SHORE_SIDES = ("north", "south", "east", "west")
CODE_TILES = ("empty", "heap", "heap_wet", "crop_withered", "void", "floor", "wall_in", "grass")


def gid_index(g):
    """Tile number for a gid (flip flags removed), or -1 for an empty square."""
    g = (g or 0) & GID_MASK
    return g - 1 if g else -1


# ------------------------------------------------------------------ files

def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_text(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def write_json(path, data, indent=1):
    write_text(path, json.dumps(data, indent=indent, ensure_ascii=False) + "\n")


def write_catalog(cat):
    """tiles.json with one tile (or object) per line, so changes are easy to read in a pull request."""
    def lines(items):
        return ",\n".join("  " + json.dumps(i, ensure_ascii=False, sort_keys=True) for i in items)
    text = ('{\n "tiles": [\n%s\n ],\n "recolors": %s,\n "seasons": %s,\n "objects": [\n%s\n ],\n "shore": %s\n}\n' % (
        lines(cat.get("tiles", [])), json.dumps(cat.get("recolors", {}), sort_keys=True),
        json.dumps(cat.get("seasons", {}), sort_keys=True), lines(cat.get("objects", [])),
        json.dumps(cat.get("shore", {}), sort_keys=True)))
    write_text(CATALOG, text)


def load_catalog():
    cat = read_json(CATALOG)
    if not cat:
        sys.exit("maps-src/tiles.json is missing.")
    return cat


def load_maps():
    maps = {}
    for name in sorted(os.listdir(MAPS)):
        if name.endswith(".tmj"):
            maps[name[:-4]] = read_json(os.path.join(MAPS, name))
    return maps


def art_sources():
    """Every PNG in art-src/, as paths relative to it (empty without the art packs)."""
    out = []
    for base, dirs, files in os.walk(ART):
        dirs.sort()
        for f in sorted(files):
            if f.lower().endswith(".png"):
                out.append(os.path.relpath(os.path.join(base, f), ART).replace(os.sep, "/"))
    return out


# --------------------------------------------------------------- the tile plan
#
# The plan is the layout of assets/tiles.png and assets/objects.png: what picture goes in every slot.
# It's worked out here (so --check can tell the lists are up to date without the art), and the map
# maker's page draws the pictures from it (tools/map-maker/atlas.js).

def autotile_quarters(mask):
    """
    Where the four 8x8 quarters of an autotile piece come from, for the neighbours in `mask`
    (bits: 1 N, 2 NE, 4 E, 8 SE, 16 S, 32 SW, 64 W, 128 NW; a bit is set when that neighbour is the
    same kind of tile). Quarters are counted in the autotile's 2 x 3-tile block (4 x 6 quarters),
    laid out as RPG Maker does: the top-right tile holds the inside corners, the 2 x 2 tiles below
    hold the outside corners, the edges and the middle.
    Returns [[qx, qy], ...] for the top-left, top-right, bottom-left and bottom-right quarters.
    """
    def on(bit):
        return bool(mask & bit)
    out = []
    for hy in (0, 1):
        for hx in (0, 1):
            v = on(16) if hy else on(1)
            h = on(4) if hx else on(64)
            d = on({(0, 0): 128, (1, 0): 2, (0, 1): 32, (1, 1): 8}[(hx, hy)])
            if not v and not h:
                q = (3 if hx else 0, 2 + (3 if hy else 0))
            elif v and not h:
                q = (3 if hx else 0, 2 + (1 if hy else 2))
            elif h and not v:
                q = (1 if hx else 2, 2 + (3 if hy else 0))
            elif not d:
                q = (2 + hx, hy)
            else:
                q = (1 if hx else 2, 2 + (1 if hy else 2))
            out.append(list(q))
    return out


def autotile_pieces():
    """The distinct pieces (47), and for each of the 256 neighbour masks which piece it uses."""
    keys, table = [], []
    for mask in range(256):
        k = json.dumps(autotile_quarters(mask))
        if k not in keys:
            keys.append(k)
        table.append(keys.index(k))
    return [json.loads(k) for k in keys], table


def tile_source(cat, e):
    """The drawing of a plain tile entry: {src, x, y[, recolor]} or {} for a blank tile."""
    if not e or "src" not in e:
        return {}
    d = {"src": e["src"], "x": int(e["x"]), "y": int(e["y"])}
    if e.get("recolor"):
        d["recolor"] = cat.get("recolors", {}).get(e["recolor"], [])
    return d


def plan(cat):
    """
    The layout of the game's tile image and object image, and the tile facts the game needs.
    Slots 0..len(tiles)-1 are the tile list's own tiles (the numbers maps use). After them come
    autotile pieces and the extra frames of animations, in a fixed order.
    """
    tiles = cat.get("tiles", [])
    names = {e["name"]: i for i, e in enumerate(tiles)}
    slots, solid, anims, autos = [], set(), {}, {}
    pieces, table = autotile_pieces()
    isolated = table[0]

    def auto_slot(a, piece, frame):
        under = tile_source(cat, tiles[names[a["under"]]]) if a.get("under") in names else {}
        return {"auto": {"src": a["src"], "x": int(a["x"]), "y": int(a["y"]), "step": int(a.get("step", 2))},
                "quarters": pieces[piece], "frame": frame, "under": under}

    for i, e in enumerate(tiles):
        if "autotile" in e:
            slots.append(auto_slot(e["autotile"], isolated, 0))
        elif e.get("frames"):
            slots.append(tile_source(cat, e["frames"][0]))
        else:
            slots.append(tile_source(cat, e))
        if e.get("solid"):
            solid.add(i)
    for i, e in enumerate(tiles):
        if "autotile" not in e:
            continue
        a = e["autotile"]
        first = len(slots)
        for p in range(len(pieces)):
            slots.append(auto_slot(a, p, 0))
            if e.get("solid"):
                solid.add(first + p)
        autos[e["name"]] = {"base": i, "table": [first + p for p in table]}
    for i, e in enumerate(tiles):
        if e.get("frames") and len(e["frames"]) > 1:
            frames = [i]
            for f in e["frames"][1:]:
                frames.append(len(slots))
                slots.append(tile_source(cat, f))
            anims[i] = {"frames": frames, "ms": int(e.get("ms", 250))}
    for i, e in enumerate(tiles):
        a = e.get("autotile")
        if not a or int(a.get("frames", 1)) < 2:
            continue
        base_slots = [i] + sorted(set(autos[e["name"]]["table"]))
        for s in base_slots:
            frames = [s]
            for f in range(1, int(a["frames"])):
                frames.append(len(slots))
                d = copy.deepcopy(slots[s])
                d["frame"] = f
                slots.append(d)
            anims[s] = {"frames": frames, "ms": int(a.get("ms", 300))}

    # Animated objects: frames packed in rows into assets/objects.png
    objects, oslots, x, y, row_h = {}, [], 0, 0, 0
    for o in cat.get("objects", []):
        w, h = int(o["w"]), int(o["h"])
        rects = []
        for c, r in o.get("frames", [[0, 0]]):
            if x + w > OBJECTS_WIDTH:
                x, y, row_h = 0, y + row_h, 0
            oslots.append({"src": o["src"], "sx": int(o["x"]) + c * w, "sy": int(o["y"]) + r * h, "w": w, "h": h,
                           "dx": x, "dy": y})
            rects.append([x, y, w, h])
            x += w
            row_h = max(row_h, h)
        objects[o["name"]] = {"frames": rects, "ms": int(o.get("ms", 200))}
    objects_height = y + row_h

    swaps = {}
    for season, rules in cat.get("seasons", {}).items():
        swaps[season] = {}
        for a, b in sorted(rules.items()):
            if a in names and b in names:
                swaps[season][names[a]] = names[b]
    rows = max(1, (len(slots) + COLS - 1) // COLS)
    layout = {"slots": slots, "objects": oslots}
    digest = hashlib.sha1(json.dumps(layout, sort_keys=True).encode("utf-8")).hexdigest()[:16]
    meta = {
        "columns": COLS, "count": len(slots), "tileCount": len(tiles), "width": COLS * T, "height": rows * T,
        "names": names, "collides": sorted(solid), "anims": {str(k): v for k, v in sorted(anims.items())},
        "autotiles": autos, "swaps": {k: {str(a): b for a, b in v.items()} for k, v in swaps.items()},
        "objects": objects, "objectsWidth": OBJECTS_WIDTH, "objectsHeight": max(1, objects_height),
        "shore": {k: v for k, v in cat.get("shore", {}).items() if v in objects},
        "stamps": {}, "planHash": digest,
    }
    return {"slots": slots, "objects": oslots, "meta": meta}


def catalog_problems(cat):
    """Mistakes in the tile list that would break the game or the build."""
    out = []
    tiles = cat.get("tiles", [])
    seen = set()
    for i, e in enumerate(tiles):
        n = e.get("name", "")
        if not NAME_RE.match(n):
            out.append("Tile %d has a name that isn't lowercase letters, digits and _ (%r)." % (i, n))
        if n in seen:
            out.append("Two tiles are called %s." % n)
        seen.add(n)
        for d in [e] + list(e.get("frames") or []):
            if "src" in d and d.get("recolor") and d["recolor"] not in cat.get("recolors", {}):
                out.append("The tile %s uses the recolouring %s, which isn't in the list." % (n, d["recolor"]))
        a = e.get("autotile")
        if a and a.get("under") and a["under"] not in seen and a["under"] not in [t.get("name") for t in tiles]:
            out.append("The autotile %s is drawn over %s, which isn't a tile." % (n, a["under"]))
    for name in CODE_TILES:
        if name not in seen:
            out.append("The game's code needs a tile called %s." % name)
    for season, rules in cat.get("seasons", {}).items():
        if season not in SEASONS:
            out.append("The season %s isn't one of the game's (%s)." % (season, ", ".join(SEASONS)))
        for a, b in rules.items():
            if a not in seen or b not in seen:
                out.append("A %s rule changes %s to %s, but both must be tiles." % (season, a, b))
    onames = [o.get("name") for o in cat.get("objects", [])]
    for side, o in cat.get("shore", {}).items():
        if side not in SHORE_SIDES or (o and o not in onames):
            out.append("The shore foam for %s uses %s, which isn't an animated object." % (side, o))
    return out


def tiles_js(meta):
    keep = {k: meta[k] for k in ("names", "collides", "anims", "autotiles", "swaps", "objects", "shore")}
    return ("// GENERATED by tools/map_maker.py from maps-src/tiles.json - don't edit it by hand:\n"
            "// open the map maker (python tools/map_maker.py) or edit tiles.json, then save.\n"
            "(function (FS) {\n  'use strict';\n  const data = " + json.dumps(keep, separators=(",", ":"), sort_keys=True) + ";\n"
            "  FS.Tiles = {\n"
            "    FIRST_GID: 1,\n"
            "    COUNT: %d,             // tiles in assets/tiles.png (the list's own, then autotile pieces and frames)\n"
            "    names: data.names,     // tile name -> number (the numbers maps use)\n"
            "    collides: data.collides, anims: data.anims, autotiles: data.autotiles,\n"
            "    swaps: data.swaps, objects: data.objects, shore: data.shore,\n"
            "    /** A tile's number by name (the code uses names, so the tile list can change). */\n"
            "    idx: function (name) { const i = data.names[name]; FS.assert(i !== undefined, 'no tile called ' + name); return i; },\n"
            "    gid: function (index) { return index + 1; }\n"
            "  };\n})(FarmSim);\n") % meta["count"]


def write_meta(meta):
    """tileset.json and src/data/tiles.js (stamps sizes kept for older tools)."""
    write_json(TILESET, meta)
    write_text(TILES_JS, tiles_js(meta))


def tile_meta():
    meta = read_json(TILESET)
    if not meta:
        sys.exit("maps-src/tileset.json is missing: run python tools/map_maker.py --build.")
    return meta, list(meta["collides"])


def load_stamps(meta):
    return read_json(STAMPS, [])


# --------------------------------------------------------------- the maps

def prop(obj, name, default=None):
    for p in obj.get("properties") or []:
        if p.get("name") == name:
            return p.get("value")
    return default


def set_prop(obj, name, value, typ):
    props = [p for p in (obj.get("properties") or []) if p.get("name") != name]
    props.append({"name": name, "type": typ, "value": value})
    obj["properties"] = sorted(props, key=lambda p: p["name"])


def layer(m, name):
    for l in m["layers"]:
        if l.get("name") == name:
            return l
    return None


def objects(m):
    l = layer(m, "objects")
    return l.get("objects", []) if l else []


def obj_type(o):
    return o.get("type") or o.get("class") or ""


def cond_layers(m):
    """Layers shown only sometimes (rain, a season, the tide...): tile layers with a 'when' property."""
    return [l for l in m["layers"] if l.get("type") == "tilelayer" and prop(l, "when") is not None]


def tiles_tileset(meta, solid):
    return {"firstgid": 1, "name": "tiles", "image": "../assets/tiles.png", "imagewidth": meta["width"],
            "imageheight": meta["height"], "tilewidth": T, "tileheight": T, "tilecount": meta["count"],
            "columns": meta["columns"], "margin": 0, "spacing": 0,
            "tiles": [{"id": i, "properties": [{"name": "collides", "type": "bool", "value": True}]} for i in solid]}


def collision_tileset(firstgid):
    return {"firstgid": firstgid, "name": "collision", "image": "../tools/map-maker/collision.png",
            "imagewidth": 32, "imageheight": 16, "tilewidth": T, "tileheight": T, "tilecount": 2, "columns": 2,
            "margin": 0, "spacing": 0}


def heights_tileset(firstgid):
    return {"firstgid": firstgid, "name": "tide", "image": "../tools/map-maker/tide.png",
            "imagewidth": 80, "imageheight": 16, "tilewidth": T, "tileheight": T, "tilecount": TIDE_LEVELS,
            "columns": TIDE_LEVELS, "margin": 0, "spacing": 0}


COLLISION_FIRSTGID = 100001   # fixed, so the tile list can grow without changing these layers
TIDE_FIRSTGID = 100003


def firstgids(meta=None):
    """gids of the collision layer's two tiles (block, open) and the tide layer's five heights."""
    return COLLISION_FIRSTGID, TIDE_FIRSTGID


LAYER_ORDER = {"ground": 0, "decor": 1, "above": 2, "tide": 50, "collision": 51, "objects": 52}


def normalise(key, m, meta, solid):
    """Puts a map in the form the game and Tiled both read, without changing what's on it."""
    m["type"], m["orientation"], m["renderorder"] = "map", "orthogonal", "right-down"
    m["infinite"] = False
    m["tilewidth"] = m["tileheight"] = T
    m.setdefault("version", "1.10")
    m.setdefault("tiledversion", "1.10.2")
    m.setdefault("compressionlevel", -1)
    w, h = m["width"], m["height"]
    for name in TILE_LAYERS:
        if not layer(m, name):
            m["layers"].append({"name": name, "type": "tilelayer", "data": [0] * (w * h)})
    if not layer(m, "objects"):
        m["layers"].append({"name": "objects", "type": "objectgroup", "draworder": "topdown", "objects": []})
    m["layers"].sort(key=lambda l: (LAYER_ORDER.get(l.get("name"), 10), l.get("name")))
    for i, l in enumerate(m["layers"]):
        l["id"] = i + 1
        l.update({"x": 0, "y": 0, "opacity": l.get("opacity", 1), "visible": l.get("visible", True)})
        if l["type"] == "tilelayer":
            l["width"], l["height"] = w, h
            l.pop("encoding", None)
            l.pop("compression", None)
            assert isinstance(l["data"], list) and len(l["data"]) == w * h, "%s: layer %s has the wrong size" % (key, l["name"])
    m["nextlayerid"] = len(m["layers"]) + 1
    objs = objects(m)
    for o in objs:
        o.setdefault("rotation", 0)
        o.setdefault("visible", True)
        o.setdefault("properties", [])
        o.pop("class", None)
    m["nextobjectid"] = max([o.get("id", 0) for o in objs] + [0]) + 1
    col_first, tide_first = firstgids(meta)
    m["tilesets"] = [tiles_tileset(meta, solid), collision_tileset(col_first)]
    if layer(m, "tide"):
        m["tilesets"].append(heights_tileset(tide_first))
    return m


def blocked_squares(m, meta, solid):
    """Every square the player can't stand on (with the map as painted), as a set of (x, y)."""
    w, solid = m["width"], set(solid)
    out = set()
    for name in TILE_LAYERS:
        l = layer(m, name)
        for i, g in enumerate(l["data"] if l else []):
            if gid_index(g) in solid:
                out.add((i % w, i // w))
    col = layer(m, "collision")
    if col:
        first = firstgids(meta)[0]
        for i, g in enumerate(col["data"]):
            if g == first:
                out.add((i % w, i // w))
            elif g == first + 1:
                out.discard((i % w, i // w))
    return out


def flooded_squares(m, meta):
    """Squares the sea covers at the highest tide (tide layer heights 1-5)."""
    l = layer(m, "tide")
    out = set()
    if not l:
        return out
    first = firstgids(meta)[1]
    for i, g in enumerate(l["data"]):
        if first <= g < first + TIDE_LEVELS:
            out.add((i % m["width"], i // m["width"]))
    return out


WHEN_RE = re.compile(r"^(rain|dry|night|day|season:[a-z,]+|tide:[0-4](-[0-4])?)$")


def check(maps, meta, solid, cat=None):
    """Problems that would break the game, as [{"map", "text", "x", "y"}]; warnings start with "Note:"."""
    problems = []

    def problem(key, text, o=None, x=None, y=None):
        if o is not None:
            x, y = int(o["x"] // T), int(o["y"] // T)
        problems.append({"map": key, "text": text, "x": x, "y": y})

    tile_count = meta.get("tileCount", meta["count"])
    object_names = set(meta.get("objects", {}))
    ids = {}
    for key, m in sorted(maps.items()):
        if not KEY_RE.match(key):
            problem(key, "The map's name must be lowercase letters, digits and _ (starting with a letter).")
        mid = prop(m, "id")
        if not isinstance(mid, int) or not 0 <= mid <= MAX_ID:
            problem(key, "The map needs an id from 0 to %d (Map settings)." % MAX_ID)
        elif mid in ids:
            problem(key, "The id %d is also %s's: every map needs its own." % (mid, ids[mid]))
        else:
            ids[mid] = key
        if not (1 <= m["width"] <= MAX_SIZE and 1 <= m["height"] <= MAX_SIZE):
            problem(key, "Maps can be at most %d x %d squares." % (MAX_SIZE, MAX_SIZE))
        for l in [layer(m, n) for n in TILE_LAYERS] + cond_layers(m):
            if not l:
                continue
            for i, g in enumerate(l["data"]):
                if gid_index(g) >= tile_count:
                    problem(key, "The layer %s uses a tile that isn't in the tile list (%d)." % (l["name"], gid_index(g)),
                            x=i % m["width"], y=i // m["width"])
                    break
        for l in cond_layers(m):
            when = str(prop(l, "when", ""))
            if not all(WHEN_RE.match(p.strip()) for p in when.split("&")):
                problem(key, "The layer %s has a condition the game doesn't understand (%s)." % (l["name"], when))
            if prop(l, "target") not in TILE_LAYERS:
                problem(key, "The layer %s must say which layer it draws on (ground, decor or above)." % l["name"])
        tw = prop(m, "tideWater")
        if layer(m, "tide") and tw and tw not in meta.get("autotiles", {}):
            problem(key, "The tide's water is %s, which isn't an autotile." % tw)
        blocked = blocked_squares(m, meta, solid)
        flooded = flooded_squares(m, meta)
        objs = objects(m)
        if len(objs) > BUSY:
            problem(key, "Note: %d objects on one map may be slow on old phones." % len(objs))
        rooms = [o for o in objs if obj_type(o) == "room"]
        for i, a in enumerate(rooms):
            for b in rooms[i + 1:]:
                if a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"] and \
                        a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"]:
                    problem(key, "The rooms %s and %s overlap." % (a.get("name"), b.get("name")), a)
        names = {}
        for o in objs:
            t, name = obj_type(o), o.get("name") or ""
            cx, cy = o["x"] + o.get("width", T) / 2, o["y"] + o.get("height", T) / 2
            if t not in OBJECT_TYPES:
                problem(key, "The object %s has no type the game knows (%s)." % (name or "?", t or "none"), o)
            if not (0 <= cx < m["width"] * T and 0 <= cy < m["height"] * T):
                problem(key, "The object %s is outside the map." % (name or t), o)
            if rooms and t in ("spawn", "warp", "bed", "ship", "sign", "npc", "critter", "anim") and not any(
                    r["x"] <= cx < r["x"] + r["width"] and r["y"] <= cy < r["y"] + r["height"] for r in rooms):
                problem(key, "The %s %s isn't in any room, so it can't be reached." % (t, name), o)
            if t in ("spawn", "warp") and name:
                if (t, name) in names:
                    problem(key, "Two %ss are called %s." % (t, name), o)
                names[(t, name)] = o
            if t == "anim" and prop(o, "sprite") not in object_names:
                problem(key, "The animated object %s shows %s, which isn't in the tile list's objects." % (name, prop(o, "sprite")), o)
            if t == "spawn":
                if not name:
                    problem(key, "A spawn has no name, so no warp can lead to it.", o)
                sq = (int(o["x"] // T), int(o["y"] // T))
                if sq in blocked:
                    problem(key, "The spawn %s is on a square the player can't stand on." % name, o)
                elif sq in flooded:
                    problem(key, "The spawn %s is under water at high tide." % name, o)
            if t == "warp":
                target, spawn = prop(o, "target"), prop(o, "spawn")
                if target not in maps:
                    problem(key, "The warp %s leads to a map that doesn't exist (%s)." % (name, target), o)
                elif not any(obj_type(s) == "spawn" and s.get("name") == spawn for s in objects(maps[target])):
                    problem(key, "The warp %s leads to %s, which has no spawn called %s." % (name, target, spawn), o)
        if key == "farm" and len([o for o in objs if obj_type(o) == "farmland"]) != 1:
            problem(key, "The farm needs exactly one farmland object.")
    if HOME[0] not in maps or not any(obj_type(o) == "spawn" and o.get("name") == HOME[1] for o in objects(maps[HOME[0]])):
        problem(HOME[0], "A new game starts at the spawn %s on the map %s, which is missing." % (HOME[1], HOME[0]))
    if cat is not None:
        for text in catalog_problems(cat):
            problems.append({"map": "tiles", "text": text, "x": None, "y": None})
    return problems


def area_info(k, m):
    return {"id": prop(m, "id"), "key": k, "outdoor": bool(prop(m, "outdoor", False)),
            "tideDelay": prop(m, "tideDelay", 0) or 0, "tideSize": prop(m, "tideSize", 1),
            "tideWater": prop(m, "tideWater", "") or ""}


def maps_js(maps):
    area_list = [area_info(k, m) for k, m in sorted(maps.items(), key=lambda kv: (prop(kv[1], "id") is None, prop(kv[1], "id") or 0))]
    return ("// AUTO-GENERATED by tools/map_maker.py from maps-src/*.tmj - don't edit it by hand:\n"
            "// open the map maker (python tools/map_maker.py) or edit the .tmj files, then save.\n"
            "FarmSim.Maps = " + json.dumps(maps, separators=(",", ":"), sort_keys=True) + ";\n"
            "FarmSim.MapList = " + json.dumps(area_list) + ";\n")


def build(maps, meta, solid):
    """Writes src/data/maps.js: every map, and the list of areas for src/data/areas.js."""
    write_text(OUT, maps_js(maps))


def write_png(path, data_url):
    head, _, b64 = data_url.partition(",")
    if not head.startswith("data:image/png;base64"):
        raise ValueError("not a PNG")
    raw = base64.b64decode(b64)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(raw)
    os.replace(tmp, path)


def save_all(maps, deleted=(), stamps=None, catalog=None, images=None):
    """
    Writes the tile list (and its images and lists), every map (normalised), removes deleted maps,
    and rebuilds maps.js. Returns the problems.
    """
    if catalog is not None:
        new = plan(catalog)
        old = read_json(TILESET) or {}
        new["meta"]["drawnHash"] = old.get("drawnHash")
        if images and images.get("tiles"):
            write_png(TILES_PNG, images["tiles"])
            write_png(OBJECTS_PNG, images["objects"])
            new["meta"]["drawnHash"] = new["meta"]["planHash"]
        elif new["meta"]["planHash"] != old.get("drawnHash"):
            raise ValueError("The tile pictures changed, so the map maker needs the art in art-src/ to draw them.")
        write_catalog(catalog)
        write_meta(new["meta"])
    if stamps is not None:
        write_json(STAMPS, stamps)
    meta, solid = tile_meta()
    for key in deleted:
        path = os.path.join(MAPS, key + ".tmj")
        if KEY_RE.match(key) and os.path.exists(path):
            os.remove(path)
    for key, m in maps.items():
        if not KEY_RE.match(key):
            continue
        write_json(os.path.join(MAPS, key + ".tmj"), normalise(key, m, meta, solid))
    everything = {k: normalise(k, m, meta, solid) for k, m in load_maps().items()}
    build(everything, meta, solid)
    return check(everything, meta, solid, load_catalog())


# ----------------------------------------------------------------- looks

APPEARANCE_JS = os.path.join(ROOT, "src", "data", "appearance.js")
NPCS_JS = os.path.join(ROOT, "src", "data", "npcs.js")
OUTFITS_START = "    outfits: FS.makeRegistry('Outfits', [\n"
OUTFITS_END = "    ], 255),\n"


def colours(c):
    assert isinstance(c, list) and len(c) == 3 and all(
        isinstance(x, list) and len(x) == 3 and all(isinstance(v, int) and 0 <= v <= 255 for v in x) for x in c), "bad colours"
    return "[" + ", ".join("[%d, %d, %d]" % tuple(x) for x in c) + "]"


def save_looks(outfits, npc_looks):
    """The Looks page: rewrites the outfit list in appearance.js and villagers' looks in npcs.js."""
    with open(APPEARANCE_JS, encoding="utf-8") as f:
        text = f.read()
    a = text.index(OUTFITS_START) + len(OUTFITS_START)
    b = text.index(OUTFITS_END, a)
    ids, lines = set(), []
    for o in sorted(outfits, key=lambda o: o["id"]):
        assert isinstance(o["id"], int) and 0 <= o["id"] <= 255 and o["id"] not in ids, "outfit ids must be 0-255, each once"
        assert KEY_RE.match(o["key"]), "outfit names: lowercase letters, digits and _"
        ids.add(o["id"])
        head = "      { id: %d, key: '%s', price: %d," % (o["id"], o["key"], int(o.get("price") or 0))
        if o.get("pattern"):
            head += " pattern: true,"
        if o.get("onePiece"):
            head += " onePiece: true,"
        body = "        top: " + colours(o["top"])
        if not o.get("onePiece"):
            body += ", bottom: " + colours(o["bottom"])
        lines.append(head + "\n" + body + " }")
    text = text[:a] + ",\n".join(lines) + "\n" + text[b:]
    write_text(APPEARANCE_JS, text)
    with open(NPCS_JS, encoding="utf-8") as f:
        npcs = f.read()
    for key, lk in npc_looks.items():
        fields = ("body", "skin", "hair", "hairColor", "outfit")
        assert all(re.match(r"^[a-z0-9_]+$", str(lk.get(k, ""))) for k in fields), "bad look for " + key
        new = "{ " + ", ".join("%s: '%s'" % (k, lk[k]) for k in fields) + " }"
        npcs, n = re.subn(r"(key: '%s',\s*\n\s*look: )\{[^}]*\}" % re.escape(key), lambda m: m.group(1) + new, npcs)
        assert n == 1, "villager %s not found in npcs.js" % key
    write_text(NPCS_JS, npcs)


# ----------------------------------------------------------------- server

class Handler(SimpleHTTPRequestHandler):
    """The editor at /, the game's own files (for "Play here") everywhere else, and a small API."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/":
            self.send_response(302)
            self.send_header("Location", "/tools/map-maker/")
            return self.end_headers()
        if self.path == "/api/project":
            meta, solid = tile_meta()
            cat = load_catalog()
            maps = {k: normalise(k, m, meta, solid) for k, m in load_maps().items()}
            p = plan(cat)
            return self.send_json({
                "maps": maps, "tiles": meta, "solid": solid, "stamps": load_stamps(meta), "catalog": cat,
                "plan": {"slots": p["slots"], "objects": p["objects"]}, "sources": art_sources(),
                "collisionFirstgid": firstgids(meta)[0], "tideFirstgid": firstgids(meta)[1],
                "maxId": MAX_ID, "maxSize": MAX_SIZE, "seasons": SEASONS, "tideLevels": TIDE_LEVELS,
                "objectTypes": OBJECT_TYPES, "problems": check(maps, meta, solid, cat)})
        return super().do_GET()

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_POST(self):
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return self.send_json({"error": "only from this computer"}, 403)
        try:
            data = self.read_body()
            if self.path == "/api/plan":
                p = plan(data["catalog"])
                return self.send_json({"slots": p["slots"], "objects": p["objects"], "meta": p["meta"],
                                       "problems": catalog_problems(data["catalog"])})
            if self.path == "/api/looks":
                save_looks(data["outfits"], data["npcLooks"])
                return self.send_json({"saved": True})
            if self.path == "/api/save":
                problems = save_all(data.get("maps", {}), data.get("deleted", []), data.get("stamps"),
                                    data.get("catalog"), data.get("images"))
                meta, _ = tile_meta()
                return self.send_json({"saved": True, "problems": problems, "tiles": meta})
        except Exception as e:  # tell the page, which shows it
            return self.send_json({"error": str(e)}, 400)
        return self.send_json({"error": "not found"}, 404)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Plenty Heaps' map maker")
    parser.add_argument("--build", action="store_true", help="rebuild src/data/maps.js and the tile lists, and check")
    parser.add_argument("--check", action="store_true", help="only check the maps")
    parser.add_argument("--port", type=int, default=8300)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)

    if args.build or args.check:
        cat = load_catalog()
        new = plan(cat)["meta"]
        bad = []
        old = read_json(TILESET) or {}
        new["drawnHash"] = old.get("drawnHash")
        if new["planHash"] != new["drawnHash"]:
            print("assets/tiles.png is out of date with maps-src/tiles.json: open the map maker (with the art in "
                  "art-src/) and save, to draw it again.")
            bad.append("pictures out of date")
        if args.build:
            write_catalog(cat)
            write_meta(new)
        meta, solid = tile_meta()
        maps = {k: normalise(k, m, meta, solid) for k, m in load_maps().items()}
        if args.build:
            for k, m in maps.items():
                write_json(os.path.join(MAPS, k + ".tmj"), m)
            build(maps, meta, solid)
            print("Built src/data/maps.js (%d maps) and the tile lists (%d tiles)." % (len(maps), meta["tileCount"]))
        problems = check(maps, meta, solid, cat)
        for p in problems:
            print("%s: %s%s" % (p["map"], p["text"], "" if p["x"] is None else " (at %d, %d)" % (p["x"], p["y"])))
        bad += [p for p in problems if not p["text"].startswith("Note:")]
        if not args.build:
            with open(OUT, encoding="utf-8") as f:
                built = f.read()
            if built != maps_js(maps):
                print("src/data/maps.js is out of date: run python tools/map_maker.py --build")
                bad.append("out of date")
            with open(TILES_JS, encoding="utf-8") as f:
                if f.read() != tiles_js(new) or (read_json(TILESET) or {}).get("planHash") != new["planHash"]:
                    print("src/data/tiles.js or maps-src/tileset.json is out of date: save in the map maker")
                    bad.append("tiles out of date")
        if bad:
            sys.exit(1)
        print("The maps are fine.")
        return

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    url = "http://127.0.0.1:%d/" % server.server_address[1]
    print("The map maker is at %s  (press Ctrl+C to stop)" % url)
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, [url]).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
