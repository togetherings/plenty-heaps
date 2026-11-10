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
 *   - when moving between areas, and every few seconds of play (if anything
 *     changed): Kolibri only keeps what reached it before the learner leaves
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
    lastSaveText: '',       // the last save, so unchanged state isn't saved again
    // Set when the existing save couldn't be read: {kind: 'damaged' or 'newer', message}.
    // Nothing is saved then, so the learner's farm isn't lost, until they choose to
    // start a new farm (startNewFarm). main.js shows the message (ui/saveProblem.js).
    problem: null,
    lastSaveError: null,    // why the last save wasn't written, if it wasn't

    start: function (options) {
      options = options || {};
      Session.storage = options.storage || FS.Storage.create(options.edugameInfo);
      let text = options.reset ? '' : Session.storage.load();
      Session.state = null;
      Session.problem = null;
      if (text) {
        try {
          Session.state = FS.SaveCodec.decode(text);
        } catch (e) {
          // Keep a copy of the unreadable save so it can be investigated, and
          // don't save over it: the learner decides (see Session.problem).
          Session.problem = { kind: e.kind === 'newer' ? 'newer' : 'damaged', message: e.message };
          console.error('[FarmSim] could not load save:', e.message);
          try { window.localStorage.setItem(FS.Config.STORAGE_KEY + '.unreadable', text); } catch (err) { /* ignore */ }
        }
      }
      if (!Session.state) Session.state = FS.State.newGame();
      return Session.state;
    },

    /** Encode and store the current state. Returns true on success. */
    save: function () {
      if (Session.problem) return false;       // never save over a save we couldn't read
      const text = FS.SaveCodec.encode(Session.state);
      // Read it back before writing: a save that can't be loaded must never replace
      // a good one (a bug in the codec would otherwise lose the learner's farm).
      try {
        FS.SaveCodec.decode(text);
      } catch (e) {
        Session.lastSaveError = e.message;
        console.error('[FarmSim] not saving, the save could not be read back:', e.message);
        return false;
      }
      Session.lastSaveError = null;
      Session.lastSaveChars = text.length;
      Session.lastSaveText = text;
      const ok = Session.storage.save(text);
      if (FS.State.getFlag(Session.state, FS.Config.COMPLETION_FLAG)) Session.storage.setCompleted();
      return ok;
    },

    /** Save only if the state changed since the last save. */
    saveIfChanged: function () {
      if (Session.problem) return false;
      if (FS.SaveCodec.encode(Session.state) === Session.lastSaveText) return true;
      return Session.save();
    },

    /**
     * The learner chose to start a new farm after a save problem: saving starts
     * again (the game is already a new one). The kit is told too, when it was
     * the kit that couldn't read what the platform kept.
     */
    startNewFarm: function () {
      const kit = Session.problem && Session.problem.kit;
      Session.problem = null;
      if (kit && typeof EduGame !== 'undefined') return EduGame.startOver();
      return Promise.resolve(true);
    },

    finish: function () {
      if (Session.storage) Session.storage.finish();
    }
  };

  FS.Session = Session;
})(FarmSim);
