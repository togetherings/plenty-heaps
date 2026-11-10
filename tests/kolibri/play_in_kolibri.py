"""
Plays the game inside a real, running Kolibri, as a learner in Learn (used in CI).

    python tests/kolibri/play_in_kolibri.py http://127.0.0.1:8080/ screenshots/

Needs tests/kolibri/channel.json from add_channel.py. Checks that:
  1. the game opens in Learn, and the save helper finds Kolibri's SCORM connection;
  2. the learner can make a character, walk to the farm and ship a crop;
  3. after leaving and opening the resource again, the game carries on where the learner
     was (same area, character and cowries owed): Kolibri kept the save.
check_saved.py then checks what Kolibri itself recorded.
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

FAILURES = []


def check(cond, what):
    print(("ok   " if cond else "FAIL ") + what, flush=True)
    if not cond:
        FAILURES.append(what)


def game_frame(page, timeout=90):
    """The frame running the game (Kolibri puts it inside its own frames)."""
    end = time.time() + timeout
    while time.time() < end:
        for f in page.frames:
            try:
                if f.evaluate("typeof FarmSim !== 'undefined' && !!FarmSim.game && !!FarmSim.Session.state"):
                    return f
            except Exception:
                pass  # a frame still loading, or one we can't read yet
        time.sleep(1)
    return None


def scenes(frame):
    return frame.evaluate("FarmSim.game.scene.getScenes(true).map(function (s) { return s.scene.key; })")


def wait_for(frame, js, timeout=30):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if frame.evaluate(js):
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def sign_in(page, base, username, password):
    page.goto(base + "en/auth/#/signin")
    page.locator("#username input").wait_for(timeout=60000)
    page.locator("#username input").fill(username)
    page.locator("button.login-btn, .login-btn button, .login-btn").first.click()
    page.locator("#password input").wait_for(timeout=30000)
    page.locator("#password input").fill(password)
    page.locator("#password input").press("Enter")
    page.wait_for_url(lambda url: "/auth/" not in url, timeout=60000)


def open_resource(page, base, node_id):
    page.goto(base + "en/learn/#/topics/c/" + node_id)
    return game_frame(page)


def press(page, *keys):
    for k in keys:
        page.keyboard.press(k)
        page.wait_for_timeout(150)


def main(base, shots):
    info = json.load(open(os.path.join("tests", "kolibri", "channel.json")))
    os.makedirs(shots, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and "FarmSim" in m.text and errors.append(m.text))

        sign_in(page, base, info["learner"], info["password"])
        check(True, "signed in as the learner")

        # ---- 1. First visit
        frame = open_resource(page, base, info["node_id"])
        page.screenshot(path=os.path.join(shots, "1-opened.png"))
        check(frame is not None, "the game opened in Learn")
        if frame is None:
            return finish(browser, errors)
        wait_for(frame, "FarmSim.Session.storage && FarmSim.Session.storage.kind.indexOf('edugame') === 0")
        kind = frame.evaluate("FarmSim.Session.storage.kind")
        check(kind == "edugame:scorm", "the save helper uses Kolibri's SCORM connection (%s)" % kind)
        check(wait_for(frame, "FarmSim.game.scene.isActive('Create')"), "a new learner starts on character creation")

        # Make a character: keyboard, as a learner would (click the game first to give it the keys)
        frame.locator("canvas").click()
        press(page, "ArrowRight", "ArrowDown", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowRight",
              "ArrowDown", "ArrowDown", "Space")
        check(wait_for(frame, "FarmSim.game.scene.isActive('World')"), "character made; the game world started")
        page.wait_for_timeout(1000)
        press(page, "Space", "Space", "Space")      # the welcome messages
        look = frame.evaluate("JSON.stringify(FarmSim.Session.state.look)")
        check('"body":"f"' in look, "the character choices were kept: %s" % look)
        page.screenshot(path=os.path.join(shots, "2-house.png"))

        # Walk out of the door to the farm
        frame.evaluate("(function(){var w=FarmSim.game.scene.getScene('World'); w.player.setPosition(9*16+8, 9*16-4); w.facing='down';})()")
        page.keyboard.down("ArrowDown"); page.wait_for_timeout(700); page.keyboard.up("ArrowDown")
        check(wait_for(frame, "FarmSim.currentArea.key === 'farm'"), "walked out to the farm")

        # Ship two maize at the shipping crate (they're handed over here; growing them takes days)
        frame.evaluate("FarmSim.State.addItem(FarmSim.Session.state, 'maize', 2)")
        page.wait_for_timeout(300)
        slot = frame.evaluate("FarmSim.Session.state.inventory.findIndex(function(s){return s && FarmSim.Items.byId(s.id).key === 'maize';})")
        press(page, str(slot + 1))
        frame.evaluate("(function(){var w=FarmSim.game.scene.getScene('World'); w.player.setPosition(9*16+8, 8*16-4); w.facing='up';})()")
        page.wait_for_timeout(300)
        press(page, "Space")
        shipped = frame.evaluate("FarmSim.Session.state.shipped")
        check(shipped == 80, "shipped 2 maize for 80 cowries tomorrow (%s)" % shipped)
        frame.evaluate("FarmSim.Session.save()")
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(shots, "3-shipped.png"))
        before = frame.evaluate("JSON.stringify({pos: FarmSim.Session.state.pos, look: FarmSim.Session.state.look})")

        # ---- 2. Leave, then come back
        page.goto(base + "en/learn/#/home")
        page.wait_for_timeout(5000)    # Kolibri sends the last progress to the server
        frame = open_resource(page, base, info["node_id"])
        check(frame is not None, "the game opened again")
        if frame is None:
            return finish(browser, errors)
        wait_for(frame, "FarmSim.game.scene.isActive('World')")
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(shots, "4-came-back.png"))
        check(not frame.evaluate("FarmSim.game.scene.isActive('Create')"), "coming back skips character creation")
        after = frame.evaluate("JSON.stringify({pos: FarmSim.Session.state.pos, look: FarmSim.Session.state.look})")
        check(after == before, "carried on in the same place with the same character:\n       %s\n       %s" % (before, after))
        check(frame.evaluate("FarmSim.Session.state.shipped") == 80, "the cowries owed for the shipment were kept")
        return finish(browser, errors)


def finish(browser, errors):
    browser.close()
    check(not errors, "no errors from the game: %s" % errors)
    print()
    if FAILURES:
        print("%d check(s) failed" % len(FAILURES))
        sys.exit(1)
    print("PLAYED IN KOLIBRI OK")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "screenshots")
