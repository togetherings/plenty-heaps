/**
 * appearance.js
 * =============
 * Everything that decides how a character LOOKS: body, skin tone, hairstyle,
 * hair colour and outfit. The player picks these at the start; villagers have
 * theirs set in npcs.js.
 *
 * HOW THE RECOLOURING WORKS (a "palette swap")
 *   The Petixel body sheets draw skin with exactly three colours - shadow,
 *   base and highlight (SKIN_KEYS below). The game copies the sheet and swaps
 *   those three colours for the chosen tone. Clothing is made the same way:
 *   skin pixels below the neck are swapped for cloth colours instead.
 *   Hair sheets use five colours (HAIR_KEYS), swapped for the hair colour.
 *   So ONE body sheet and ONE hair sheet give every combination. See
 *   src/scenes/CharacterArt.js for the code.
 *
 * Each list is a registry (see registry.js): `id` is saved and must never
 * change or be reused. Colours are [shadow, base, highlight] as [r, g, b].
 * Names come from strings.js ("skin" has no names on purpose: the creation
 * screen shows colour swatches only).
 */
(function (FS) {
  'use strict';

  // Colours used in the Petixel art that get replaced.
  const SKIN_KEYS = [[131, 86, 145], [161, 93, 77], [230, 162, 126]];
  const OUTLINE = [89, 59, 61];
  const HAIR_KEYS = [[35, 93, 106], [131, 86, 145], [139, 130, 211], [89, 59, 61], [69, 72, 78]];

  FS.Appearance = {
    SKIN_KEYS: SKIN_KEYS,
    OUTLINE: OUTLINE,
    HAIR_KEYS: HAIR_KEYS,

    // Body shapes (from the Petixel base characters). `texture` = image key.
    bodies: FS.makeRegistry('Bodies', [
      { id: 0, key: 'm', texture: 'body_m', defaultOutfit: 'farm_m' },
      { id: 1, key: 'f', texture: 'body_f', defaultOutfit: 'farm_f' }
    ], 3),

    // Skin tones, deepest to lightest. [shadow, base, highlight]. `outline`
    // (optional) replaces the dark outline/eye colour, so faces stay readable
    // on the deepest tones.
    skins: FS.makeRegistry('Skins', [
      { id: 0, key: 's0', colors: [[50, 34, 44], [80, 50, 46], [122, 78, 62]], outline: [26, 16, 20] },
      { id: 1, key: 's1', colors: [[66, 42, 52], [104, 64, 54], [156, 102, 78]], outline: [40, 26, 30] },
      { id: 2, key: 's2', colors: [[92, 56, 70], [132, 80, 62], [190, 126, 92]] },
      { id: 3, key: 's3', colors: [[118, 72, 86], [161, 93, 77], [230, 162, 126]] },
      { id: 4, key: 's4', colors: [[150, 92, 100], [196, 128, 96], [242, 190, 140]] },
      { id: 5, key: 's5', colors: [[161, 93, 77], [226, 160, 124], [252, 214, 150]] },
      { id: 6, key: 's6', colors: [[188, 124, 108], [240, 194, 158], [255, 232, 200]] },
      { id: 7, key: 's7', colors: [[204, 148, 130], [252, 216, 190], [255, 244, 228]] }
    ], 15),

    // Hairstyles. `col` = position in assets/chars/hair.png (48px per style),
    // or -1 for none. Order here is the order on the creation screen.
    hairs: FS.makeRegistry('Hairs', [
      { id: 0, key: 'none', col: -1 },
      { id: 1, key: 'curls', col: 0 },
      { id: 2, key: 'flattop', col: 1 },
      { id: 3, key: 'twists', col: 2 },
      { id: 4, key: 'spiky', col: 3 },
      { id: 5, key: 'puffs', col: 4 },
      { id: 6, key: 'toppuff', col: 5 },
      { id: 7, key: 'braid', col: 6 },
      { id: 8, key: 'cornrows', col: 7 },
      { id: 9, key: 'bun', col: 8 },
      { id: 10, key: 'ponytail', col: 9 },
      { id: 11, key: 'bob', col: 10 },
      { id: 12, key: 'mohawk', col: 11 },
      { id: 13, key: 'elder', col: 12 }
    ], 31),

    // Hair colours: 5 colours each, matching HAIR_KEYS.
    hairColors: FS.makeRegistry('HairColors', [
      { id: 0, key: 'black', swatch: [46, 38, 46], colors: [[46, 38, 46], [74, 60, 72], [108, 94, 110], [30, 22, 26], [56, 46, 52]] },
      { id: 1, key: 'brown', swatch: [161, 93, 77], colors: [[131, 86, 145], [161, 93, 77], [230, 162, 126], [89, 59, 61], [105, 69, 93]] },
      { id: 2, key: 'grey', swatch: [208, 184, 164], colors: [[137, 122, 111], [208, 184, 164], [248, 244, 222], [89, 59, 61], [107, 83, 80]] },
      { id: 3, key: 'auburn', swatch: [255, 157, 81], colors: [[178, 54, 78], [255, 157, 81], [255, 228, 132], [89, 59, 61], [122, 57, 67]] },
      { id: 4, key: 'violet', swatch: [131, 86, 145], colors: HAIR_KEYS }
    ], 15),

    /**
     * Outfits. top/bottom are [shadow, base, highlight]. onePiece = the top
     * colours cover the whole body (kaftan, kaba). pattern = a dotted
     * tie-dye (gara) pattern on the bottom, for lappa wraps.
     * `price` is for the future clothing shop (0 = not for sale).
     */
    outfits: FS.makeRegistry('Outfits', [
      { id: 0, key: 'farm_m', price: 0,
        top: [[32, 111, 169], [72, 165, 206], [178, 208, 255]], bottom: [[137, 122, 111], [208, 184, 164], [248, 244, 222]] },
      { id: 1, key: 'farm_f', price: 0, pattern: true,
        top: [[58, 104, 61], [61, 162, 130], [146, 214, 154]], bottom: [[178, 54, 78], [255, 157, 81], [255, 228, 132]] },
      { id: 2, key: 'kaftan_blue', price: 0, onePiece: true,
        top: [[32, 111, 169], [72, 165, 206], [178, 208, 255]] },
      { id: 3, key: 'lappa_purple', price: 0, pattern: true,
        top: [[178, 54, 78], [255, 157, 81], [255, 228, 132]], bottom: [[122, 65, 87], [131, 86, 145], [190, 130, 188]] }
    ], 255),

    /** The look a brand-new player starts with (changed on the creation screen). */
    defaultLook: function () {
      return { body: 'm', skin: 's1', hair: 'curls', hairColor: 'black', outfit: 'farm_m' };
    }
  };
})(FarmSim);
