"""
Uses the map maker in a browser, on a copy of the game (your maps are never changed):
paints a flipped tile, adds a layer shown only in the rain and a tide, adds an interior to the
village with the dialog, saves, then plays the new room and walks out of its door back to the
village, and plays the village (with its new tide) with the WebGL and the Canvas renderers.

    pip install playwright && python -m playwright install chromium
    python tests/map_maker_browser.py [screenshots-folder]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = shutil.ignore_patterns(".git", "art-src", "node_modules", "dist", "_site", "screenshots", "kolibri-screenshots")


def main():
    shots = sys.argv[1] if len(sys.argv) > 1 else None
    if shots:
        os.makedirs(shots, exist_ok=True)
    work = tempfile.mkdtemp(prefix="map-maker-test-")
    root = os.path.join(work, "game")
    shutil.copytree(HERE, root, ignore=SKIP)
    port = 8391
    server = subprocess.Popen([sys.executable, "-u", os.path.join(root, "tools", "map_maker.py"), "--no-browser",
                               "--port", str(port)], stdout=subprocess.PIPE, universal_newlines=True)
    server.stdout.readline()
    base = "http://127.0.0.1:%d/" % port
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1400, "height": 860})
            page.on("pageerror", lambda e: errors.append("map maker: %s" % e))
            page.on("console", lambda m: m.type == "error" and errors.append("map maker console: " + m.text))
            page.goto(base)
            page.wait_for_function("window.mapMaker && window.mapMaker.current === 'farm'")
            assert "No problems found" in page.locator("#problems").inner_text()

            # Paint a rock, flipped left-right (X), on the decoration layer
            page.click("text=Decoration")
            idx, cols = page.evaluate("[mapMaker.project.tiles.names.rock, mapMaker.project.tiles.columns]")
            box = page.locator("#palette").bounding_box()
            z = box["width"] / (cols * 16)      # the palette is scaled to fit its panel

            def tile_at(i):
                return box["x"] + ((i % cols) + 0.5) * 16 * z, box["y"] + ((i // cols) + 0.5) * 16 * z
            page.mouse.click(*tile_at(idx))
            page.keyboard.press("x")
            view = page.locator("#view").bounding_box()
            page.mouse.click(view["x"] + view["width"] / 2 + 64, view["y"] + view["height"] / 2)
            assert page.locator("#status").inner_text().startswith("Not saved yet") or "flipped" in page.locator("#status").inner_text()

            # A layer shown only in the rain, with a sand puddle on it
            page.click("#layers >> text=New…")
            page.locator("#dialog input").nth(0).fill("puddles")
            page.locator("#dialog input").nth(1).fill("rain")
            page.locator("#dialog button[value=ok]").click()
            page.wait_for_function("document.querySelector('#layers select').value === 'puddles'")
            page.wait_for_timeout(200)     # the header may have changed size: measure again
            sand, = page.evaluate("[mapMaker.project.tiles.names.sand]")
            box, view = page.locator("#palette").bounding_box(), page.locator("#view").bounding_box()
            page.mouse.click(*tile_at(sand))
            page.mouse.click(view["x"] + view["width"] / 2 + 32, view["y"] + view["height"] / 2 + 32)
            page.wait_for_function("mapMaker.project.maps.farm.layers.some(l => l.name === 'puddles' && l.data.indexOf(%d) !== -1)" % (sand + 1), timeout=5000)
            if shots:
                page.screenshot(path=os.path.join(shots, "map-maker-1.png"))

            # The village gets a sea and a tide: ocean on the bottom rows, tide heights above them
            page.locator(".maps li", has_text="village").click()
            page.evaluate("""() => {
              const P = mapMaker.project, m = P.maps.village, w = m.width, h = m.height;
              const ground = m.layers.find(l => l.name === 'ground'), ocean = P.tiles.names.ocean + 1;
              for (let y = h - 3; y < h; y++) for (let x = 0; x < w; x++) ground.data[y * w + x] = ocean;
            }""")
            page.keyboard.press("h")
            page.evaluate("""() => {
              const P = mapMaker.project, m = P.maps.village, w = m.width, h = m.height;
              const tide = { name: 'tide', type: 'tilelayer', data: new Array(w * h).fill(0) };
              for (let x = 0; x < w; x++) { tide.data[(h - 4) * w + x] = P.tideFirstgid + 1; tide.data[(h - 5) * w + x] = P.tideFirstgid + 3; }
              m.layers.push(tide);
            }""")
            page.keyboard.press("p")
            page.evaluate("mapMaker.setPreview('tide', 4)")
            if shots:
                page.screenshot(path=os.path.join(shots, "map-maker-1-tide.png"))
            page.keyboard.press("p")

            # The Looks page draws every look with the game's own recolouring
            looks = browser.new_page(viewport={"width": 1400, "height": 860})
            looks.on("pageerror", lambda e: errors.append("looks: %s" % e))
            looks.goto(base + "tools/map-maker/looks.html")
            looks.wait_for_function("window.looks", timeout=10000)
            assert looks.locator("#skins figure").count() == 8, "a figure per skin tone"
            if shots:
                looks.screenshot(path=os.path.join(shots, "map-maker-looks.png"))
            looks.close()

            # An interior for the village: right-click picks the door square, then the dialog
            page.locator(".maps li", has_text="village").click()
            page.mouse.click(view["x"] + view["width"] / 2, view["y"] + view["height"] / 2, button="right")
            page.click("text=Add an interior…")
            page.locator("#dialog input").nth(0).fill("shop")
            page.locator("#dialog button[value=ok]").click()
            page.wait_for_function("mapMaker.current === 'village_inside'")
            if shots:
                page.screenshot(path=os.path.join(shots, "map-maker-2-room.png"))

            page.click("#save")
            page.wait_for_function("document.getElementById('status').textContent.indexOf('Saved') === 0", timeout=10000)
            assert page.locator("#status").inner_text() == "Saved.", page.locator("#problems").inner_text()
            inside = json.load(open(os.path.join(root, "maps-src", "village_inside.tmj")))
            objs = {o["name"]: o for o in [l for l in inside["layers"] if l["name"] == "objects"][0]["objects"]}
            assert set(objs) == {"shop", "shop_in", "shop_exit"}, objs
            farm = json.load(open(os.path.join(root, "maps-src", "farm.tmj")))
            layers = {l["name"]: l for l in farm["layers"]}
            assert 0x80000000 + idx + 1 in layers["decor"]["data"], "the flipped rock was saved"
            puddles = layers["puddles"]
            assert {p["name"]: p["value"] for p in puddles["properties"]} == {"when": "rain", "target": "ground"}, puddles["properties"]
            assert sand + 1 in puddles["data"], "the puddle was painted on its layer"
            village = json.load(open(os.path.join(root, "maps-src", "village.tmj")))
            assert any(l["name"] == "tide" for l in village["layers"]), "the tide was saved"
            check = subprocess.run([sys.executable, os.path.join(root, "tools", "map_maker.py"), "--check"],
                                   stdout=subprocess.PIPE, universal_newlines=True)
            assert check.returncode == 0, check.stdout

            # Play the room, and walk out of its door
            game = browser.new_page(viewport={"width": 1280, "height": 720})
            game.on("pageerror", lambda e: errors.append("game: %s" % e))
            sp = objs["shop_in"]
            game.goto(base + "index.html?at=village_inside,%d,%d" % (sp["x"] // 16, sp["y"] // 16))
            game.wait_for_function("window.FarmSim && FarmSim.currentArea && FarmSim.currentArea.key === 'village_inside'", timeout=20000)
            game.wait_for_timeout(1000)
            room = game.evaluate("FarmSim.game.scene.getScene('World').room.name")
            assert room == "shop", room
            if shots:
                game.screenshot(path=os.path.join(shots, "map-maker-3-play.png"))
            game.locator("canvas").click()
            game.keyboard.down("ArrowDown")
            game.wait_for_timeout(900)
            game.keyboard.up("ArrowDown")
            game.wait_for_function("FarmSim.currentArea.key === 'village'", timeout=5000)

            # The village with its tide, at high water, with both renderers
            for mode in ("", "&canvas"):
                game.goto(base + "index.html?at=village,12,20" + mode)
                game.wait_for_function("window.FarmSim && FarmSim.currentArea && FarmSim.currentArea.key === 'village'", timeout=20000)
                game.evaluate("FarmSim.Session.state.time = 12 * 60 + 40")
                game.wait_for_timeout(1500)
                tide = game.evaluate("[FarmSim.game.scene.getScene('World').conditions.tide, FarmSim.game.scene.getScene('World').foam.length]")
                assert tide[0] == 4 and tide[1] > 0, tide
                if shots:
                    game.screenshot(path=os.path.join(shots, "map-maker-4-tide%s.png" % ("-canvas" if mode else "")))
            browser.close()
    finally:
        server.terminate()
        time.sleep(0.3)
        shutil.rmtree(work, ignore_errors=True)
    if errors:
        sys.exit("Errors:\n" + "\n".join(errors))
    print("The map maker works: painted, added an interior, saved, played it.")


if __name__ == "__main__":
    main()
