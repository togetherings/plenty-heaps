/**
 * config.js
 * =========
 * Game-wide settings in one place. Most balancing and tuning happens here or
 * in the data/ files, not in the scene code.
 */
(function (FS) {
  'use strict';

  FS.Config = {
    // ---- Identity -----------------------------------------------------------
    TITLE: 'Plenty Heaps',
    // Used as the localStorage key prefix, so two different games on the same
    // device never overwrite each other's saves. DON'T change this after
    // release, or browser-stored saves would be lost.
    STORAGE_KEY: 'plentyheaps.save',

    // ---- Screen -------------------------------------------------------------
    // The canvas is 640x360 and the WORLD camera is zoomed 2x, so the map is
    // shown at 320x180 "pixel art" resolution while UI text gets twice the
    // pixels and stays readable. The browser then scales the canvas to fit.
    GAME_WIDTH: 640,
    GAME_HEIGHT: 360,
    WORLD_ZOOM: 2,
    TILE: 16,                          // tile size in pixels (must match Tiled)

    // Characters are 16x32. Only the feet collide: a box this size, this far
    // from the top of the frame. The feet's centre is FEET_Y px below the
    // sprite's centre, used to stand characters on a tile.
    FEET_BOX: { w: 10, h: 6, x: 3, y: 25 },
    FEET_Y: 12,

    // ---- Player -------------------------------------------------------------
    PLAYER_SPEED: 72,                  // pixels per second (in world pixels)
    MAX_ENERGY: 100,
    ENERGY_COST: { hoe: 2, can: 1 },   // energy used per tool swing
    PASS_OUT_ENERGY: 50,               // energy after collapsing at midnight

    // ---- Time ---------------------------------------------------------------
    // One game minute passes every MS_PER_GAME_MINUTE real milliseconds.
    // 700ms -> a full day (06:00 to 24:00) takes about 12.5 real minutes.
    MS_PER_GAME_MINUTE: 700,
    DAY_START_MIN: 6 * 60,             // 06:00
    DAY_END_MIN: 24 * 60,              // 24:00 -> player passes out
    NIGHT_START_MIN: 18 * 60,          // screen starts to darken
    // Save every few real seconds while playing (when something changed). In
    // Kolibri, only what reached it before the learner leaves the resource is
    // kept: a save made as the page closes arrives too late there.
    SAVE_EVERY_MS: 5000,

    // ---- Calendar -----------------------------------------------------------
    // Two seasons. The game starts at the beginning of the rainy season, which
    // matches the real planting time (around May).
    SEASON_DAYS: 28,
    SEASONS: ['rainy', 'dry'],         // index 0 and 1 - order matters for saves
    RAIN_CHANCE: { rainy: 0.65, dry: 0.05 },

    // ---- Inventory ----------------------------------------------------------
    INVENTORY_SLOTS: 10,               // also the hotbar size in this slice
    MAX_STACK: 99,

    // ---- New game -----------------------------------------------------------
    START_WALLET: { cowrie: 200 },     // starting money per currency
    START_ITEMS: [                     // [itemKey, quantity]
      ['hoe', 1], ['can', 1], ['seed_maize', 8], ['seed_krainkrain', 6]
    ],

    // ---- SCORM / LMS ----------------------------------------------------------
    SCORM_MAX_CHARS: 4096,             // SCORM 1.2 cmi.suspend_data limit
    // When this story flag becomes true the LMS is told the activity is
    // "completed". Change to whatever counts as completion for your course.
    COMPLETION_FLAG: 'firstShipment',

    // ---- Developer options (also settable from the URL, see main.js) ---------
    DEBUG_PHYSICS: false
  };
})(FarmSim);
