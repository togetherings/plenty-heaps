/**
 * weather.js
 * ==========
 * Rain. Each day's rain is worked out from the world seed and the day number
 * (never saved), as one or more spells with a start, an end and a strength:
 *
 *   First Rain   60% of days: mostly 1-4 hour storms in the afternoon or
 *                evening; sometimes rain most of the day.
 *   Big Rain     85%: 3 hours to all day; about 4 in 10 rainy days rain all day.
 *   Harmattan     3%: 1-2 hours of light rain.
 *   Warm Season  12%: 1-3 hour storms in the late afternoon.
 *
 * WATERING RULE: a day's rain waters the crops once it adds up to
 * WATER_MINUTES (4 hours). Storms are heavy rain and count double, so a
 * 2-hour storm waters too. Shorter rain doesn't.
 *
 * Times are minutes since midnight (0-1440).
 */
(function (FS) {
  'use strict';

  const H = 60;
  const STEP = 10;           // rain starts and stops on 10-minute marks

  // Per season: chance of rain on a day, and how a rainy day goes.
  const SEASON_RAIN = {
    firstrain: { chance: 0.60 },
    bigrain:   { chance: 0.85 },
    harmattan: { chance: 0.03 },
    warm:      { chance: 0.12 }
  };

  function between(r, a, b) { return a + r() * (b - a); }
  function snap(m) { return Math.max(0, Math.min(1440, Math.round(m / STEP) * STEP)); }
  function spell(start, length, heavy) {
    const s = snap(start), e = snap(start + length);
    return e > s ? { start: s, end: e, heavy: !!heavy } : null;
  }

  const cache = {};

  FS.Weather = {
    WATER_MINUTES: 4 * H,
    SEASON_RAIN: SEASON_RAIN,

    /** The rain spells of a day: [{start, end, heavy}], in time order. */
    spells: function (seed, day) {
      const key = seed + ':' + day;
      if (cache[key]) return cache[key];
      const season = FS.Calendar.season(day);
      const r = FS.Rng.forDay(seed, day, 'weather');
      const out = [];
      if (r() < SEASON_RAIN[season].chance) {
        if (season === 'firstrain') {
          if (r() < 0.2) out.push(spell(between(r, 4, 8) * H, between(r, 10, 16) * H, false));
          else out.push(spell(between(r, 13, 20) * H, between(r, 1, 4) * H, true));
        } else if (season === 'bigrain') {
          if (r() < 0.4) out.push(spell(0, 24 * H, r() < 0.5));
          else {
            const first = spell(between(r, 0, 16) * H, between(r, 3, 9) * H, r() < 0.3);
            out.push(first);
            if (r() < 0.35) out.push(spell(first.end + between(r, 2, 5) * H, between(r, 1, 4) * H, r() < 0.5));
          }
        } else if (season === 'harmattan') {
          out.push(spell(between(r, 9, 19) * H, between(r, 1, 2) * H, false));
        } else {
          out.push(spell(between(r, 14, 19) * H, between(r, 1, 3) * H, true));
        }
      }
      const spells = out.filter(Boolean);
      // Keep the cache small: it's only ever asked about a few days at a time.
      if (Object.keys(cache).length > 64) Object.keys(cache).forEach(function (k) { delete cache[k]; });
      cache[key] = spells;
      return spells;
    },

    /** The spell under way at a minute of a day, or null. */
    spellAt: function (seed, day, minute) {
      const s = FS.Weather.spells(seed, day);
      for (let i = 0; i < s.length; i++) if (minute >= s[i].start && minute < s[i].end) return s[i];
      return null;
    },

    isRainingAt: function (seed, day, minute) { return !!FS.Weather.spellAt(seed, day, minute); },

    /** Does any rain fall that day? */
    rainyDay: function (seed, day) { return FS.Weather.spells(seed, day).length > 0; },

    /** Minutes of rain from midnight until `minute` (heavy rain counts double). */
    rainMinutes: function (seed, day, minute) {
      const until = minute === undefined ? 1440 : minute;
      return FS.Weather.spells(seed, day).reduce(function (sum, s) {
        const m = Math.max(0, Math.min(until, s.end) - s.start);
        return sum + m * (s.heavy ? 2 : 1);
      }, 0);
    },

    /** Has the day's rain watered the crops by this minute (default: by the end of the day)? */
    watered: function (seed, day, minute) {
      return FS.Weather.rainMinutes(seed, day, minute) >= FS.Weather.WATER_MINUTES;
    }
  };
})(FarmSim);
