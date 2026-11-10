# Plenty Heap — Design Document

The record of what has been decided, and what is still open. Read this at the
start of any work session; update it whenever a decision changes.

*Last updated: 9 November 2026 (moved to GitHub: togetherings/plenty-heaps)*

---

## 1. The game in one paragraph

**Plenty Heap** is a 16-bit-style farming and life game, in the spirit of
Harvest Moon, set in a coastal West African village. The player farms, sells
their harvest, and gets to know the villagers; later they will also fish,
tend trees and animals, and explore. It is built for learners using
**Kolibri** (offline learning platform) and any LMS that accepts HTML5 or
**SCORM 1.2** packages.

**The name** comes from *heaps*, the raised mounds of tilled earth that crops
are planted in (as taught in "Agric" at school), and from *plenty*. In the
game, the hoe turns ground into heaps.

## 2. Setting and culture

- **Inspired by coastal Sierra Leone**, without naming it. It should also
  feel familiar to learners in **Guinea** and **Liberia**.
- **Two seasons:** rainy (planting time, around May–October) and dry
  (watering, around November–April). The game starts at the beginning of the
  rainy season. A harmattan stretch of the dry season may come later.
- **Village:** round mud-walled houses with patterned walls and thatched
  roofs, a red laterite earth square, a market stall, palms, and the sea.
- **Language:** English text with light Krio ("Kushe", "Tenki", "How di
  bodi?"). **All Krio must be checked by a native speaker.** French is planned
  for Guinea. Local languages (Krio, Temne, Mende, Susu...) need a pixel font
  with letters like ɛ, ɔ and ŋ.
- **Cultural review:** names, dialogue, clothing, food and buildings should be
  reviewed by people from the region before release.
- **Sensitive topics:**
  - **Mining:** artisanal gold mining is tied to child labour and mercury, so
    use clay, laterite, salt or fantasy caves instead.
  - **Wildlife:** endangered animals (pygmy hippo, chimpanzees, sea turtles,
    manatees) are to be observed or protected, never hunted. No bushmeat
    hunting mechanic.
  - **Pigs:** left out, given the mixed Muslim and Christian population.

## 3. Platforms and technical decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | **Phaser 3.90.0** (final v3, pinned) | Mature, first-class Canvas fallback for old phones |
| Code style | Plain `<script>` files, one global `FarmSim`, **ES2015 only** | No build step; runs on old Android WebViews |
| Screen | 640×360 canvas; world camera zoomed 2× (320×180 world) | Pixel-art look with readable text |
| Tiles | 16×16 | Matches the art packs and Tiled |
| Characters | **16×32** (3 frames × 4 directions) | From the Petixel art packs |
| Maps | Tiled `.tmj` files → converted to scripts | Editable in Tiled; no network loading |
| Kit | **EduGame Kit**, as a **Saved Game** (no scores) | Same zip for Kolibri, SCORM LMSs, RACHEL, Kiwix; GitHub builds it |
| Saving | Through the kit's helper (`edugame.js`): SCORM `suspend_data`, Kolibri Games, or the browser | The helper picks the platform; the game never touches SCORM itself |
| Package | `edugame build`: one zip for every platform | Built and checked by GitHub Actions |
| Kit header / Options | **Off** (`"header": false`) | Settings will live in an in-game menu (see Open decisions) |

**Target devices:** Dell Chromebook 3100 (ChromeOS or Xubuntu), older and
budget Android phones (e.g. Tecno), through Kolibri's app or browser. The
game has been checked with both the WebGL and the Canvas renderer.

## 4. Saving

- **Format:** bit-packed, base64url, 16-bit checksum. Currently **version 2**.
- **Size:** worst case **502 of 4096 characters (12%)**; a new game is about
  90. Even 64 villagers, 255 flags, 31 slots, 15 currencies and 255 outfits
  fit in about 800.
- **Golden rule:** saves store **IDs, never names**. Never change or reuse an
  `id` in items, crops, villagers, flags, areas, currencies or appearance
  options after release.
- **Not saved:** anything that can be recalculated (weather, critters,
  map contents).
- **When:** after sleeping, on changing area, every 2 game hours, and when
  the page is hidden or closed.
- **Old saves always load:** version 1 saves (from the first slice) are
  upgraded automatically, and a test proves it.
- The kit keeps the game's save string inside its own record:
  `{"_v": 1, "_save": "<the string>"}`. It allows 3,900 characters for it.
- **Completion:** when the `firstShipment` flag is set, the game calls
  `EduGame.complete()`, which sets SCORM status `passed` (Kolibri ignores
  `completed`). This is a placeholder until learning goals are agreed.
- The kit doesn't set SCORM `cmi.core.exit` to `suspend` (Kolibri doesn't
  need it; some other learning systems start a fresh attempt without it).
  To raise with the kit.

## 5. Gameplay (current)

- **Day:** 06:00 to 24:00, about 12.5 real minutes. Passing out at midnight
  costs half your energy the next morning.
- **Season length:** 28 days. **Under review:** probably too long for class
  sessions (one season is about 6 hours of play), so 14 days is being considered.
- **Farming:** the hoe makes heaps, then you plant seeds and water them; rain
  waters everything. A watered day is one day of growth. When the season
  changes, out-of-season crops wither.
- **Crops so far:**

  | Crop | Season | Days | Regrows |
  |---|---|---|---|
  | Maize | Rainy | 5 | No |
  | Groundnut | Rainy | 7 | No |
  | Krain krain | Both | 3 | Every 2 days |
  | Pepper | Dry | 6 | Every 3 days |
  | Cassava | Both | 12 | No |

- **Selling:** the shipping crate pays out overnight.
- **Shop:** Pa Sorie's seed stall in the village.
- **Villagers:** Aunty Kadi and Pa Sorie. Talking raises friendship once a
  day; holding a crop and talking gives it as a gift.

### Planned crops, trees and animals
- **More crops:** upland and swamp rice (the staple, central to the rainy
  season), okra, sweet potato (leaves too), garden eggs, onions, tomatoes,
  yams, cocoyam, benniseed.
- **Trees** (long-term investments): oil palm (palm oil processing), mango,
  coconut, cashew, cocoa and coffee (need shade), kola nut (a gift item),
  citrus, banana and plantain, mangroves (oysters, conservation).
- **Animals:** chickens, guinea fowl, ducks, West African dwarf goats and
  sheep, N'Dama cattle (late game), bees, grasscutter, snails.
- **Fishing:** sea (bonga, snapper...), mangrove creeks (crab, oysters),
  rivers. Fish smoking as processing.

## 6. Money

- **Cowrie** shells are the everyday currency, shown with a cowrie icon.
- The system supports more currencies: **Kissi pennies** are the planned
  second. See `src/data/currencies.js`.
- The player starts with 200 cowries.

## 7. Characters

- **Creation screen** at the start of a new game:
  - **Body:** Boy / Girl. This sets the starting outfit.
  - **Skin:** 8 tones, shown as **swatches with no names**, defaulting to a
    deep tone.
  - **Hair:** 13 styles plus shaved, chosen with arrows.
  - **Hair colour:** 5 swatches.
- **How it works:** a palette swap. One body sheet and one hair sheet make
  every combination; clothing is made by recolouring the body below the neck.
  The two darkest tones get a darker outline so faces stay readable.
- **Clothing:** each body starts in its own farm clothes. **More outfits are
  to be bought in game later**; owned outfits are already tracked in the save.
- **Villagers** are built the same way, from a "look" in `npcs.js`.

## 8. Art

- **Source:** Petixel packs bought on itch.io (Farmlands, Atolls, Savanah,
  Desert, Base Characters, Hair, Main UI). The originals are kept **off
  GitHub** (the repository is public), in `art-src/petixel/` on the team's
  own computers; `.gitignore` keeps them out.
- **Licence:** we may edit the art freely, but it **must not be used to train
  image-generation AI**. The repository's MIT licence covers the code only.
- **Pipeline:** `tools/build_assets.py` builds the game's tileset, icons,
  characters and UI from the packs. Some art is drawn in code using the
  pack's 24-colour palette: heaps, maize, the cowrie icon, the sleeping mat,
  floors and interior walls.
- **Ambient life:** wandering hens, chicks and crabs (decoration only).
- **Rules:** use the pack palette, hard pixel edges only, and export PNGs
  without colour profiles.

## 9. Learning (to be decided with educators)

- Tie into the Agric curriculum: seasons, soil, heaps and ridges, crop rotation.
- Numeracy through prices and profit; literacy through dialogue and requests.
- Decide what the LMS reports and what "completed" means.

## 10. Open decisions

- [ ] Season and day length for class pacing
- [ ] Learning goals and the LMS completion rule
- [ ] Pixel font, including local-language letters
- [ ] Krio review; French translation
- [ ] What replaces mining
- [ ] Music and sound (none yet; keep the package small)
- [ ] Whether to ask a player name (typing is hard on phones)
- [ ] Hairstyle names: current names are descriptive guesses; review with learners
- [ ] **In-game menu** (with the inventory) for language and other settings,
      instead of the kit's Options button; then move the game's words into
      `lang/en.json` so the kit can translate them
- [ ] Licence wording for the game (code MIT, art under the Petixel licence)
- [ ] Whether to turn on the public GitHub Pages site now or later

## 11. Roadmap

1. ✅ Vertical slice: farm, village, house; farming loop; saving; touch controls
2. ✅ Purchased art, character creation, Cowrie currency
3. ✅ Moved to GitHub with EduGame Kit (Saved Game)
4. ⏭ Test in Kolibri on a Dell 3100 and the cheapest target phone
5. In-game menu with inventory and settings (volume, language, text speed, new game)
6. Audio
7. Full inventory and storage chest
8. Trees, then villager schedules, then fishing, then animals
9. Clothing shop, villager requests and quests
10. Content: more maps, villagers and crops
11. Learning integration, translation, classroom playtests, release

## 12. Where things are

See `README.md` for the project layout, how to add areas, crops, villagers
and translations, and how to build and test.
