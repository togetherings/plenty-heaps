/**
 * day.js
 * ======
 * What happens overnight when the player sleeps (or passes out at midnight).
 * This is the heart of the farming loop:
 *
 *   1. Pay out what was put in the shipping bin.
 *   2. Watered crops grow one day; all soil dries out.
 *   3. Move to the next day. If the season changed, out-of-season crops wither.
 *   4. If it rains on the new day, all tilled soil is watered.
 *   5. Villagers' "talked today" / "gift today" flags reset.
 *   6. The player wakes at home with energy restored.
 *
 * Returns a summary the UI can show ("You earned 120 cowries...").
 */
(function (FS) {
  'use strict';

  const C = FS.Config;

  FS.Day = {
    endDay: function (state, options) {
      const passedOut = !!(options && options.passedOut);
      const summary = { earned: 0, rain: false, newSeason: null, withered: 0, passedOut: passedOut };

      // 1. Shipping income (paid in cowries)
      summary.earned = state.shipped;
      FS.Wallet.add(state, 'cowrie', state.shipped);
      state.shipped = 0;

      // 2. Growth
      state.farm.tiles.forEach(FS.Farming.growOvernight);

      // 3. New day, maybe a new season
      const before = FS.State.calendar(state).season;
      state.day = Math.min(state.day + 1, FS.SaveCodec.LIMITS.day);
      const cal = FS.State.calendar(state);
      if (cal.season !== before) {
        summary.newSeason = cal.season;
        state.farm.tiles.forEach(function (t) {
          const crop = FS.Farming.cropOf(t);
          if (crop && crop.seasons.indexOf(cal.season) === -1) {
            t.crop = FS.CROP_WITHERED;
            t.growth = 0;
            summary.withered++;
          }
        });
      }

      // 4. Morning rain waters the field
      if (FS.State.isRaining(state)) {
        summary.rain = true;
        state.farm.tiles.forEach(function (t) { if (t.tilled) t.watered = true; });
      }

      // 5. Villagers
      state.npcs.forEach(function (n) { n.talked = false; n.gifted = false; });

      // 6. Wake up at home
      state.energy = passedOut ? C.PASS_OUT_ENERGY : C.MAX_ENERGY;
      state.time = C.DAY_START_MIN;
      state.pos = null;

      return summary;
    }
  };
})(FarmSim);
