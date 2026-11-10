# Plenty Heaps

A 16-bit-style farming game set in a coastal West African village, built with **Phaser 3** and
[EduGame Kit](https://github.com/togetherings/edugame-kit). It's a **Saved Game**: each learner's
farm is saved, with no scores. One zip works in Kolibri (through Kolibri Studio), Moodle and other
SCORM 1.2 learning systems, RACHEL and Kiwix.

See **DESIGN.md** for the game's design decisions.

## What's in the game so far

- **Character creation:** body, skin tone, hairstyle and hair colour.
- **Three areas:** your round house, the farm, and the village with its beach.
- **Farming:** the hoe makes heaps, then you plant, water and harvest. Five crops.
- **Two seasons, rainy and dry:** rain waters the field, and crops wither out of season.
- **Day cycle:** a clock, nights, sleeping and passing out.
- **Money:** the shipping crate pays in **cowries** overnight, and Pa Sorie's stall sells seeds.
- **Villagers:** Aunty Kadi and Pa Sorie, with dialogue, gifts and friendship.
- **Ambient life:** wandering hens, chicks and crabs.
- **Controls:** keyboard and touch.

## Playing it while you work on it

- **With the kit (saves like the real thing):** install it once
  (`pip install git+https://github.com/togetherings/edugame-kit.git`), then run
  `edugame preview .` in this folder.
- **Without the kit:** serve the folder with VS Code's Live Server and open `index.html`. The
  game saves in the browser by itself (the kit's helper isn't there until a build).

Add these to the address:

| Add | Does |
|---|---|
| `?reset` | New game (character creation) |
| `?debug` | Collision boxes, plus where it saves and how big the save is |
| `?touch` | Touch controls even with a mouse |
| `?canvas` | The Canvas renderer, as on phones without WebGL |

`dev/scorm-test.html` is a pretend learning system that shows the SCORM data live.

| Action | Keyboard | Touch |
|---|---|---|
| Move | Arrows / WASD | Arrow pad |
| Use tool, talk, harvest, ship, sleep | Space / Z / Enter | ✔ button |
| Close, back | X / Esc | ↩ button |
| Pick item | 1–9, 0, Q / E | Tap the slot |

## Tests and builds

`node tests/run-tests.js` checks the save format (including that old saves still load), the
worst-case save size, farming, seasons, money, appearance, map links and saving through the kit.

On GitHub, every push and pull request runs the **Build** workflow, which must pass ("Checks
passed") before anything reaches `main`. It runs:
1. the game's tests,
2. `edugame check`,
3. `edugame build`.

The zips are in the run's **Artifacts** (Actions tab > the run > game-zips). For a release, draft
one in **Releases** with a tag that matches `version` in `edugame.json` (like `v0.1.0`); the zips
are attached to it.

To build on your own computer: `edugame build . -o dist`.

## How saving works

The kit's save helper (`edugame.js`, added by the build) finds out where the game is running and
saves there: SCORM `cmi.suspend_data` in Kolibri and learning systems, the Kolibri Games games
page, or the browser. The game hands it one compact text string (about 100–500 characters; the
limit is 3,900). **The game never talks to SCORM itself when the helper is there**, or the two
would overwrite each other. See `src/core/storage.js` and DESIGN.md.

When the first crop is shipped, the game tells the platform the activity is done ("passed", the
status Kolibri counts).

## Project layout

```
index.html              loads every script in order (add new files here)
edugame.json            the kit's settings: id, version, languages, what's left out of the zip
lang/en.json            the game's title and description for every platform
DESIGN.md               design decisions - read first
icon.svg                the game's icon
lib/phaser.min.js       Phaser 3.90.0
assets/                 the game's images (built by tools/build_assets.py)
maps-src/               Tiled maps (.tmj) - edit these in Tiled; tileset.json is generated
src/
  namespace.js, config.js     the FarmSim object; tuning values
  core/                 no Phaser: game rules, saving, the palette swap (tested in Node)
  data/                 items, crops, villagers, flags, areas, words, money, looks;
                        tiles.js and maps/ are generated
  scenes/               Boot, Create (character), World (any area), UI; art helpers
  main.js               waits for the kit's helper, starts Phaser, saves when the page closes
tests/run-tests.js      automated checks
dev/scorm-test.html     pretend learning system
tools/
  build_assets.py       art-src/ -> assets/ (needs Python 3 + Pillow and the art packs)
  build-maps.js         maps-src/*.tmj -> src/data/maps/*.js
  generate_starter_maps.py   made the first maps (don't re-run once maps are edited)
```

Only `index.html`, `src/`, `assets/`, `lib/`, `icon.svg` and `LICENSE` go into the game's zip (see
`exclude` in `edugame.json`).

## Art

The art comes from **Petixel** packs bought on itch.io: Farmlands, Atolls, Savanah, Desert, Base
Characters, Hair and Main UI. We may edit them freely, but they **must not be used to train
image-generation AI**, and they can't be shared as packs.

- **The original packs are not in this repository**, which is public. Keep them on your own
  computer in `art-src/petixel/`. `.gitignore` keeps that folder out of git.
- `assets/` holds only the images the game uses, built from the packs by
  `tools/build_assets.py`. Run it, then `node tools/build-maps.js`, after changing art.
- Add new tiles at the end of the list in `build_assets.py` so existing maps keep working.

Characters are made by a palette swap: one body sheet and one hair sheet give every skin tone,
hair colour and outfit (`src/data/appearance.js`, `src/core/charRecolor.js`).

## How to add things

- **An area:** make a map in Tiled from an existing `.tmj` (layers `ground`, `decor`, `above`,
  `objects`), run `node tools/build-maps.js`, add its `<script>` to `index.html` and an entry in
  `src/data/areas.js`. The object types are listed at the top of `areas.js`.
- **A crop:** its pictures in `build_assets.py` (`CROPS`), an entry in `src/data/crops.js`, seed
  and produce in `src/data/items.js`, names in `src/data/strings.js`.
- **A villager:** an entry with a `look` in `src/data/npcs.js`, lines in `strings.js`, and an `npc`
  object in a map.
- **A currency** (Kissi pennies): see the top of `src/data/currencies.js`.

## Save rules

- Saves store **IDs, never names**. Never change or reuse an `id` after release, and never change
  `id` in `edugame.json`: learners' saves are kept under it.
- Adding items, crops, villagers, flags, areas, currencies or outfits needs no change to the save
  format; old saves upgrade when they load.
- A new kind of saved data means a new format version in `src/core/saveCodec.js`, and old versions
  must keep loading.

## Licence

The code is MIT (see `LICENSE`). The art is not: see "Art" above.
