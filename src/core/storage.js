/**
 * storage.js
 * ==========
 * Where the save string is kept. The game doesn't care which one is used;
 * they all offer the same four methods:
 *
 *   load()            -> the saved string, or '' if there is none
 *   save(text)        -> true if it was stored
 *   setCompleted()    -> tell the LMS the learner has completed the activity
 *   finish()          -> called when the page is closing
 *
 * Which storage is used (FarmSim.Storage.create):
 *   1. EduGame Kit's save helper (edugame.js) - in every build made by
 *      `edugame build` or `edugame preview`. The helper picks the platform
 *      itself: Kolibri Games, SCORM 1.2 (Kolibri Learn, Moodle...), the
 *      Sugarizer Journal, or the browser. It must be the ONLY code that talks
 *      to SCORM, so the game never touches SCORM itself when the helper is there.
 *   2. SCORM 1.2 directly - only when the helper isn't loaded (e.g. the game
 *      folder served as-is by Live Server inside a test LMS page).
 *   3. localStorage - in a normal browser with no LMS (good for testing).
 *      Saves stay on that one device and browser.
 *   4. Memory - if none of these work (e.g. private browsing). Nothing persists.
 */
(function (FS) {
  'use strict';

  // ------------------------------------------------------------- SCORM 1.2
  /**
   * The standard way to find the SCORM 1.2 API: look for an object called
   * `API` on this window, then on each parent window, then on the opener.
   * Accessing a window from another website throws an error, so every
   * access is wrapped in try/catch.
   */
  function findScormApi() {
    function search(win) {
      for (let tries = 0; win && tries < 10; tries++) {
        try {
          if (win.API && typeof win.API.LMSInitialize === 'function') return win.API;
        } catch (e) { /* cross-origin window: keep looking */ }
        let parent = null;
        try { parent = win.parent; } catch (e) { parent = null; }
        if (!parent || parent === win) break;
        win = parent;
      }
      return null;
    }
    if (typeof window === 'undefined') return null;
    let api = search(window);
    if (!api) {
      try { if (window.opener) api = search(window.opener); } catch (e) { api = null; }
    }
    return api;
  }

  class ScormStorage {
    constructor(api) {
      this.api = api;
      this.kind = 'scorm';
      this.ok = String(api.LMSInitialize('')) === 'true';
      if (this.ok) {
        // A first launch reports "not attempted"; mark it as in progress.
        const status = String(api.LMSGetValue('cmi.core.lesson_status') || '');
        if (status === '' || status === 'not attempted') {
          api.LMSSetValue('cmi.core.lesson_status', 'incomplete');
        }
        // IMPORTANT: "suspend" tells the LMS to keep suspend_data for next
        // time. Without it, some LMSs start a fresh attempt and the save is lost.
        api.LMSSetValue('cmi.core.exit', 'suspend');
        api.LMSCommit('');
      }
    }

    load() {
      if (!this.ok) return '';
      return String(this.api.LMSGetValue('cmi.suspend_data') || '');
    }

    save(text) {
      if (!this.ok) return false;
      if (text.length > FS.Config.SCORM_MAX_CHARS) {
        // Never send an over-long save: many LMSs silently cut it off, which
        // would corrupt it. The size tests should make this impossible.
        console.error('[FarmSim] save is ' + text.length + ' chars, over the SCORM limit');
        return false;
      }
      const set = String(this.api.LMSSetValue('cmi.suspend_data', text)) === 'true';
      this.api.LMSSetValue('cmi.core.exit', 'suspend');
      const committed = String(this.api.LMSCommit('')) === 'true';
      return set && committed;
    }

    setCompleted() {
      if (!this.ok) return;
      this.api.LMSSetValue('cmi.core.lesson_status', 'completed');
      this.api.LMSCommit('');
    }

    finish() {
      if (!this.ok) return;
      try { this.api.LMSFinish(''); } catch (e) { /* page is closing anyway */ }
      this.ok = false;
    }
  }

  // ---------------------------------------------------------- localStorage
  class LocalStorage {
    constructor(key) {
      this.key = key;
      this.kind = 'localStorage';
    }
    static available() {
      try {
        const k = '__farmsim_test__';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        return true;
      } catch (e) { return false; }
    }
    load() {
      try { return window.localStorage.getItem(this.key) || ''; } catch (e) { return ''; }
    }
    save(text) {
      try { window.localStorage.setItem(this.key, text); return true; } catch (e) { return false; }
    }
    setCompleted() {}
    finish() {}
  }

  // -------------------------------------------------------- EduGame Kit
  /**
   * Saves through EduGame Kit's helper. The game's save string is passed as it
   * is: the helper keeps it in its own record ({"_v": 1, "_save": "<string>", ...})
   * and allows up to 3,900 characters for it (our worst case is about 500).
   * EduGame.ready() must have finished before this is made (see main.js).
   */
  class EduGameStorage {
    constructor(info) {
      this.kind = 'edugame:' + info.platform;
      this.text = typeof info.save === 'string' ? info.save : '';
      this.completed = false;
      this.lastError = null;
    }
    load() { return this.text; }
    save(text) {
      const self = this;
      this.text = text;
      // The helper saves asynchronously; report a failure the next time we save.
      EduGame.save(text).then(function () { self.lastError = null; }, function (e) {
        self.lastError = e && e.message;
        console.error('[FarmSim] save failed:', self.lastError);
      });
      return !this.lastError;
    }
    // "passed" in SCORM (Kolibri ignores "completed"); the helper decides.
    setCompleted() {
      if (this.completed) return;
      this.completed = true;
      EduGame.complete();
    }
    finish() { /* the helper ends the SCORM session when the page closes */ }
  }

  // ---------------------------------------------------------------- memory
  class MemoryStorage {
    constructor() { this.kind = 'memory'; this.text = ''; }
    load() { return this.text; }
    save(text) { this.text = text; return true; }
    setCompleted() {}
    finish() {}
  }

  FS.Storage = {
    EduGameStorage: EduGameStorage,
    ScormStorage: ScormStorage,
    LocalStorage: LocalStorage,
    MemoryStorage: MemoryStorage,
    findScormApi: findScormApi,

    /**
     * Pick the best available storage (see the list at the top of the file).
     * `edugameInfo` is what EduGame.ready() gave, when the helper is loaded.
     */
    create: function (edugameInfo) {
      if (edugameInfo) return new EduGameStorage(edugameInfo);
      const api = findScormApi();
      if (api) {
        const scorm = new ScormStorage(api);
        if (scorm.ok) return scorm;
      }
      if (typeof window !== 'undefined' && LocalStorage.available()) {
        return new LocalStorage(FS.Config.STORAGE_KEY);
      }
      return new MemoryStorage();
    }
  };
})(FarmSim);
