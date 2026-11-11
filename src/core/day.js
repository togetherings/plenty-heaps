/**
 * day.js
 * ======
 * What happens overnight when the player sleeps (or passes out at midnight).
 * This is the heart of the farming loop:
 *
 *   1. Pay out what was put in the shipping bin.
 *   2. If the day's rain added up to enough to water (weather.js), the field
 *      is watered - even rain that fell after the player went to bed.
 *      Watered crops grow one day; all soil dries out.
 *   3. Move to the next day. If the season changed, out-of-season crops wither.
 *   4. Villagers' "talked today" / "gift today" flags reset.
 *   5. The player wakes at home with energy restored.
 *
 * Rain on the new day waters the field when enough has fallen (WorldScene
 * checks as the clock runs).
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

      // 2. Growth (after the rest of the day's rain)
      if (FS.Weather.watered(state.seed, state.day)) FS.Farming.rainWater(state);
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

      // 4. Villagers
      state.npcs.forEach(function (n) { n.talked = false; n.gifted = false; });

      // 5. Wake up at home
      state.energy = passedOut ? C.PASS_OUT_ENERGY : C.MAX_ENERGY;
      state.time = C.DAY_START_MIN;
      state.pos = null;
      // Rain overnight that has already watered the new day's field
      if (FS.State.rainHasWatered(state)) FS.Farming.rainWater(state);
      summary.rain = FS.State.isRaining(state);

      return summary;
    }
  };
})(FarmSim);
