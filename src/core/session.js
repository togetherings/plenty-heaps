/**
 * session.js
 * ==========
 * Ties the game state to storage. The scenes call:
 *
 *   FarmSim.Session.start()    once at boot: load the save or begin a new game
 *   FarmSim.Session.save()     whenever the game should be saved
 *   FarmSim.Session.state      the live game state everyone reads and changes
 *
 * WHEN THE GAME SAVES (see WorldScene / main.js):
 *   - after sleeping (the main save, like Harvest Moon)
 *   - when moving between areas, and every couple of game hours
 *   - when the page is hidden or closed (tab switch, app closed, class ends)
 * Mid-day saves also store where the player is standing, so closing the
 * game in the middle of the day doesn't throw away the morning's work.
 */
(function (FS) {
  'use strict';

  const Session = {
    state: null,
    storage: null,
    lastSaveChars: 0,       // size of the last save, shown in debug info
    loadError: null,        // set if an existing save could not be read

    start: function (options) {
      options = options || {};
      Session.storage = options.storage || FS.Storage.create(options.edugameInfo);
      let text = options.reset ? '' : Session.storage.load();
      Session.state = null;
      if (text) {
        try {
          Session.state = FS.SaveCodec.decode(text);
        } catch (e) {
          // Keep a copy of the unreadable save so it can be investigated,
          // then start fresh rather than leaving the learner stuck.
          Session.loadError = e.message;
          console.error('[FarmSim] could not load save:', e.message);
          try { window.localStorage.setItem(FS.Config.STORAGE_KEY + '.unreadable', text); } catch (err) { /* ignore */ }
        }
      }
      if (!Session.state) Session.state = FS.State.newGame();
      return Session.state;
    },

    /** Encode and store the current state. Returns true on success. */
    save: function () {
      const text = FS.SaveCodec.encode(Session.state);
      Session.lastSaveChars = text.length;
      const ok = Session.storage.save(text);
      if (FS.State.getFlag(Session.state, FS.Config.COMPLETION_FLAG)) Session.storage.setCompleted();
      return ok;
    },

    finish: function () {
      if (Session.storage) Session.storage.finish();
    }
  };

  FS.Session = Session;
})(FarmSim);
