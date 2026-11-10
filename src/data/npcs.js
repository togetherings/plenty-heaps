/**
 * npcs.js
 * =======
 * Villagers. Their POSITIONS come from the map (an object of type "npc" with
 * a property  npc = "<key>"). Everything else about them lives here.
 *
 *   id        permanent save ID (0-63). Friendship is saved per id.
 *   look      how they look (keys from appearance.js) - built like the player.
 *   likes     produce keys they love as gifts (bigger friendship boost).
 *   lines     dialogue string keys, picked by friendship level:
 *               stranger (0-199), friend (200-499), close (500+)
 *             plus optional per-season lines. One line is chosen per day.
 *   shop      if set, talking to them opens that shop after the greeting.
 *
 * Friendship is 0-1000 (10 bits in the save).
 */
(function (FS) {
  'use strict';

  FS.Friendship = {
    MAX: 1000,
    TALK: 10,          // first chat of the day
    GIFT: 15,          // gift they're neutral about
    GIFT_LIKED: 40,    // gift they love
    tier: function (value) { return value >= 500 ? 'close' : value >= 200 ? 'friend' : 'stranger'; }
  };

  FS.Npcs = FS.makeRegistry('Npcs', [
    {
      id: 0, key: 'kadi',
      look: { body: 'f', skin: 's1', hair: 'bun', hairColor: 'black', outfit: 'lappa_purple' },
      likes: ['pepper', 'krainkrain'],
      lines: {
        stranger: ['kadi_s1', 'kadi_s2'],
        friend: ['kadi_f1', 'kadi_f2'],
        close: ['kadi_c1'],
        rainy: ['kadi_rainy'],
        dry: ['kadi_dry']
      },
      metFlag: 'metKadi'
    },
    {
      id: 1, key: 'sorie',
      look: { body: 'm', skin: 's2', hair: 'elder', hairColor: 'grey', outfit: 'kaftan_blue' },
      likes: ['groundnut', 'maize'],
      lines: {
        stranger: ['sorie_s1'],
        friend: ['sorie_f1'],
        close: ['sorie_c1']
      },
      shop: 'seeds',
      metFlag: 'metSorie'
    }
  ], 63);
})(FarmSim);
