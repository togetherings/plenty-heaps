"""
Play steps for EduGame Kit's real-Kolibri test (the "Real Kolibri" job in
.github/workflows/build.yml; on your own computer: edugame kolibri-test .).

The kit sets up a throwaway Kolibri, adds the game to a channel and opens it in Learn as a
learner. It checks the save reaches Kolibri, fits SCORM 1.2 and comes back next time; these
steps play the game so there's something to save:

  1. first visit: make a character, walk out to the farm, ship two maize (the first
     shipment completes the activity) and play on for a few seconds, so the game saves;
  2. second visit: the game carries on in the same place, with the same character and the
     cowries owed for the shipment.

Not part of the game (edugame.json's exclude has tests/*).
"""


WORLD = "FarmSim.game.scene.getScene('World')"


def first_visit(game):
    game.check(game.wait_for("FarmSim.Session.storage && FarmSim.Session.storage.kind === 'edugame:scorm'"),
               "the game saves through the kit's helper in Kolibri")
    game.check(game.wait_for("FarmSim.game.scene.isActive('Create')"), "a new learner starts on character creation")

    # Make a character with the keyboard, as a learner would (click the game first to give it the keys)
    game.click("canvas")
    game.press("ArrowRight", "ArrowDown", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowRight",
               "ArrowDown", "ArrowDown", "Space")
    game.check(game.wait_for("FarmSim.game.scene.isActive('World')"), "character made; the game world started")
    game.page.wait_for_timeout(1000)
    game.press("Space", "Space", "Space")      # the welcome messages
    look = game.js("JSON.stringify(FarmSim.Session.state.look)")
    game.check('"body":"f"' in look, "the character choices were kept: %s" % look)
    game.shot("house")

    # Walk out of the door to the farm
    game.js("(function(){var w=%s; w.player.setPosition(9*16+8, 9*16-4); w.facing='down';})()" % WORLD)
    game.hold("ArrowDown", 700)
    game.check(game.wait_for("FarmSim.currentArea.key === 'farm'"), "walked out to the farm")

    # Ship two maize at the shipping crate (handed over here: growing them takes days)
    game.js("FarmSim.State.addItem(FarmSim.Session.state, 'maize', 2)")
    game.page.wait_for_timeout(300)
    slot = game.js("FarmSim.Session.state.inventory.findIndex(function(s){return s && FarmSim.Items.byId(s.id).key === 'maize';})")
    game.press(str(slot + 1))
    game.js("(function(){var w=%s; w.player.setPosition(9*16+8, 8*16-4); w.facing='up';})()" % WORLD)
    game.page.wait_for_timeout(300)
    game.press("Space")
    shipped = game.js("FarmSim.Session.state.shipped")
    game.check(shipped == 80, "shipped 2 maize for 80 cowries tomorrow (%s)" % shipped)
    game.shot("shipped")
    game.expect_complete = True                # the first shipment completes the activity

    # Keep playing for a moment: the game saves every few seconds. (Kolibri doesn't keep a
    # save made as the learner leaves, so the game mustn't rely on one.)
    game.page.wait_for_timeout(6000)
    game.data["before"] = game.js("JSON.stringify({pos: FarmSim.Session.state.pos, look: FarmSim.Session.state.look})")


def came_back(game):
    game.check(game.wait_for("FarmSim.game && FarmSim.game.scene.isActive('World')"), "the game world started")
    game.page.wait_for_timeout(1000)
    game.check(not game.js("FarmSim.game.scene.isActive('Create')"), "coming back skips character creation")
    after = game.js("JSON.stringify({pos: FarmSim.Session.state.pos, look: FarmSim.Session.state.look})")
    game.check(after == game.data["before"], "carried on in the same place with the same character:\n       %s\n       %s"
               % (game.data["before"], after))
    game.check(game.js("FarmSim.Session.state.shipped") == 80, "the cowries owed for the shipment were kept")
