/**
 * namespace.js
 * ============
 * Creates the single global object, `FarmSim`, that every other file attaches
 * itself to. Loaded first (see index.html).
 *
 * WHY NO MODULES / BUNDLER?
 *   Plain <script> files with one shared namespace run on very old Android
 *   WebViews, need no build step, and can be zipped straight into Kolibri or a
 *   SCORM package. Each file wraps its code in a function so nothing leaks into
 *   the global scope except `FarmSim`.
 *
 * CODE STYLE NOTE (for compatibility with older devices):
 *   Use ES2015 features only (let/const, arrow functions, classes, template
 *   strings). Avoid newer syntax such as optional chaining (a?.b), nullish
 *   coalescing (a ?? b) and class fields, which crash older Android browsers.
 *
 * The same files also run in Node.js for the automated tests (tests/), which is
 * why we pick `window` or `global` below.
 */
(function (root) {
  'use strict';
  root.FarmSim = root.FarmSim || {};

  /**
   * Tiny assertion helper used by data/registry code to catch mistakes early
   * (for example, two items accidentally given the same ID).
   */
  root.FarmSim.assert = function (condition, message) {
    if (!condition) throw new Error('[FarmSim] ' + message);
  };
})(typeof window !== 'undefined' ? window : global);
