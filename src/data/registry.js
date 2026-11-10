/**
 * registry.js
 * ===========
 * A small helper for the data tables (items, crops, NPCs, areas...).
 *
 * Every entry has:
 *   id   - a PERMANENT number that goes into the save file.
 *   key  - a readable name used in code and other data files ('seed_maize').
 *
 * GOLDEN RULE FOR SAVES: never change or reuse an `id` once the game has been
 * released. To retire something, leave its entry in place (or mark it
 * `retired: true`); to add something, give it a new, unused id.
 */
(function (FS) {
  'use strict';

  FS.makeRegistry = function (name, entries, maxId) {
    const byId = {};
    const byKey = {};
    entries.forEach(function (e) {
      FS.assert(typeof e.id === 'number' && e.id >= 0 && e.id <= maxId,
        name + ' "' + e.key + '": id must be a number from 0 to ' + maxId);
      FS.assert(!byId[e.id], name + ': duplicate id ' + e.id + ' ("' + e.key + '" and "' + (byId[e.id] && byId[e.id].key) + '")');
      FS.assert(!byKey[e.key], name + ': duplicate key "' + e.key + '"');
      byId[e.id] = e;
      byKey[e.key] = e;
    });
    let highestId = -1;
    entries.forEach(function (e) { if (e.id > highestId) highestId = e.id; });
    return {
      list: entries,
      maxId: maxId,          // the largest id the save format allows
      highestId: highestId,  // the largest id actually in use
      byId: function (id) { return byId[id] || null; },
      get: function (key) {
        const e = byKey[key];
        FS.assert(e, name + ': unknown key "' + key + '"');
        return e;
      },
      has: function (key) { return !!byKey[key]; }
    };
  };
})(FarmSim);
