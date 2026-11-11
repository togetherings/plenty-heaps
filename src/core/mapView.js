/**
 * mapView.js
 * ==========
 * What a map looks like right now. A map (Tiled JSON, from the map maker) has
 * its three painted layers (ground, decor, above) and may also have:
 *
 *   - layers shown only sometimes: tile layers with a property `when` (see
 *     conditionMet) and `target` (the layer they draw on). Their tiles replace
 *     the target's tiles while the condition holds (rain puddles, flooded
 *     paths in the Big Rain, a season's painted look...).
 *   - a "tide" layer: each square's height (1-5) from the tide tileset. At tide
 *     level L (0-4) the squares with height <= L + 1 are under the sea
 *     (the map's tideWater autotile, normally "ocean").
 *
 * Then, for the whole tile list:
 *   - the season's swap rules (FarmSim.Tiles.swaps: dry grass in the
 *     Harmattan...) change tiles everywhere;
 *   - autotiles (water...) are painted as one tile and drawn here with the
 *     right edge and corner pieces for their neighbours.
 *
 * Plain functions, no Phaser: the game (WorldScene) and the map maker's
 * preview both use it, and the tests run it in Node.
 *
 * Tile layers hold Tiled gids: tile number + 1 (0 = nothing), with Tiled's
 * flip flags in the top three bits (kept as they are).
 */
(function (FS) {
  'use strict';

  const FLIPS = 0xE0000000, MASK = 0x1FFFFFFF;
  const LAYERS = ['ground', 'decor', 'above'];
  // Neighbour bits for autotiles: N, NE, E, SE, S, SW, W, NW
  const NEIGHBOURS = [[0, -1, 1], [1, -1, 2], [1, 0, 4], [1, 1, 8], [0, 1, 16], [-1, 1, 32], [-1, 0, 64], [-1, -1, 128]];

  function index(g) { const i = (g & MASK) >>> 0; return i ? i - 1 : -1; }
  function flags(g) { return (g - (g & MASK)) >>> 0; }          // the top 3 bits, as a positive number
  function withIndex(g, idx) { return idx < 0 ? 0 : flags(g) + idx + 1; }

  function prop(obj, name, fallback) {
    const p = (obj.properties || []).filter(function (x) { return x.name === name; })[0];
    return p ? p.value : fallback;
  }

  /** The family name of each autotile tile number (the painted tile and its pieces). */
  let familyCache = null;
  function families() {
    if (familyCache && familyCache.src === FS.Tiles.autotiles) return familyCache.map;
    const map = {};
    Object.keys(FS.Tiles.autotiles || {}).forEach(function (name) {
      const a = FS.Tiles.autotiles[name];
      map[a.base] = name;
      a.table.forEach(function (i) { map[i] = name; });
    });
    familyCache = { src: FS.Tiles.autotiles, map: map };
    return map;
  }

  const MapView = {
    LAYERS: LAYERS,
    index: index,
    flags: flags,

    /**
     * Does a layer's condition hold? ctx: {season, rain, tide, night}.
     * Conditions: rain, dry, night, day, season:harmattan[,warm...], tide:3 or tide:0-1.
     * Several can be joined with & (all must hold).
     */
    conditionMet: function (when, ctx) {
      return String(when || '').split('&').every(function (part) {
        const w = part.trim();
        if (w === 'rain') return !!ctx.rain;
        if (w === 'dry') return !ctx.rain;
        if (w === 'night') return !!ctx.night;
        if (w === 'day') return !ctx.night;
        if (w.indexOf('season:') === 0) return w.slice(7).split(',').indexOf(ctx.season) !== -1;
        if (w.indexOf('tide:') === 0) {
          if (ctx.tide === undefined || ctx.tide === null) return false;
          const r = w.slice(5).split('-').map(Number);
          return ctx.tide >= r[0] && ctx.tide <= (r.length > 1 ? r[1] : r[0]);
        }
        return false;
      });
    },

    /** The map's tile layers by name. */
    layer: function (map, name) {
      return map.layers.filter(function (l) { return l.type === 'tilelayer' && l.name === name; })[0] || null;
    },

    /** Does this map have a tide (a tide layer)? */
    hasTide: function (map) { return !!MapView.layer(map, 'tide'); },

    /** The first gid of the tide layer's tileset (heights 1-5 are firstgid .. firstgid + 4). */
    tideFirstGid: function (map) {
      const ts = (map.tilesets || []).filter(function (t) { return t.name === 'tide'; })[0];
      return ts ? ts.firstgid : null;
    },

    /**
     * The map as it looks for ctx {season, rain, tide, night}: {ground, decor, above}, each an array
     * of gids (one per square). ctx.layers (optional): only these conditional layers are shown, always.
     */
    build: function (map, ctx) {
      const w = map.width, h = map.height, n = w * h;
      const out = {};
      LAYERS.forEach(function (name) {
        const l = MapView.layer(map, name);
        out[name] = l ? l.data.slice() : new Array(n).fill(0);
      });
      // 1. Layers shown only sometimes
      map.layers.forEach(function (l) {
        if (l.type !== 'tilelayer' || prop(l, 'when') === undefined) return;
        const target = out[prop(l, 'target', 'ground')];
        if (!target) return;
        // ctx.layers (the map maker): show just these layers, whatever their conditions.
        if (ctx.layers ? ctx.layers.indexOf(l.name) === -1 : !MapView.conditionMet(prop(l, 'when'), ctx)) return;
        for (let i = 0; i < n; i++) if (l.data[i]) target[i] = l.data[i];
      });
      // 2. The sea at this tide
      const tide = MapView.layer(map, 'tide'), first = MapView.tideFirstGid(map);
      if (tide && first && ctx.tide !== undefined && ctx.tide !== null) {
        const water = (FS.Tiles.autotiles || {})[prop(map, 'tideWater', '') || 'ocean'];
        if (water) {
          for (let i = 0; i < n; i++) {
            const height = tide.data[i] - first + 1;
            if (height >= 1 && height <= 5 && height <= ctx.tide + 1) out.ground[i] = water.base + 1;
          }
        }
      }
      // 3. The season's swap rules
      const swaps = (FS.Tiles.swaps || {})[ctx.season];
      if (swaps) {
        LAYERS.forEach(function (name) {
          const d = out[name];
          for (let i = 0; i < n; i++) {
            const to = d[i] ? swaps[index(d[i])] : undefined;
            if (to !== undefined) d[i] = withIndex(d[i], to);
          }
        });
      }
      // 4. Autotiles: the right piece for the neighbours
      const fam = families();
      if (Object.keys(fam).length) {
        LAYERS.forEach(function (name) {
          const d = out[name], src = d.slice();
          for (let i = 0; i < n; i++) {
            const f = src[i] ? fam[index(src[i])] : undefined;
            if (!f) continue;
            const x = i % w, y = (i - x) / w;
            let mask = 0;
            for (let k = 0; k < 8; k++) {
              const nx = x + NEIGHBOURS[k][0], ny = y + NEIGHBOURS[k][1];
              // Off the map counts as the same, so water reaches the map's edge without a shore.
              if (nx < 0 || ny < 0 || nx >= w || ny >= h || (src[ny * w + nx] && fam[index(src[ny * w + nx])] === f)) mask |= NEIGHBOURS[k][2];
            }
            d[i] = FS.Tiles.autotiles[f].table[mask] + 1;
          }
        });
      }
      return out;
    },

    /** Is this tile number part of an autotile (water)? */
    isAutotile: function (idx) { return families()[idx] !== undefined; },

    /**
     * Where shore foam goes: water squares (ground autotile tiles) next to land, every third square
     * along a shore. Returns [{x, y, side}] with side = where the land is (north, south, east, west);
     * the foam sits in the water square, against that side.
     */
    shoreFoam: function (view, width, height) {
      const fam = families(), d = view.ground, out = [];
      const water = function (x, y) {
        if (x < 0 || y < 0 || x >= width || y >= height) return true;
        const g = d[y * width + x];
        return !!g && fam[index(g)] !== undefined;
      };
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!water(x, y)) continue;
          if (x % 3 === 1 && !water(x, y + 1)) out.push({ x: x, y: y, side: 'south' });
          if (x % 3 === 1 && !water(x, y - 1)) out.push({ x: x, y: y, side: 'north' });
          if (y % 3 === 1 && !water(x + 1, y)) out.push({ x: x, y: y, side: 'east' });
          if (y % 3 === 1 && !water(x - 1, y)) out.push({ x: x, y: y, side: 'west' });
        }
      }
      return out;
    },

    /** Turn a gid into Phaser's tile settings: {index (gid without flags), flipX, rotation}. */
    tileTransform: function (g) {
      const hz = !!(g & 0x80000000), vt = !!(g & 0x40000000), dg = !!(g & 0x20000000);
      let rotation = 0, flipX = false;
      // The same table as Phaser's Tiled parser (ParseGID).
      if (hz && vt && dg) { rotation = Math.PI / 2; flipX = true; }
      else if (hz && vt) { rotation = Math.PI; }
      else if (hz && dg) { rotation = Math.PI / 2; }
      else if (hz) { flipX = true; }
      else if (vt && dg) { rotation = 3 * Math.PI / 2; }
      else if (vt) { rotation = Math.PI; flipX = true; }
      else if (dg) { rotation = 3 * Math.PI / 2; flipX = true; }
      return { index: (g & MASK) >>> 0, flipX: flipX, rotation: rotation };
    }
  };

  FS.MapView = MapView;
})(FarmSim);
