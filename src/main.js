/**
 * main.js
 * =======
 * Starts the game. Loaded last.
 *
 * URL options for testing (add to the address, e.g. index.html?debug&touch):
 *   ?reset   start a new game (ignores the existing save until the next save)
 *   ?debug   show collision boxes and the save size on screen
 *   ?touch   show the on-screen touch controls even with a mouse
 *   ?canvas  use the Canvas renderer instead of WebGL, to check how the game
 *            looks and runs on devices without WebGL
 */
(function (FS) {
  'use strict';

  // Phaser is a separate download (see README). Explain clearly if it's missing.
  if (typeof Phaser === 'undefined') {
    document.getElementById('game').innerHTML =
      '<p style="color:#fff;font:16px sans-serif;padding:20px">' +
      'Phaser is missing. Download phaser.min.js (version 3.90.0) and put it in the lib/ folder.</p>';
    return;
  }

  const C = FS.Config;
  const params = window.location.search;
  const has = function (name) { return new RegExp('[?&]' + name + '(=|&|$)').test(params); };
  if (has('debug')) C.DEBUG_PHYSICS = true;
  if (has('touch')) C.FORCE_TOUCH = true;

  // A simple message channel between scenes (e.g. the action button).
  FS.bus = new Phaser.Events.EventEmitter();

  // EduGame Kit's save helper (edugame.js) is in every build. It finds out
  // where the game is running (Kolibri, a learning system, the browser...) and
  // loads the save, so wait for it. Without it (the raw folder served by Live
  // Server, with no build) the game saves by itself.
  if (window.EduGame) {
    window.EduGame.ready().then(start, function (e) {
      console.error('[FarmSim] the save helper failed, saving in this browser:', e);
      start(null);
    });
  } else {
    start(null);
  }

  function start(edugameInfo) {
    // Load the save (or start a new game) BEFORE Phaser starts.
    FS.Session.start({ reset: has('reset'), edugameInfo: edugameInfo });

    FS.game = new Phaser.Game({
      type: has('canvas') ? Phaser.CANVAS : Phaser.AUTO,   // WebGL when available, else Canvas
      parent: 'game',
      width: C.GAME_WIDTH,
      height: C.GAME_HEIGHT,
      pixelArt: true,                    // crisp pixels, no blurring
      backgroundColor: '#000000',
      scale: {
        mode: Phaser.Scale.FIT,          // fill the screen, keep the shape
        autoCenter: Phaser.Scale.CENTER_BOTH
      },
      physics: {
        default: 'arcade',
        arcade: { debug: C.DEBUG_PHYSICS }
      },
      // Order matters: later scenes draw on top.
      scene: [FS.BootScene, FS.CreateScene, FS.WorldScene, FS.UIScene]
    });
  }

  // ---- Save when the learner leaves -------------------------------------
  // Switching tabs or apps and locking the screen hide the page: save then,
  // since a phone may close the app later without warning. Closing the page
  // or leaving the resource in Kolibri fires "pagehide" (and only then hides
  // the page): save there, once, and not again after.
  //
  // With EduGame Kit's helper, this pagehide listener must stay ahead of the
  // helper's own (which ends the SCORM session). It is: it's added now, and
  // the helper adds its listener later, when EduGame.ready() connects.
  let closing = false;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && !closing && FS.Session.state) FS.Session.save();
  });
  window.addEventListener('pagehide', function () {
    if (closing) return;
    closing = true;
    if (FS.Session.state) FS.Session.save();
    FS.Session.finish();
  });
})(FarmSim);
