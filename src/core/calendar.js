/**
 * calendar.js
 * ===========
 * The game's year: four seasons of Config.SEASON_DAYS days each, following the
 * region's real year (see DESIGN.md):
 *
 *   firstrain   First Rain (around May-July)       the rains start: planting
 *   bigrain     Big Rain, the Hungry Season (Aug-Oct)
 *   harmattan   Harmattan (Nov-Jan)                 early dry season
 *   warm        Warm Season (Feb-Apr)               late dry season
 *
 * Days are counted from 0 (First Rain 1 of year 1). Nothing here is saved:
 * everything comes from the day number.
 */
(function (FS) {
  'use strict';

  const C = FS.Config;

  FS.Calendar = {
    /** Days in a year. */
    yearDays: function () { return C.SEASON_DAYS * C.SEASONS.length; },

    /** Season, day of season (1-), day of year (1-) and year (1-) for a day number. */
    of: function (day) {
      const seasonIndex = Math.floor(day / C.SEASON_DAYS) % C.SEASONS.length;
      return {
        seasonIndex: seasonIndex,
        season: C.SEASONS[seasonIndex],
        dayOfSeason: (day % C.SEASON_DAYS) + 1,
        dayOfYear: (day % FS.Calendar.yearDays()) + 1,
        year: Math.floor(day / FS.Calendar.yearDays()) + 1
      };
    },

    season: function (day) { return FS.Calendar.of(day).season; }
  };
})(FarmSim);
