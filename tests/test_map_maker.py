"""
Checks the map maker's checks find the problems that would break the game.

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
        mm.layer(m, "collision")["data"][(sp["y"] // 16) * m["width"] + sp["x"] // 16] = 1 + META["count"] + 1
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


if __name__ == "__main__":
    unittest.main()
