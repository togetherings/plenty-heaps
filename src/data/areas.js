/**
 * areas.js
 * ========
 * Every place the player can be. Each area is one map in maps-src/ (a .tmj
 * file, made with the map maker: python tools/map_maker.py). The list comes from
 * src/data/maps.js, which the map maker builds; each map's own properties say:
 *
 *   id       permanent save ID (0-63), used to remember where the player is
 *            during a mid-day save. Never reuse the id of a removed map.
 *   key      the map's file name (farm.tmj -> "farm").
 *   outdoor  outdoor areas show rain and get darker at night.
 *
 * An outside area and the rooms of its buildings are two maps: the outside, and
 * one "interiors" map holding every room, each marked by a "room" object.
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
 *   room      a room of an interiors map: the camera stays inside the room
 *             the player is in, so the other rooms are never seen.
 *
 * MAP LAYERS: ground, decor (drawn under characters), above (drawn over
 * them: roofs, tree tops), collision (optional, never drawn) and objects.
 * Tiles with the "collides" property block movement on any of the tile
 * layers. The collision layer changes single squares: its "block" tile blocks
 * a square, its "open" tile lets the player walk on a square whatever is there.
 */
(function (FS) {
  'use strict';

  FS.Areas = FS.makeRegistry('Areas', (FS.MapList || []).map(function (m) {
    return { id: m.id, key: m.key, map: m.key, outdoor: !!m.outdoor };
  }), 63);

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

  /** The rooms of an interiors map, in pixels: [{name, x, y, width, height}] (none outside). */
  FS.Areas.rooms = function (mapKey) {
    return FS.Areas.objects(mapKey).filter(function (o) { return FS.Areas.objType(o) === 'room'; })
      .map(function (o) { return { name: o.name, x: o.x, y: o.y, width: o.width, height: o.height }; });
  };

  /**
   * The collision layer's changes, as {block: [[x, y]...], open: [[x, y]...]}.
   * Its tiles come from the "collision" tileset: the first blocks, the second opens.
   */
  FS.Areas.collision = function (mapKey) {
    const map = FS.Maps[mapKey], out = { block: [], open: [] };
    const layer = map.layers.filter(function (l) { return l.type === 'tilelayer' && l.name === 'collision'; })[0];
    const ts = (map.tilesets || []).filter(function (t) { return t.name === 'collision'; })[0];
    if (!layer || !ts) return out;
    for (let i = 0; i < layer.data.length; i++) {
      const g = layer.data[i] - ts.firstgid;
      if (g === 0) out.block.push([i % map.width, Math.floor(i / map.width)]);
      else if (g === 1) out.open.push([i % map.width, Math.floor(i / map.width)]);
    }
    return out;
  };

  /** The farmland rectangle, in tiles: {col, row, cols, rows}. */
  FS.Areas.farmland = function () {
    const o = FS.Areas.findObject('farm', 'farmland');
    FS.assert(o, 'the farm map needs one object of type "farmland"');
    const T = FS.Config.TILE;
    return { col: Math.round(o.x / T), row: Math.round(o.y / T), cols: Math.round(o.width / T), rows: Math.round(o.height / T) };
  };
})(FarmSim);
