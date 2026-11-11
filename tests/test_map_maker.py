"""
Checks the map maker's checks find the problems that would break the game, and that the tile
list (maps-src/tiles.json) is sound and its lists are up to date.

    python tests/test_map_maker.py

Standard library only. Works on copies of the maps in memory; never changes maps-src/.
"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import map_maker as mm  # noqa: E402

META, SOLID = mm.tile_meta()
MAPS = {k: mm.normalise(k, m, META, SOLID) for k, m in mm.load_maps().items()}


def texts(maps):
    return [p["text"] for p in mm.check(maps, META, SOLID) if not p["text"].startswith("Note:")]


def obj(m, name):
    return [o for o in mm.objects(m) if o.get("name") == name][0]


class Checks(unittest.TestCase):
    def setUp(self):
        self.maps = copy.deepcopy(MAPS)

    def test_the_game_s_maps_are_fine(self):
        self.assertEqual(texts(self.maps), [])

    def test_a_warp_to_a_missing_map_or_spawn(self):
        warp = obj(self.maps["farm"], "door_house")
        mm.set_prop(warp, "spawn", "nowhere", "string")
        self.assertTrue(any("no spawn called nowhere" in t for t in texts(self.maps)))
        mm.set_prop(warp, "target", "moon", "string")
        self.assertTrue(any("doesn't exist (moon)" in t for t in texts(self.maps)))

    def test_a_spawn_in_a_wall(self):
        sp = obj(self.maps["farm"], "from_house")
        water = META["names"]["water"] + 1
        m = self.maps["farm"]
        mm.layer(m, "ground")["data"][(sp["y"] // 16) * m["width"] + sp["x"] // 16] = water
        self.assertTrue(any("can't stand on" in t for t in texts(self.maps)))
        # ...unless the collision layer opens that square
        m["layers"].append({"name": "collision", "type": "tilelayer", "data": [0] * (m["width"] * m["height"])})
        mm.layer(m, "collision")["data"][(sp["y"] // 16) * m["width"] + sp["x"] // 16] = mm.COLLISION_FIRSTGID + 1
        self.assertEqual(texts(self.maps), [])

    def test_flipped_tiles_are_still_the_same_tile(self):
        sp = obj(self.maps["farm"], "from_house")
        m = self.maps["farm"]
        water = META["names"]["water"] + 1
        mm.layer(m, "ground")["data"][(sp["y"] // 16) * m["width"] + sp["x"] // 16] = 0x80000000 + 0x20000000 + water
        self.assertTrue(any("can't stand on" in t for t in texts(self.maps)), "turned water still blocks")

    def test_a_tile_that_isn_t_in_the_list(self):
        m = self.maps["farm"]
        mm.layer(m, "decor")["data"][0] = META["tileCount"] + 1
        self.assertTrue(any("isn't in the tile list" in t for t in texts(self.maps)))

    def test_layers_shown_only_sometimes_need_a_condition_the_game_knows(self):
        m = self.maps["farm"]
        l = {"name": "puddles", "type": "tilelayer", "data": [0] * (m["width"] * m["height"]), "properties": []}
        mm.set_prop(l, "when", "rain", "string")
        mm.set_prop(l, "target", "ground", "string")
        m["layers"].append(l)
        self.assertEqual(texts(self.maps), [])
        for when in ("season:harmattan,warm", "tide:0-1", "rain&night", "dry"):
            mm.set_prop(l, "when", when, "string")
            self.assertEqual(texts(self.maps), [], when)
        mm.set_prop(l, "when", "sometimes", "string")
        self.assertTrue(any("doesn't understand" in t for t in texts(self.maps)))
        mm.set_prop(l, "when", "rain", "string")
        mm.set_prop(l, "target", "sky", "string")
        self.assertTrue(any("must say which layer" in t for t in texts(self.maps)))

    def test_a_spawn_the_tide_covers(self):
        m = self.maps["farm"]
        sp = obj(m, "from_house")
        tide = {"name": "tide", "type": "tilelayer", "data": [0] * (m["width"] * m["height"])}
        tide["data"][(sp["y"] // 16) * m["width"] + sp["x"] // 16] = mm.TIDE_FIRSTGID + 4
        m["layers"].append(tide)
        self.assertTrue(any("under water at high tide" in t for t in texts(self.maps)))

    def test_animated_objects_must_exist(self):
        m = self.maps["farm"]
        mm.objects(m).append({"id": 999, "name": "fish", "type": "anim", "x": 32, "y": 32, "width": 16, "height": 16,
                              "properties": [{"name": "sprite", "type": "string", "value": "nothing"}]})
        self.assertTrue(any("isn't in the tile list's objects" in t for t in texts(self.maps)))
        mm.set_prop(mm.objects(m)[-1], "sprite", "fish_school", "string")
        self.assertEqual(texts(self.maps), [])


    def test_ids_must_be_unique_and_fit_the_save(self):
        mm.set_prop(self.maps["village"], "id", 1, "int")
        self.assertTrue(any("also farm's" in t for t in texts(self.maps)))
        mm.set_prop(self.maps["village"], "id", 64, "int")
        self.assertTrue(any("from 0 to 63" in t for t in texts(self.maps)))

    def test_rooms_mustn_t_overlap_and_things_must_be_in_a_room(self):
        house = self.maps["house"]
        room = obj(house, "home")
        room["width"] = 32
        self.assertTrue(any("isn't in any room" in t for t in texts(self.maps)))
        room["width"] = house["width"] * 16
        extra = dict(room, id=999, name="other")
        mm.objects(house).append(extra)
        self.assertTrue(any("overlap" in t for t in texts(self.maps)))

    def test_maps_can_t_be_bigger_than_the_save_allows(self):
        self.maps["village"]["width"] = 256
        self.assertTrue(any("at most 255" in t for t in texts(self.maps)))

    def test_where_a_new_game_starts_must_exist(self):
        obj(self.maps["house"], "bed_spawn")["name"] = "moved"
        self.assertTrue(any("bed_spawn" in t for t in texts(self.maps)))


class TileList(unittest.TestCase):
    def setUp(self):
        self.cat = copy.deepcopy(mm.load_catalog())

    def test_the_tile_list_is_fine_and_up_to_date(self):
        self.assertEqual(mm.catalog_problems(self.cat), [])
        meta = mm.plan(self.cat)["meta"]
        self.assertEqual(meta["planHash"], META["planHash"], "tileset.json is up to date")
        self.assertEqual(META.get("drawnHash"), META["planHash"], "assets/tiles.png was drawn from this plan")

    def test_the_plan_keeps_the_list_s_numbers_and_adds_autotile_pieces(self):
        p = mm.plan(self.cat)
        meta = p["meta"]
        for i, t in enumerate(self.cat["tiles"]):
            self.assertEqual(meta["names"][t["name"]], i)
        pieces, table = mm.autotile_pieces()
        self.assertEqual(len(pieces), 47)
        for name, a in meta["autotiles"].items():
            self.assertEqual(len(set(a["table"])), 47, name)
            self.assertTrue(all(i >= meta["tileCount"] for i in a["table"]))
        # Adding a tile at the end doesn't renumber the others
        self.cat["tiles"].append({"name": "extra", "src": "own/tiles.png", "x": 0, "y": 0})
        self.assertEqual(mm.plan(self.cat)["meta"]["names"]["extra"], len(self.cat["tiles"]) - 1)

    def test_autotile_quarters(self):
        # Surrounded on all sides: the middle (filler) quarters; alone: the four outside corners
        self.assertEqual(mm.autotile_quarters(255), [[2, 4], [1, 4], [2, 3], [1, 3]])
        self.assertEqual(mm.autotile_quarters(0), [[0, 2], [3, 2], [0, 5], [3, 5]])
        # Neighbours N, E, S, W but not the corners: the inside-corner tile
        self.assertEqual(mm.autotile_quarters(1 | 4 | 16 | 64), [[2, 0], [3, 0], [2, 1], [3, 1]])

    def test_mistakes_in_the_tile_list(self):
        self.cat["tiles"].append(dict(self.cat["tiles"][1]))
        self.cat["seasons"]["harmattan"]["nothing"] = "grass"
        self.cat["shore"]["north"] = "no_such_object"
        self.cat["tiles"] = [t for t in self.cat["tiles"] if t["name"] != "heap"]
        probs = " ".join(mm.catalog_problems(self.cat))
        self.assertIn("Two tiles are called grass", probs)
        self.assertIn("both must be tiles", probs)
        self.assertIn("isn't an animated object", probs)
        self.assertIn("needs a tile called heap", probs)

if __name__ == "__main__":
    unittest.main()
