/**
 * crops.js
 * ========
 * Every plantable crop.
 *
 *   id          permanent save ID, 1-30 (0 = no crop, 31 = withered crop).
 *   seasons     which seasons it grows in. At a season change, crops that
 *               can't grow in the new season wither.
 *   growDays    days of WATERING needed to ripen (max 30). A day without water
 *               means no growth that day. Rain waters everything.
 *   regrowDays  0 = plant is removed on harvest. Otherwise it stays and is
 *               ripe again after this many more watered days (like okra).
 *   produce     item key given on harvest, and how many (yield).
 *
 * Each crop's 4 growth-stage pictures (seed, sprout, growing, ripe) are made
 * by tools/build_assets.py, which records where they are in
 * FarmSim.Tiles.CROP_FIRST (generated tiles.js).
 *
 * Grow times are shortened for gameplay; real cassava takes most of a year.
 */
(function (FS) {
  'use strict';

  FS.CROP_NONE = 0;
  FS.CROP_WITHERED = 31;

  FS.Crops = FS.makeRegistry('Crops', [
    { id: 1, key: 'maize',      seasons: ['rainy'],        growDays: 5,  regrowDays: 0, produce: 'maize',      yield: 1 },
    { id: 2, key: 'groundnut',  seasons: ['rainy'],        growDays: 7,  regrowDays: 0, produce: 'groundnut',  yield: 2 },
    { id: 3, key: 'krainkrain', seasons: ['rainy', 'dry'], growDays: 3,  regrowDays: 2, produce: 'krainkrain', yield: 1 },
    { id: 4, key: 'pepper',     seasons: ['dry'],          growDays: 6,  regrowDays: 3, produce: 'pepper',     yield: 2 },
    { id: 5, key: 'cassava',    seasons: ['rainy', 'dry'], growDays: 12, regrowDays: 0, produce: 'cassava',    yield: 3 }
  ], 30);
})(FarmSim);
