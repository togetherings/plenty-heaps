/**
 * areas.js
 * ========
 * Every place the player can be. Each area is one Tiled map.
 *
 *   id       permanent save ID (0-15), used to remember where the player is
 *            during a mid-day save.
 *   map      name of the map in FarmSim.Maps (= the .tmj file name).
 *   outdoor  outdoor areas show rain and get darker at night.
 *
 * TO ADD AN AREA: make the map in Tiled (copy an existing .tmj as a start),
 * run `node tools/build-maps.js`, add a <script> tag for it in index.html,
 * add an entry below, and add a "warp" object in another map that leads to
 * it. See README.md for details.
 *
 * MAP OBJECT TYPES the game understands (set as the object's "Class"/"Type"
 * in Tiled, on the layer named "objects"):
 *   spawn     a named place the player can appear. Optional property
 *             facing = up/down/left/right.
 *   warp      walking into it moves the player to another area.
 *             Properties: target = area key, spawn = spawn name there.
 *   farmland  the rectangle of tillable ground (farm map only; one per map).
 *   ship      the shipping bin. Items put in are sold overnight.
 *   bed       sleep here to end the day and save.
 *   sign      shows a message. Property: text = string key.
 *   npc       a villager stands here. Properties: npc = key from npcs.js,
 *             facing.
 *   critter   an animal that wanders nearby (decoration, not saved).
 *             Property: kind = crab / hen / chick (see BootScene CRITTERS).
 *
 * MAP LAYERS: ground, decor (drawn under characters), above (drawn over
 * them: roofs, tree tops) and objects. Tiles with the "collides" property
 * block movement on any of the tile layers.
 */
(function (FS) {
  'use strict';

  FS.Areas = FS.makeRegistry('Areas', [
    { id: 0, key: 'house',   map: 'house',   outdoor: false },
    { id: 1, key: 'farm',    map: 'farm',    outdoor: true  },
    { id: 2, key: 'village', map: 'village', outdoor: true  }
  ], 15);

  // Where a brand-new game starts and where the player wakes up each morning.
  FS.Areas.HOME = { area: 'house', spawn: 'bed_spawn' };

  /**
   * Read a property from a Tiled object. Tiled stores properties as a list of
   * {name, type, value}; this hides that detail.
   */
  FS.Areas.prop = function (obj, name, fallback) {
    const props = obj.properties;
    if (Array.isArray(props)) {
      for (let i = 0; i < props.length; i++) {
        if (props[i].name === name) return props[i].value;
      }
    } else if (props && props[name] !== undefined) {
      return props[name];
    }
    return fallback;
  };

  /** Tiled 1.9 called the object type "class"; later versions use "type". */
  FS.Areas.objType = function (obj) { return obj.type || obj['class'] || ''; };

  /** All objects in a map's "objects" layer (from the raw Tiled data). */
  FS.Areas.objects = function (mapKey) {
    const map = FS.Maps && FS.Maps[mapKey];
    FS.assert(map, 'map "' + mapKey + '" is not loaded - is its script tag in index.html?');
    for (let i = 0; i < map.layers.length; i++) {
      if (map.layers[i].type === 'objectgroup' && map.layers[i].name === 'objects') return map.layers[i].objects;
    }
    return [];
  };

  /** First object of the given type (and optional name) in a map, or null. */
  FS.Areas.findObject = function (mapKey, type, name) {
    const objs = FS.Areas.objects(mapKey);
    for (let i = 0; i < objs.length; i++) {
      if (FS.Areas.objType(objs[i]) === type && (name === undefined || objs[i].name === name)) return objs[i];
    }
    return null;
  };

  /** The farmland rectangle, in tiles: {col, row, cols, rows}. */
  FS.Areas.farmland = function () {
    const o = FS.Areas.findObject('farm', 'farmland');
    FS.assert(o, 'the farm map needs one object of type "farmland"');
    const T = FS.Config.TILE;
    return { col: Math.round(o.x / T), row: Math.round(o.y / T), cols: Math.round(o.width / T), rows: Math.round(o.height / T) };
  };
})(FarmSim);
