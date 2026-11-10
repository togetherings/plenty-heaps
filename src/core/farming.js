/**
 * farming.js
 * ==========
 * The rules for working the field. Pure functions on the game state:
 * no drawing, so they can be unit-tested and reused (e.g. by a future
 * shopkeeping mode that needs to know what's growing).
 *
 * Coordinates (c, r) are column and row INSIDE the farmland rectangle,
 * starting at 0,0 in its top-left corner.
 *
 * Each action returns a short result code; the scene turns codes into
 * on-screen messages and sounds.
 */
(function (FS) {
  'use strict';

  const Farming = {
    /** The farm tile at (c, r), or null if outside the field. */
    tile: function (state, c, r) {
      const f = state.farm;
      if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return null;
      return f.tiles[r * f.cols + c];
    },

    /** Crop definition planted on a tile, or null (also null if withered). */
    cropOf: function (tile) {
      if (!tile || tile.crop === FS.CROP_NONE || tile.crop === FS.CROP_WITHERED) return null;
      return FS.Crops.byId(tile.crop);
    },

    isRipe: function (tile) {
      const crop = Farming.cropOf(tile);
      return !!crop && tile.growth >= crop.growDays;
    },

    /** Can this crop grow in the current season? */
    inSeason: function (state, crop) {
      return crop.seasons.indexOf(FS.State.calendar(state).season) !== -1;
    },

    // ----------------------------------------------------------------- actions
    /** Hoe: turn grass into tilled soil, or clear a withered plant. */
    till: function (state, c, r) {
      const t = Farming.tile(state, c, r);
      if (!t) return 'not_field';
      if (t.crop === FS.CROP_WITHERED) { t.crop = FS.CROP_NONE; t.growth = 0; return 'cleared'; }
      if (t.crop !== FS.CROP_NONE) return 'occupied';
      if (t.tilled) return 'nothing';
      t.tilled = true;
      // If it's raining, freshly tilled soil is wet straight away.
      if (FS.State.isRaining(state)) t.watered = true;
      return 'tilled';
    },

    /** Watering can: water tilled soil (planted or not). */
    water: function (state, c, r) {
      const t = Farming.tile(state, c, r);
      if (!t) return 'not_field';
      if (!t.tilled) return 'need_tilled';
      if (t.watered) return 'nothing';
      t.watered = true;
      return 'watered';
    },

    /** Plant a seed item on tilled, empty soil. */
    plant: function (state, c, r, seedItem) {
      const t = Farming.tile(state, c, r);
      if (!t) return 'not_field';
      if (!t.tilled) return 'need_tilled';
      if (t.crop !== FS.CROP_NONE) return 'occupied';
      const crop = FS.Crops.get(seedItem.crop);
      if (!Farming.inSeason(state, crop)) return 'wrong_season';
      t.crop = crop.id;
      t.growth = 0;
      return 'planted';
    },

    /**
     * Pick a ripe crop. Returns {code, item, qty}. Crops with regrowDays stay
     * planted and need that many more watered days.
     */
    harvest: function (state, c, r) {
      const t = Farming.tile(state, c, r);
      if (!Farming.isRipe(t)) return { code: 'not_ripe' };
      const crop = Farming.cropOf(t);
      if (!FS.State.canFit(state, crop.produce, crop.yield)) return { code: 'bag_full' };
      FS.State.addItem(state, crop.produce, crop.yield);
      if (crop.regrowDays > 0) {
        t.growth = crop.growDays - crop.regrowDays;
      } else {
        t.crop = FS.CROP_NONE;
        t.growth = 0;
      }
      return { code: 'harvested', item: crop.produce, qty: crop.yield };
    },

    /** Called overnight (see day.js) for each tile. */
    growOvernight: function (tile) {
      const crop = Farming.cropOf(tile);
      if (crop && tile.watered && tile.growth < crop.growDays) tile.growth++;
      tile.watered = false;
    },

    // ----------------------------------------------------------------- display
    /**
     * Which picture in tiles.png shows this tile's plant, or -1 for none.
     * Four stages: seed (just planted), sprout, growing, ripe.
     */
    plantFrame: function (tile) {
      if (tile.crop === FS.CROP_NONE) return -1;
      if (tile.crop === FS.CROP_WITHERED) return FS.Tiles.WITHERED;
      const crop = FS.Crops.byId(tile.crop);
      if (!crop) return -1;
      let stage;
      if (tile.growth >= crop.growDays) stage = 3;
      else if (tile.growth === 0) stage = 0;
      else stage = tile.growth * 2 < crop.growDays ? 1 : 2;
      return FS.Tiles.CROP_FIRST[crop.key] + stage;
    },

    /** Which picture shows the soil under it, or -1 for untilled ground. */
    soilFrame: function (tile) {
      if (!tile.tilled) return -1;
      return tile.watered ? FS.Tiles.SOIL_WET : FS.Tiles.SOIL;
    }
  };

  FS.Farming = Farming;
})(FarmSim);
