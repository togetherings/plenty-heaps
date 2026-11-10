#!/usr/bin/env python3
"""
The map maker: edit Plenty Heaps' maps in your browser, on your own computer.

    python tools/map_maker.py            open the map maker (http://127.0.0.1:8300/)
    python tools/map_maker.py --build    rebuild src/data/maps.js from maps-src/ (and check the maps)
    python tools/map_maker.py --check    only check the maps (the game's tests run this)

Needs Python 3.8 or later and nothing else. Run it from anywhere; it works on the folder it's in.

How the maps are kept:
  maps-src/<key>.tmj        one file per map, in Tiled's format (Tiled can still open them).
                            The map's properties: id (0-63, permanent: saves use it) and outdoor.
  maps-src/tileset.json     the tiles (made by tools/build_assets.py with the art packs).
  maps-src/tile-settings.json   tiles you've made solid or walkable in the map maker, on top of
                            what build_assets.py says.
  maps-src/stamps.json      multi-tile objects (a hut, a tree...) to place in one go.
  src/data/maps.js          what the game loads: every map and the list of areas (built from the
                            above every time you save; don't edit it).

The map maker saves into these files. Then commit them (with GitHub Desktop, say) and open a
pull request as usual. Standard library only.
"""
import argparse
import json
import os
import re
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAPS = os.path.join(ROOT, "maps-src")
EDITOR = os.path.join(ROOT, "tools", "map-maker")
OUT = os.path.join(ROOT, "src", "data", "maps.js")
TILESET = os.path.join(MAPS, "tileset.json")
SETTINGS = os.path.join(MAPS, "tile-settings.json")
STAMPS = os.path.join(MAPS, "stamps.json")

T = 16
MAX_ID = 63           # 6 bits in the save (src/core/saveCodec.js)
MAX_SIZE = 255        # the save keeps the player's square in 8 bits each way
BUSY = 250            # objects in one map before the map maker warns
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
TILE_LAYERS = ("ground", "decor", "above")
OBJECT_TYPES = ("spawn", "warp", "room", "farmland", "ship", "bed", "sign", "npc", "critter")
HOME = ("house", "bed_spawn")   # where a new game starts (FS.Areas.HOME in src/data/areas.js)


# ------------------------------------------------------------------ files

def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, data, indent=1):
    text = json.dumps(data, indent=indent, ensure_ascii=False) + "\n"
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def tile_meta():
    meta = read_json(TILESET)
    if not meta:
        sys.exit("maps-src/tileset.json is missing: run tools/build_assets.py first.")
    settings = read_json(SETTINGS, {"solid": [], "walkable": []})
    solid = (set(meta["collides"]) | set(settings.get("solid", []))) - set(settings.get("walkable", []))
    return meta, sorted(solid)


def load_maps():
    maps = {}
    for name in sorted(os.listdir(MAPS)):
        if name.endswith(".tmj"):
            maps[name[:-4]] = read_json(os.path.join(MAPS, name))
    return maps


def default_stamps(meta):
    """The art's multi-tile objects, the top rows drawn over the player (as the first maps had them)."""
    above_rows = {"hut": 4, "hutsm": 4, "palm": 2, "mango": 3, "stall": 1, "shipbin": 1}
    names = meta["names"]
    out = []
    for name, (w, h) in sorted(meta.get("stamps", {}).items()):
        layers = {k: [-1] * (w * h) for k in TILE_LAYERS}
        for r in range(h):
            for c in range(w):
                idx = names.get("%s_%d_%d" % (name, c, r))
                if idx is not None:
                    layers["above" if r < above_rows.get(name, 0) else "decor"][r * w + c] = idx
        out.append({"name": name, "width": w, "height": h, "layers": layers})
    return out


def load_stamps(meta):
    stamps = read_json(STAMPS)
    if stamps is None:
        stamps = default_stamps(meta)
        write_json(STAMPS, stamps)
    return stamps


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


def tiles_tileset(meta, solid):
    return {"firstgid": 1, "name": "tiles", "image": "../assets/tiles.png", "imagewidth": meta["width"],
            "imageheight": meta["height"], "tilewidth": T, "tileheight": T, "tilecount": meta["count"],
            "columns": meta["columns"], "margin": 0, "spacing": 0,
            "tiles": [{"id": i, "properties": [{"name": "collides", "type": "bool", "value": True}]} for i in solid]}


def collision_tileset(firstgid):
    return {"firstgid": firstgid, "name": "collision", "image": "../tools/map-maker/collision.png",
            "imagewidth": 32, "imageheight": 16, "tilewidth": T, "tileheight": T, "tilecount": 2, "columns": 2,
            "margin": 0, "spacing": 0}


def normalise(key, m, meta, solid):
    """Puts a map in the form the game and Tiled both read, without changing what's on it."""
    m["type"], m["orientation"], m["renderorder"] = "map", "orthogonal", "right-down"
    m["infinite"] = False
    m["tilewidth"] = m["tileheight"] = T
    m.setdefault("version", "1.10")
    m.setdefault("tiledversion", "1.10.2")
    m.setdefault("compressionlevel", -1)
    w, h = m["width"], m["height"]
    order = {"ground": 0, "decor": 1, "above": 2, "collision": 3, "objects": 4}
    for name in ("ground", "decor", "above"):
        if not layer(m, name):
            m["layers"].append({"name": name, "type": "tilelayer", "data": [0] * (w * h)})
    if not layer(m, "objects"):
        m["layers"].append({"name": "objects", "type": "objectgroup", "draworder": "topdown", "objects": []})
    m["layers"].sort(key=lambda l: order.get(l.get("name"), 9))
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
    m["tilesets"] = [tiles_tileset(meta, solid)]
    if layer(m, "collision"):
        m["tilesets"].append(collision_tileset(1 + meta["count"]))
    return m


def blocked_squares(m, meta, solid):
    """Every square the player can't stand on, as a set of (x, y)."""
    w, solid = m["width"], set(solid)
    out = set()
    for name in TILE_LAYERS:
        l = layer(m, name)
        for i, g in enumerate(l["data"] if l else []):
            if g and (g - 1) in solid:
                out.add((i % w, i // w))
    col = layer(m, "collision")
    if col:
        first = 1 + meta["count"]
        for i, g in enumerate(col["data"]):
            if g == first:
                out.add((i % w, i // w))
            elif g == first + 1:
                out.discard((i % w, i // w))
    return out


def check(maps, meta, solid):
    """Problems that would break the game, as [{"map", "text", "x", "y"}]; warnings start with "Note:"."""
    problems = []

    def problem(key, text, o=None):
        x = y = None
        if o is not None:
            x, y = int(o["x"] // T), int(o["y"] // T)
        problems.append({"map": key, "text": text, "x": x, "y": y})

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
        blocked = blocked_squares(m, meta, solid)
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
            if rooms and t in ("spawn", "warp", "bed", "ship", "sign", "npc", "critter") and not any(
                    r["x"] <= cx < r["x"] + r["width"] and r["y"] <= cy < r["y"] + r["height"] for r in rooms):
                problem(key, "The %s %s isn't in any room, so it can't be reached." % (t, name), o)
            if t in ("spawn", "warp") and name:
                if (t, name) in names:
                    problem(key, "Two %ss are called %s." % (t, name), o)
                names[(t, name)] = o
            if t == "spawn":
                if not name:
                    problem(key, "A spawn has no name, so no warp can lead to it.", o)
                if (int(o["x"] // T), int(o["y"] // T)) in blocked:
                    problem(key, "The spawn %s is on a square the player can't stand on." % name, o)
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
    return problems


def build(maps, meta, solid):
    """Writes src/data/maps.js: every map, and the list of areas for src/data/areas.js."""
    area_list = [{"id": prop(m, "id"), "key": k, "outdoor": bool(prop(m, "outdoor", False))}
                 for k, m in sorted(maps.items(), key=lambda kv: (prop(kv[1], "id") is None, prop(kv[1], "id") or 0))]
    text = ("// AUTO-GENERATED by tools/map_maker.py from maps-src/*.tmj - don't edit it by hand:\n"
            "// open the map maker (python tools/map_maker.py) or edit the .tmj files, then save.\n"
            "FarmSim.Maps = " + json.dumps(maps, separators=(",", ":"), sort_keys=True) + ";\n"
            "FarmSim.MapList = " + json.dumps(area_list) + ";\n")
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, OUT)


def save_all(maps, deleted=(), solid_settings=None, stamps=None):
    """Writes every map (normalised), removes deleted ones, and rebuilds maps.js. Returns the problems."""
    if solid_settings is not None:
        write_json(SETTINGS, solid_settings)
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
    return check(everything, meta, solid)


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
            maps = {k: normalise(k, m, meta, solid) for k, m in load_maps().items()}
            return self.send_json({
                "maps": maps, "tiles": meta, "solid": solid, "stamps": load_stamps(meta),
                "settings": read_json(SETTINGS, {"solid": [], "walkable": []}),
                "collisionFirstgid": 1 + meta["count"], "maxId": MAX_ID, "maxSize": MAX_SIZE,
                "objectTypes": OBJECT_TYPES, "problems": check(maps, meta, solid)})
        return super().do_GET()

    def do_POST(self):
        if self.path != "/api/save":
            return self.send_json({"error": "not found"}, 404)
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return self.send_json({"error": "only from this computer"}, 403)
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            problems = save_all(data.get("maps", {}), data.get("deleted", []), data.get("settings"), data.get("stamps"))
        except Exception as e:  # tell the page, which shows it
            return self.send_json({"error": str(e)}, 400)
        return self.send_json({"saved": True, "problems": problems})


def main(argv=None):
    parser = argparse.ArgumentParser(description="Plenty Heaps' map maker")
    parser.add_argument("--build", action="store_true", help="rebuild src/data/maps.js from maps-src/ and check")
    parser.add_argument("--check", action="store_true", help="only check the maps")
    parser.add_argument("--port", type=int, default=8300)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args(argv)

    if args.build or args.check:
        meta, solid = tile_meta()
        maps = {k: normalise(k, m, meta, solid) for k, m in load_maps().items()}
        if args.build:
            for k, m in maps.items():
                write_json(os.path.join(MAPS, k + ".tmj"), m)
            build(maps, meta, solid)
            print("Built src/data/maps.js (%d maps)." % len(maps))
        problems = check(maps, meta, solid)
        for p in problems:
            print("%s: %s%s" % (p["map"], p["text"], "" if p["x"] is None else " (at %d, %d)" % (p["x"], p["y"])))
        bad = [p for p in problems if not p["text"].startswith("Note:")]
        if not args.build:
            with open(OUT, encoding="utf-8") as f:
                built = f.read()
            if json.dumps(maps, separators=(",", ":"), sort_keys=True) not in built:
                print("src/data/maps.js is out of date: run python tools/map_maker.py --build")
                bad.append("out of date")
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
