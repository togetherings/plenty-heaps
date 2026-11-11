/**
 * sky.js
 * ======
 * The sun, the moon and the tides, all worked out from the day and the time
 * (never saved). See DESIGN.md: "Daylight", "Moon" and "Tides".
 *
 * SUN: real sunrise and sunset for Lungi, Sierra Leone (8.6 N, 13.2 W) on GMT
 * clocks, so midday is near 12:53. The game year (48 days) is mapped onto the
 * real year: First Rain 7 is the June solstice, Big Rain 7 the September
 * equinox, Harmattan 7 the December solstice, Warm Season 7 the March one.
 * Twilight is civil twilight (sun 6 degrees below the horizon).
 *
 * MOON: an 11-day month (264 game hours), full at hour 0 of the game. It rises
 * about 2 h 24 min later each day.
 *
 * TIDES: follow the moon. A high tide every 13 h 12 min (half a moon day),
 * when the moon is highest or directly underfoot. Spring tides (biggest range)
 * at full and new moon, neap tides at half moon, a little bigger near the
 * equinoxes. Each area can be later (tideDelay, minutes) and smaller
 * (tideSize, 1 = full) than the open coast. levelAt() turns the height into
 * one of 5 tide levels (0 lowest - 4 highest), which the maps use.
 */
(function (FS) {
  'use strict';

  const LAT = 8.6, LON = 13.2;          // degrees north, degrees west
  const RAD = Math.PI / 180;
  const MOON_HOURS = 264;
  const TIDE_PERIOD = 12 * 11 / 10;     // 13.2 hours
  const LEVELS = 5;
  const MAX_RANGE = 1.55;               // biggest possible tide height

  function hours(day, minute) { return day * 24 + (minute || 0) / 60; }

  /** Equation of time (minutes) for a real day of the year. */
  function equationOfTime(realDay) {
    const g = 2 * Math.PI * (realDay - 1) / 365;
    return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  }

  const sunCache = {};

  const Sky = {
    LAT: LAT, LON: LON, MOON_HOURS: MOON_HOURS, TIDE_PERIOD: TIDE_PERIOD, LEVELS: LEVELS,

    /** The sun's declination (degrees) on a day of the year (1-48). */
    declination: function (dayOfYear) {
      return 23.44 * Math.cos(2 * Math.PI * (dayOfYear - 7) / FS.Calendar.yearDays());
    },

    /** The real day of the year (1-365) that a game day of the year stands for. */
    realDay: function (dayOfYear) {
      return ((172 + (dayOfYear - 7) * 365.25 / FS.Calendar.yearDays()) % 365 + 365) % 365;
    },

    /**
     * Sun times for a day of the year, in minutes since midnight (GMT):
     * {firstLight, sunrise, noon, sunset, dark}.
     */
    sun: function (dayOfYear) {
      if (sunCache[dayOfYear]) return sunCache[dayOfYear];
      const dec = Sky.declination(dayOfYear) * RAD, lat = LAT * RAD;
      const ha = function (alt) {
        const c = (Math.sin(alt * RAD) - Math.sin(lat) * Math.sin(dec)) / (Math.cos(lat) * Math.cos(dec));
        return Math.acos(Math.max(-1, Math.min(1, c))) / RAD * 4;   // minutes
      };
      const noon = 720 + LON * 4 - equationOfTime(Sky.realDay(dayOfYear));
      const rise = ha(-0.833), civil = ha(-6);
      const out = { firstLight: noon - civil, sunrise: noon - rise, noon: noon, sunset: noon + rise, dark: noon + civil };
      sunCache[dayOfYear] = out;
      return out;
    },

    /** How light it is outdoors: 1 in daylight, 0 at night, in between at twilight. */
    light: function (day, minute) {
      const s = Sky.sun(FS.Calendar.of(day).dayOfYear);
      if (minute >= s.sunrise && minute <= s.sunset) return 1;
      if (minute <= s.firstLight || minute >= s.dark) return 0;
      return minute < s.sunrise ? (minute - s.firstLight) / (s.sunrise - s.firstLight)
        : (s.dark - minute) / (s.dark - s.sunset);
    },

    /** The moon's age in hours since full moon (0-264): 132 is new moon. */
    moonAge: function (day, minute) {
      return ((hours(day, minute) % MOON_HOURS) + MOON_HOURS) % MOON_HOURS;
    },

    /** How much of the moon is lit: 1 full, 0 new. */
    moonLit: function (day, minute) {
      return (1 + Math.cos(2 * Math.PI * Sky.moonAge(day, minute) / MOON_HOURS)) / 2;
    },

    /** The size of the tides on a day (0.6 at neaps, about 1.4 at springs, more near equinoxes). */
    tideRange: function (day, minute) {
      const doy = FS.Calendar.of(day).dayOfYear;
      return 1 + 0.4 * Math.cos(2 * Math.PI * Sky.moonAge(day, minute) / (MOON_HOURS / 2)) -
        0.15 * Math.cos(2 * Math.PI * (doy - 7) / (FS.Calendar.yearDays() / 2));
    },

    /**
     * The tide's height at a time, from -MAX_RANGE (lowest) to MAX_RANGE (highest).
     * area: {tideDelay (minutes), tideSize (1 = the open coast)} or nothing.
     */
    tideHeight: function (day, minute, area) {
      const delay = area && area.tideDelay ? area.tideDelay : 0;
      const size = area && area.tideSize !== undefined ? area.tideSize : 1;
      const t = hours(day, minute - delay);
      return size * Sky.tideRange(day, minute - delay) * Math.cos(2 * Math.PI * t / TIDE_PERIOD);
    },

    /** The tide level (0 lowest - 4 highest) the maps show. */
    tideLevel: function (day, minute, area) {
      const h = Sky.tideHeight(day, minute, area) / MAX_RANGE;
      return Math.max(0, Math.min(LEVELS - 1, Math.round((h + 1) / 2 * (LEVELS - 1))));
    },

    /** The times (minutes, this day) of the high tides on the open coast. */
    highTides: function (day) {
      const out = [];
      const start = hours(day, 0);
      let k = Math.ceil(start / TIDE_PERIOD);
      for (; k * TIDE_PERIOD < start + 24; k++) out.push(Math.round((k * TIDE_PERIOD - start) * 60));
      return out;
    }
  };

  FS.Sky = Sky;
})(FarmSim);
