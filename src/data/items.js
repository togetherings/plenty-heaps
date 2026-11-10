/**
 * items.js
 * ========
 * Every item that can be in the inventory.
 *
 *   id         permanent save ID, 1-255 (0 means "empty slot").
 *   kind       'tool' | 'seed' | 'produce'  - decides what the action button
 *              does when the item is held.
 *   icon       position in assets/items.png.
 *   buy        price at the seed stall (0 = not sold there).
 *   sell       price in the shipping bin (0 = can't be shipped).
 *   currency   (optional) which money the prices are in; default 'cowrie'.
 *              See currencies.js.
 *   crop       (seeds only) which crop it plants.
 *   tool       (tools only) which action it performs.
 *
 * Display names live in strings.js under "item_<key>" so they can be
 * translated.
 *
 * ID ranges (a convention, to keep things tidy as the game grows):
 *   1-19 tools, 20-59 seeds, 60-119 produce, 120+ future (fish, minerals...)
 */
(function (FS) {
  'use strict';

  FS.Items = FS.makeRegistry('Items', [
    // Tools
    { id: 1,  key: 'hoe',             kind: 'tool',    tool: 'hoe', icon: 0,  buy: 0,  sell: 0 },
    { id: 2,  key: 'can',             kind: 'tool',    tool: 'can', icon: 1,  buy: 0,  sell: 0 },

    // Seeds (bought at Pa Sorie's stall)
    { id: 20, key: 'seed_maize',      kind: 'seed', crop: 'maize',      icon: 2, buy: 15, sell: 0 },
    { id: 21, key: 'seed_groundnut',  kind: 'seed', crop: 'groundnut',  icon: 3, buy: 25, sell: 0 },
    { id: 22, key: 'seed_krainkrain', kind: 'seed', crop: 'krainkrain', icon: 4, buy: 10, sell: 0 },
    { id: 23, key: 'seed_pepper',     kind: 'seed', crop: 'pepper',     icon: 5, buy: 20, sell: 0 },
    { id: 24, key: 'seed_cassava',    kind: 'seed', crop: 'cassava',    icon: 6, buy: 40, sell: 0 },

    // Produce (harvested, shipped or given as gifts)
    { id: 60, key: 'maize',           kind: 'produce', icon: 7,  buy: 0, sell: 40 },
    { id: 61, key: 'groundnut',       kind: 'produce', icon: 8,  buy: 0, sell: 30 },
    { id: 62, key: 'krainkrain',      kind: 'produce', icon: 9,  buy: 0, sell: 18 },
    { id: 63, key: 'pepper',          kind: 'produce', icon: 10, buy: 0, sell: 22 },
    { id: 64, key: 'cassava',         kind: 'produce', icon: 11, buy: 0, sell: 60 }
  ], 255);
})(FarmSim);
