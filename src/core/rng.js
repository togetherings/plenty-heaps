/**
 * rng.js
 * ======
 * Deterministic random numbers.
 *
 * KEY SAVE-SPACE IDEA: anything random that can be RE-CREATED from the world
 * seed and the day number does not need to be saved. Today's weather, which
 * fish are biting, the layout of a mine floor, forage spawns... all come from
 * `FarmSim.Rng.forDay(seed, day, 'weather')` and are recomputed on load.
 *
 * The third argument ("salt") gives each system its own independent stream, so
 * adding a new random system later doesn't change the weather of existing
 * saves.
 */
(function (FS) {
  'use strict';

  /** mulberry32: tiny, fast, good-enough PRNG. Returns a function -> [0, 1). */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Turn a string into a 32-bit number (FNV-1a hash). */
  function hashString(str) {
    let h = 0x811C9DC5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  FS.Rng = {
    mulberry32: mulberry32,
    hashString: hashString,

    /** A random-number function for one system on one day. */
    forDay: function (seed, day, salt) {
      return mulberry32((seed ^ Math.imul(day + 1, 0x9E3779B1) ^ hashString(salt || '')) >>> 0);
    },

    /** A fresh 32-bit world seed for a new game. */
    newSeed: function () {
      return Math.floor(Math.random() * 4294967296) >>> 0;
    }
  };
})(FarmSim);
