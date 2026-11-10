"""
Uses the map maker in a browser, on a copy of the game (your maps are never changed):
paints a tile, adds an interior to the village with the dialog, saves, then plays the new
room and walks out of its door back to the village.

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

            # Paint a rock on the decoration layer
            page.click("text=Decoration")
            idx, cols = page.evaluate("[mapMaker.project.tiles.names.rock, mapMaker.project.tiles.columns]")
            box = page.locator("#palette").bounding_box()
            page.mouse.click(box["x"] + (idx % cols) * 32 + 16, box["y"] + (idx // cols) * 32 + 16)
            view = page.locator("#view").bounding_box()
            page.mouse.click(view["x"] + view["width"] / 2 + 64, view["y"] + view["height"] / 2)
            assert page.locator("#status").inner_text() == "Not saved yet"
            if shots:
                page.screenshot(path=os.path.join(shots, "map-maker-1.png"))

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
            rock = idx + 1
            assert rock in [l for l in farm["layers"] if l["name"] == "decor"][0]["data"], "the rock was saved"
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
