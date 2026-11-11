#!/usr/bin/env node
/**
 * run-tests.js
 * ============
 * Automated checks for the parts of the game that don't need a screen:
 * the save format, the farming rules, the overnight day logic, the calendar,
 * rain, sun, moon and tides, and how maps look (seasons, rain, tide, autotiles).
 *
 * Run from the project folder:   node tests/run-tests.js
 *
 * The most important test is "worst-case save fits in SCORM 1.2": it builds
 * the biggest possible save (every slot full, every tile planted, every flag
 * set) and checks it is under 4096 characters. Run the tests after changing
 * the save layout, the field size, or the number of villagers/flags/slots.
 */
'use strict';
const path = require('path');
const assert = require('assert');

// Load the game's engine-independent files in the same order as index.html.
const SRC = path.join(__dirname, '..', 'src');
[
  'namespace.js', 'config.js',
  'core/bitpack.js', 'core/rng.js', 'core/calendar.js',
  'data/registry.js', 'data/tiles.js', 'data/crops.js', 'data/items.js',
  'data/npcs.js', 'data/flags.js', 'data/currencies.js', 'data/appearance.js',
  'data/maps.js', 'data/areas.js', 'data/strings.js',
  'core/weather.js', 'core/sky.js', 'core/mapView.js',
  'core/gameState.js', 'core/farming.js', 'core/day.js',
  'core/saveCodec.js', 'core/storage.js', 'core/session.js', 'core/charRecolor.js'
].forEach(f => require(path.join(SRC, f)));

const FS = global.FarmSim;
const C = FS.Config;
let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

/** Find a seed whose first day does (or doesn't) get any rain, to make tests predictable. */
function seedWithRain(day0Rain) {
  for (let s = 1; s < 10000; s++) if (FS.Weather.rainyDay(s, 0) === day0Rain) return s;
  throw new Error('no seed found');
}
/** A seed with no rain on any of the given days. */
function seedDryOn(days) {
  for (let s = 1; s < 100000; s++) if (days.every(d => !FS.Weather.rainyDay(s, d))) return s;
  throw new Error('no seed found');
}
const season = name => C.SEASONS.indexOf(name) * C.SEASON_DAYS;   // first day of a season (year 1)

console.log('\nBit packing');
test('bits round-trip, including full 32-bit values', () => {
  const w = new FS.BitPack.BitWriter();
  const vals = [[1, 1], [0, 1], [5, 3], [4294967295, 32], [123456, 17], [0, 8], [99, 7]];
  vals.forEach(v => w.write(v[0], v[1]));
  const r = new FS.BitPack.BitReader(w.finish());
  vals.forEach(v => assert.strictEqual(r.read(v[1]), v[0]));
});
test('writing a value too big for its bits throws', () => {
  assert.throws(() => new FS.BitPack.BitWriter().write(8, 3));
});
test('base64url round-trip for all byte lengths 0-20', () => {
  for (let n = 0; n <= 20; n++) {
    const bytes = []; for (let i = 0; i < n; i++) bytes.push((i * 37 + n) & 255);
    const text = FS.BitPack.bytesToBase64url(bytes);
    assert.ok(/^[A-Za-z0-9_-]*$/.test(text), 'only safe characters');
    assert.deepStrictEqual(FS.BitPack.base64urlToBytes(text), bytes);
  }
});

console.log('\nNew game');
test('new game has starting items and money', () => {
  const s = FS.State.newGame(42);
  assert.strictEqual(FS.Wallet.get(s, 'cowrie'), C.START_WALLET.cowrie);
  assert.strictEqual(s.look, null, 'new game has no look until the creation screen');
  assert.strictEqual(s.inventory.length, C.INVENTORY_SLOTS);
  assert.strictEqual(s.inventory[0].id, FS.Items.get('hoe').id);
  assert.strictEqual(s.farm.tiles.length, s.farm.cols * s.farm.rows);
  const plot = FS.Areas.farmland();
  assert.strictEqual(s.farm.cols, plot.cols);
});
test('every crop grows within the 5-bit growth limit', () => {
  FS.Crops.list.forEach(c => {
    assert.ok(c.growDays <= 30, c.key);
    assert.ok(c.regrowDays < c.growDays || c.regrowDays === 0, c.key + ' regrow');
    assert.ok(FS.Items.has(c.produce), c.key + ' produce item');
    [0, 1, 2, 3].forEach(st => assert.ok(typeof FS.Tiles.names['crop_' + c.key + '_' + st] === 'number',
      c.key + ' has growth pictures (the tiles crop_' + c.key + '_0 to _3)'));
    c.seasons.forEach(se => assert.ok(C.SEASONS.indexOf(se) !== -1, c.key + ': unknown season ' + se));
  });
});
test('every seed points to a real crop, every string exists', () => {
  FS.Items.list.forEach(i => {
    if (i.kind === 'seed') assert.ok(FS.Crops.has(i.crop), i.key);
    assert.notStrictEqual(FS.t('item_' + i.key), 'item_' + i.key, 'missing name for ' + i.key);
  });
  FS.Npcs.list.forEach(n => {
    assert.notStrictEqual(FS.t('npc_' + n.key), 'npc_' + n.key);
    Object.keys(n.lines).forEach(k => n.lines[k].forEach(line => assert.notStrictEqual(FS.t(line), line, line)));
  });
});
test('every warp in every map leads to a real area and spawn', () => {
  FS.Areas.list.forEach(area => {
    FS.Areas.objects(area.map).forEach(o => {
      if (FS.Areas.objType(o) !== 'warp') return;
      const target = FS.Areas.prop(o, 'target');
      assert.ok(FS.Areas.has(target), area.key + ': warp to unknown area ' + target);
      const spawn = FS.Areas.prop(o, 'spawn');
      assert.ok(FS.Areas.findObject(FS.Areas.get(target).map, 'spawn', spawn), area.key + ': missing spawn ' + spawn + ' in ' + target);
    });
  });
  assert.ok(FS.Areas.findObject(FS.Areas.get(FS.Areas.HOME.area).map, 'spawn', FS.Areas.HOME.spawn), 'home spawn');
});

console.log('\nFarming rules');
test('till, plant, water, grow, harvest maize', () => {
  const s = FS.State.newGame(seedWithRain(false));
  // Water by hand every day (rain may also water it - that's fine).
  assert.strictEqual(FS.Farming.plant(s, 0, 0, FS.Items.get('seed_maize')), 'need_tilled');
  assert.strictEqual(FS.Farming.till(s, 0, 0), 'tilled');
  assert.strictEqual(FS.Farming.plant(s, 0, 0, FS.Items.get('seed_maize')), 'planted');
  assert.strictEqual(FS.Farming.plant(s, 0, 0, FS.Items.get('seed_maize')), 'occupied');
  const maize = FS.Crops.get('maize');
  for (let d = 0; d < maize.growDays; d++) {
    FS.Farming.water(s, 0, 0);
    assert.ok(!FS.Farming.isRipe(FS.Farming.tile(s, 0, 0)));
    FS.Day.endDay(s);
  }
  assert.ok(FS.Farming.isRipe(FS.Farming.tile(s, 0, 0)), 'ripe after growDays watered days');
  const res = FS.Farming.harvest(s, 0, 0);
  assert.strictEqual(res.code, 'harvested');
  assert.strictEqual(FS.Farming.tile(s, 0, 0).crop, FS.CROP_NONE, 'maize does not regrow');
});
test('unwatered crops do not grow (in the dry season)', () => {
  const s = FS.State.newGame(1);
  s.day = season('harmattan');
  FS.Farming.till(s, 1, 1);
  FS.Farming.plant(s, 1, 1, FS.Items.get('seed_pepper'));
  s.farm.tiles.forEach(t => { t.watered = false; });
  const before = FS.Farming.tile(s, 1, 1).growth;
  FS.Farming.growOvernight(FS.Farming.tile(s, 1, 1));
  assert.strictEqual(FS.Farming.tile(s, 1, 1).growth, before);
});
test('wrong-season seeds cannot be planted', () => {
  const s = FS.State.newGame(1); // starts in First Rain
  FS.Farming.till(s, 2, 2);
  assert.strictEqual(FS.Farming.plant(s, 2, 2, FS.Items.get('seed_pepper')), 'wrong_season');
});
test('regrowing crop stays planted after harvest', () => {
  const s = FS.State.newGame(1);
  FS.Farming.till(s, 3, 3);
  FS.Farming.plant(s, 3, 3, FS.Items.get('seed_krainkrain'));
  const t = FS.Farming.tile(s, 3, 3);
  t.growth = FS.Crops.get('krainkrain').growDays;
  assert.strictEqual(FS.Farming.harvest(s, 3, 3).code, 'harvested');
  assert.strictEqual(t.crop, FS.Crops.get('krainkrain').id);
  assert.ok(!FS.Farming.isRipe(t));
});
test('season change withers out-of-season crops', () => {
  const s = FS.State.newGame(1);
  FS.Farming.till(s, 0, 0); FS.Farming.plant(s, 0, 0, FS.Items.get('seed_maize'));      // First Rain, Big Rain
  FS.Farming.till(s, 1, 0); FS.Farming.plant(s, 1, 0, FS.Items.get('seed_cassava'));    // every season
  s.day = season('bigrain') - 1;
  assert.strictEqual(FS.Day.endDay(s).newSeason, 'bigrain');
  assert.strictEqual(FS.Farming.tile(s, 0, 0).crop, FS.Crops.get('maize').id, 'maize grows on into Big Rain');
  s.day = season('harmattan') - 1;
  const sum = FS.Day.endDay(s);
  assert.strictEqual(sum.newSeason, 'harmattan');
  assert.strictEqual(FS.Farming.tile(s, 0, 0).crop, FS.CROP_WITHERED);
  assert.strictEqual(FS.Farming.tile(s, 1, 0).crop, FS.Crops.get('cassava').id);
  assert.strictEqual(FS.Farming.till(s, 0, 0), 'cleared', 'hoe clears withered plant');
});
test('shipping pays out overnight, energy restores', () => {
  const s = FS.State.newGame(1);
  s.shipped = 120; s.energy = 3;
  const sum = FS.Day.endDay(s);
  assert.strictEqual(sum.earned, 120);
  assert.strictEqual(FS.Wallet.get(s, 'cowrie'), C.START_WALLET.cowrie + 120);
  assert.strictEqual(s.energy, C.MAX_ENERGY);
});

console.log('\nCalendar and rain');
test('four seasons of 12 days, starting with First Rain', () => {
  assert.deepStrictEqual(C.SEASONS, ['firstrain', 'bigrain', 'harmattan', 'warm']);
  assert.strictEqual(FS.Calendar.yearDays(), 48);
  assert.deepStrictEqual(FS.Calendar.of(0), { seasonIndex: 0, season: 'firstrain', dayOfSeason: 1, dayOfYear: 1, year: 1 });
  assert.deepStrictEqual(FS.Calendar.of(30), { seasonIndex: 2, season: 'harmattan', dayOfSeason: 7, dayOfYear: 31, year: 1 });
  assert.strictEqual(FS.Calendar.of(48).year, 2);
});
test('rain comes in spells; the rainy seasons are much wetter than the dry ones', () => {
  const days = {};
  C.SEASONS.forEach(se => { days[se] = 0; });
  for (let seed = 1; seed <= 40; seed++) {
    for (let d = 0; d < 48; d++) {
      const spells = FS.Weather.spells(seed, d);
      spells.forEach(sp => {
        assert.ok(sp.start >= 0 && sp.end <= 1440 && sp.end > sp.start, 'spell inside the day');
        assert.strictEqual(sp.start % 10, 0, 'starts on a 10-minute mark');
      });
      if (spells.length) days[FS.Calendar.season(d)]++;
    }
  }
  const pct = se => days[se] / (40 * 12);
  assert.ok(pct('firstrain') > 0.45 && pct('firstrain') < 0.75, 'First Rain ' + pct('firstrain'));
  assert.ok(pct('bigrain') > 0.75, 'Big Rain ' + pct('bigrain'));
  assert.ok(pct('harmattan') < 0.1, 'Harmattan ' + pct('harmattan'));
  assert.ok(pct('warm') < 0.25, 'Warm Season ' + pct('warm'));
  // Dry-season rain is always short, so it never waters the crops.
  for (let seed = 1; seed <= 300; seed++) {
    for (let d = season('harmattan'); d < season('warm'); d++) assert.ok(!FS.Weather.watered(seed, d), 'harmattan rain waters');
  }
});
test('rain waters the field only after 4 hours (storms count double)', () => {
  const W = FS.Weather;
  // A made-up day: a 3-hour shower, then a 30-minute storm.
  const spells = W.spells, key = [];
  W.spells = () => [{ start: 600, end: 780, heavy: false }, { start: 900, end: 930, heavy: true }];
  try {
    assert.strictEqual(W.rainMinutes(1, 5, 700), 100);
    assert.ok(!W.watered(1, 5, 899), '3 hours is not enough');
    assert.ok(!W.watered(1, 5, 915), '3 h 30 min (a storm counts double) is not enough yet');
    assert.ok(W.watered(1, 5, 930), '3 h + 30 min of storm = 4 h');
    assert.ok(W.isRainingAt(1, 5, 700) && !W.isRainingAt(1, 5, 800));
    // The field: watered by the day's rain, even after bedtime
    const s = FS.State.newGame(1); s.day = 5; s.time = 700;
    FS.Farming.till(s, 0, 0);
    assert.ok(!FS.Farming.tile(s, 0, 0).watered, 'not yet');
    FS.Farming.plant(s, 0, 0, FS.Items.get('seed_cassava'));
    FS.Day.endDay(s);
    assert.strictEqual(FS.Farming.tile(s, 0, 0).growth, 1, 'grew: the rain (after bedtime) watered it');
  } finally { W.spells = spells; }
});

console.log('\nSun, moon and tides');
test('sunrise and sunset at Lungi, to the minute (DESIGN.md)', () => {
  const hm = m => { const r = Math.round(m); return String(Math.floor(r / 60)).padStart(2, '0') + ':' + String(r % 60).padStart(2, '0'); };
  const table = {
    1: ['06:13', '06:35', '12:49', '19:03', '19:25'], 7: ['06:12', '06:35', '12:54', '19:13', '19:36'],
    13: ['06:23', '06:45', '12:59', '19:13', '19:35'], 19: ['06:22', '06:43', '12:46', '18:50', '19:10'],
    25: ['06:22', '06:43', '12:37', '18:30', '18:51'], 31: ['06:39', '07:02', '12:50', '18:39', '19:02'],
    37: ['06:51', '07:13', '13:06', '19:00', '19:21'], 43: ['06:36', '06:57', '13:00', '19:04', '19:25']
  };
  Object.keys(table).forEach(d => {
    const s = FS.Sky.sun(Number(d));
    assert.deepStrictEqual([s.firstLight, s.sunrise, s.noon, s.sunset, s.dark].map(hm), table[d], 'day of year ' + d);
  });
  assert.strictEqual(FS.Sky.light(6, 13 * 60), 1, 'midday is light');
  assert.strictEqual(FS.Sky.light(6, 22 * 60), 0, 'night is dark');
  const tw = FS.Sky.light(6, 19 * 60 + 25);
  assert.ok(tw > 0 && tw < 1, 'twilight is in between');
});
test('an 11-day moon; tides every 13 h 12 min, biggest at full and new moon', () => {
  assert.strictEqual(FS.Sky.moonAge(0, 0), 0, 'full at the start');
  assert.strictEqual(FS.Sky.moonLit(0, 0), 1);
  assert.ok(FS.Sky.moonLit(5, 12 * 60) < 0.01, 'new after 5 and a half days');
  assert.strictEqual(FS.Sky.moonAge(11, 0), 0, 'full again after 11 days');
  // High tides 13 h 12 min apart, 2 h 24 min later each day
  const h0 = FS.Sky.highTides(0), h1 = FS.Sky.highTides(1);
  assert.deepStrictEqual(h0, [0, 792]);
  assert.strictEqual(h1[0], 144, 'the next day\'s first high tide is 2 h 24 min later');
  assert.strictEqual(FS.Sky.tideLevel(0, 0), 4, 'high tide at full moon: level 4');
  assert.strictEqual(FS.Sky.tideLevel(0, 396), 0, 'low tide 6 h 36 min later: level 0');
  // Neaps at half moon: smaller range
  const neap = Math.abs(FS.Sky.tideHeight(2, 18 * 60)), spring = Math.abs(FS.Sky.tideHeight(0, 0));
  assert.ok(FS.Sky.tideRange(2, 18 * 60) < 0.8 && FS.Sky.tideRange(0, 0) > 1.2, 'neap ' + neap + ' spring ' + spring);
  // Up a creek: later and smaller
  assert.ok(FS.Sky.tideLevel(0, 0, { tideDelay: 0, tideSize: 0.5 }) <= 3, 'half-size tide never reaches the top level');
  assert.strictEqual(FS.Sky.tideHeight(0, 60, { tideDelay: 60, tideSize: 1 }), FS.Sky.tideHeight(0, 0));
});

console.log('\nHow maps look');
const T0 = FS.Tiles;
function testMap(w, h, extra) {
  const m = { width: w, height: h, layers: [], tilesets: [{ name: 'tiles', firstgid: 1 }, { name: 'collision', firstgid: 100001 }, { name: 'tide', firstgid: 100003 }], properties: [] };
  ['ground', 'decor', 'above'].forEach(n => m.layers.push({ name: n, type: 'tilelayer', data: new Array(w * h).fill(n === 'ground' ? T0.idx('grass') + 1 : 0) }));
  (extra || []).forEach(l => m.layers.push(l));
  return m;
}
test('layers shown only in the rain, a season or at a tide', () => {
  const MV = FS.MapView;
  assert.ok(MV.conditionMet('rain', { rain: true }) && !MV.conditionMet('rain', { rain: false }));
  assert.ok(MV.conditionMet('season:harmattan,warm', { season: 'warm' }) && !MV.conditionMet('season:harmattan', { season: 'warm' }));
  assert.ok(MV.conditionMet('tide:0-1', { tide: 1 }) && !MV.conditionMet('tide:0-1', { tide: 2 }) && !MV.conditionMet('tide:3', {}));
  assert.ok(MV.conditionMet('rain&night', { rain: true, night: true }) && !MV.conditionMet('rain&night', { rain: true }));
  const puddle = T0.idx('sand') + 1;
  const m = testMap(3, 2, [{ name: 'puddles', type: 'tilelayer', data: [0, puddle, 0, 0, 0, 0],
    properties: [{ name: 'when', value: 'rain' }, { name: 'target', value: 'ground' }] }]);
  assert.strictEqual(MV.build(m, { season: 'firstrain', rain: true }).ground[1], puddle);
  assert.strictEqual(MV.build(m, { season: 'firstrain', rain: false }).ground[1], T0.idx('grass') + 1);
});
test('season swap rules change tiles everywhere, keeping flips', () => {
  const m = testMap(2, 1);
  m.layers[0].data[1] = (0x80000000 + T0.idx('grass') + 1);          // flipped left-right
  const v = FS.MapView.build(m, { season: 'harmattan' });
  const to = T0.swaps.harmattan[T0.idx('grass')];
  assert.ok(to !== undefined, 'the Harmattan has a rule for grass');
  assert.strictEqual(v.ground[0], to + 1);
  assert.strictEqual(v.ground[1], 0x80000000 + to + 1, 'still flipped');
  assert.strictEqual(FS.MapView.build(m, { season: 'firstrain' }).ground[0], T0.idx('grass') + 1);
});
test('autotiles: 47 pieces, chosen by the neighbours; the sea follows the tide', () => {
  const ocean = T0.autotiles.ocean;
  assert.strictEqual(new Set(ocean.table).size, 47);
  assert.ok(ocean.table.every(i => T0.collides.indexOf(i) !== -1), 'water pieces are solid');
  const o = ocean.base + 1;
  const m = testMap(3, 3);
  [0, 1, 2].forEach(i => { m.layers[0].data[i] = o; });                // the top row is sea
  const v = FS.MapView.build(m, {});
  assert.strictEqual(v.ground[1], ocean.table[1 | 2 | 4 | 64 | 128] + 1, 'sea above (off the map), sea left and right, land below');
  assert.strictEqual(v.ground[4], T0.idx('grass') + 1, 'land stays land');
  // A tide layer: the middle row floods from level 1 (height 2), the bottom row only at level 4 (height 5)
  m.layers.push({ name: 'tide', type: 'tilelayer', data: [0, 0, 0, 100004, 100004, 100004, 100007, 100007, 100007] });
  const low = FS.MapView.build(m, { tide: 0 }), mid = FS.MapView.build(m, { tide: 2 }), high = FS.MapView.build(m, { tide: 4 });
  assert.ok(!FS.MapView.isAutotile(FS.MapView.index(low.ground[4])), 'low tide: dry');
  assert.ok(FS.MapView.isAutotile(FS.MapView.index(mid.ground[4])) && !FS.MapView.isAutotile(FS.MapView.index(mid.ground[7])), 'mid tide');
  assert.ok(FS.MapView.isAutotile(FS.MapView.index(high.ground[7])), 'high tide: all sea');
  // Foam sits on the water's edge, facing the land
  const foam = FS.MapView.shoreFoam(low, 3, 3);
  assert.deepStrictEqual(foam, [{ x: 1, y: 0, side: 'south' }]);
  assert.deepStrictEqual(FS.MapView.shoreFoam(high, 3, 3), [], 'no shore when it is all sea');
});
test('flip flags become Phaser rotations like Phaser\'s own Tiled reader', () => {
  const tt = FS.MapView.tileTransform;
  assert.deepStrictEqual(tt(5), { index: 5, flipX: false, rotation: 0 });
  assert.deepStrictEqual(tt(0x80000000 + 5), { index: 5, flipX: true, rotation: 0 });
  assert.deepStrictEqual(tt(0xA0000000 + 5), { index: 5, flipX: false, rotation: Math.PI / 2 });   // rotated right
  assert.deepStrictEqual(tt(0xC0000000 + 5), { index: 5, flipX: false, rotation: Math.PI });
});

console.log('\nSave format');
test('a played game round-trips exactly', () => {
  const s = FS.State.newGame(123456789);
  FS.Farming.till(s, 4, 2); FS.Farming.plant(s, 4, 2, FS.Items.get('seed_maize'));
  FS.Farming.till(s, 5, 2); FS.Farming.water(s, 5, 2);
  s.pos = { area: 'village', x: 21, y: 11, facing: 'left' };
  s.selected = 3; s.wallet[0] = 5432; s.shipped = 77; s.time = 845;
  FS.State.setLook(s, { body: 'f', skin: 's6', hair: 'cornrows', hairColor: 'auburn', outfit: 'farm_f' });
  FS.State.npc(s, 'kadi').friend = 230; FS.State.npc(s, 'kadi').talked = true;
  FS.State.setFlag(s, 'metKadi');
  const back = FS.SaveCodec.decode(FS.SaveCodec.encode(s));
  assert.deepStrictEqual(back, s);
});
test('start-of-day save (no position) round-trips', () => {
  const s = FS.State.newGame(9);
  FS.Day.endDay(s);
  assert.deepStrictEqual(FS.SaveCodec.decode(FS.SaveCodec.encode(s)), s);
});
test('a damaged save is rejected, not loaded', () => {
  const text = FS.SaveCodec.encode(FS.State.newGame(5));
  const damaged = text.substr(0, 10) + (text[10] === 'A' ? 'B' : 'A') + text.substr(11);
  assert.throws(() => FS.SaveCodec.decode(damaged), /checksum/);
  assert.throws(() => FS.SaveCodec.decode(text.substr(0, text.length - 6)));
});
test('WORST-CASE save fits in SCORM 1.2 (4096 chars)', () => {
  const s = FS.State.newGame(4294967295);
  s.day = 65535; s.time = 1439; s.wallet = s.wallet.map(() => FS.Currencies.MAX); s.shipped = FS.SaveCodec.LIMITS.shipped;
  FS.State.setLook(s, { body: 'f', skin: 's7', hair: 'elder', hairColor: 'violet', outfit: 'lappa_purple' });
  s.outfits = s.outfits.map(() => true);
  s.energy = C.MAX_ENERGY; s.pos = { area: 'village', x: 255, y: 255, facing: 'right' };
  s.inventory = s.inventory.map(() => ({ id: 255, qty: 99 }));
  s.farm.tiles.forEach(t => { t.tilled = true; t.watered = true; t.crop = 30; t.growth = 31; });
  s.npcs.forEach(n => { n.friend = 1000; n.talked = true; n.gifted = true; });
  s.flags = s.flags.map(() => true);
  const text = FS.SaveCodec.encode(s);
  const pct = Math.round(text.length / C.SCORM_MAX_CHARS * 100);
  console.log('       worst case: ' + text.length + ' chars (' + pct + '% of 4096), field ' +
    s.farm.cols + 'x' + s.farm.rows + ', ' + s.inventory.length + ' slots, ' +
    s.npcs.length + ' villagers, ' + s.flags.length + ' flags');
  const fresh = FS.SaveCodec.encode(FS.State.newGame(1));
  console.log('       new game:   ' + fresh.length + ' chars');
  assert.ok(text.length <= C.SCORM_MAX_CHARS, 'save too big: ' + text.length);
});
test('format headroom: even 64 villagers + 256 flags + 31 slots fit', () => {
  const s = FS.State.newGame(1);
  while (s.npcs.length < 64) s.npcs.push({ friend: 1000, talked: true, gifted: true });
  while (s.flags.length < 255) s.flags.push(true);
  while (s.inventory.length < 31) s.inventory.push({ id: 255, qty: 99 });
  while (s.wallet.length < 15) s.wallet.push(FS.Currencies.MAX);
  while (s.outfits.length < 255) s.outfits.push(true);
  s.farm.tiles.forEach(t => { t.tilled = true; t.watered = true; t.crop = 30; t.growth = 31; });
  const len = FS.SaveCodec.encode(s).length;
  console.log('       stretched worst case: ' + len + ' chars');
  assert.ok(len <= C.SCORM_MAX_CHARS);
});
test('loading an old save after adding villagers/flags/slots upgrades it', () => {
  const s = FS.State.newGame(3);
  const text = FS.SaveCodec.encode(s);
  // Simulate the game having grown since the save was made.
  const oldSlots = C.INVENTORY_SLOTS;
  C.INVENTORY_SLOTS = oldSlots + 2;
  try {
    const back = FS.SaveCodec.decode(text);
    assert.strictEqual(back.inventory.length, oldSlots + 2);
  } finally { C.INVENTORY_SLOTS = oldSlots; }
});

test('a VERSION 1 save (made by the first slice) still loads', () => {
  // Saved by the version-1 code: money 777, day 3, maize at field (2,1),
  // Aunty Kadi friendship 120, in the village at (12,13) facing left.
  const v1 = 'AQAGeTIAAy0AAGEgAAGSQYGwKAQIEBFBAsGAAAAAAAAYJAAAAMIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACPAAACoAA5g';
  const s = FS.SaveCodec.decode(v1);
  assert.strictEqual(FS.Wallet.get(s, 'cowrie'), 777, 'old money became cowries');
  assert.strictEqual(s.day, 3);
  assert.strictEqual(FS.State.npc(s, 'kadi').friend, 120);
  assert.ok(FS.State.getFlag(s, 'metKadi'));
  assert.deepStrictEqual(s.pos, { area: 'village', x: 12, y: 13, facing: 'left' });
  assert.strictEqual(FS.Farming.tile(s, 2, 1).crop, FS.Crops.get('maize').id);
  assert.strictEqual(s.look, null, 'old saves go to the creation screen once');
  assert.strictEqual(s.outfits.length, FS.Appearance.outfits.highestId + 1);
  // ...and re-saves as the current version
  const again = FS.SaveCodec.decode(FS.SaveCodec.encode(s));
  assert.deepStrictEqual(again, s);
});

console.log('\nMoney');
test('wallet: add, spend, never negative, plural text', () => {
  const s = FS.State.newGame(1);
  FS.Wallet.add(s, 'cowrie', 50);
  assert.ok(!FS.Wallet.spend(s, 'cowrie', 1000), 'cannot overspend');
  assert.ok(FS.Wallet.spend(s, 'cowrie', 250));
  assert.strictEqual(FS.Wallet.get(s, 'cowrie'), 0);
  assert.strictEqual(FS.Wallet.format('cowrie', 1), '1 cowrie');
  assert.strictEqual(FS.Wallet.format('cowrie', 7), '7 cowries');
  assert.strictEqual(FS.Wallet.get(s), 0, 'no currency named = cowries');
});

console.log('\nAppearance');
test('every look option has a name / valid colours', () => {
  const A = FS.Appearance;
  A.hairs.list.forEach(h => assert.notStrictEqual(FS.t('hair_' + h.key), 'hair_' + h.key, h.key));
  A.bodies.list.forEach(b => { assert.notStrictEqual(FS.t('body_' + b.key), 'body_' + b.key); assert.ok(A.outfits.has(b.defaultOutfit)); });
  A.skins.list.forEach(s => assert.strictEqual(s.colors.length, 3, s.key));
  A.hairColors.list.forEach(h => assert.strictEqual(h.colors.length, A.HAIR_KEYS.length, h.key));
  A.outfits.list.forEach(o => { assert.strictEqual(o.top.length, 3); assert.ok(o.onePiece || o.bottom.length === 3, o.key); });
  FS.Npcs.list.forEach(n => {
    ['body', 'skin', 'hair', 'hairColor', 'outfit'].forEach(f => assert.ok(
      ({ body: A.bodies, skin: A.skins, hair: A.hairs, hairColor: A.hairColors, outfit: A.outfits })[f].has(n.look[f]), n.key + ' ' + f));
  });
});
test('palette swap: skin above the neck, clothes below, outline kept', () => {
  const A = FS.Appearance;
  // A 48x32 strip (one row of 3 frames): fill with skin base, add an outline pixel.
  const w = 48, h = 32, px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px.set(A.SKIN_KEYS[1], i * 4); px[i * 4 + 3] = 255; }
  px.set([89, 59, 61], (5 * w + 5) * 4);
  const skin = A.skins.get('s0').colors, outfit = A.outfits.get('farm_m');
  FS.CharRecolor.body(px, w, skin, outfit);
  const at = (x, y) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
  assert.deepStrictEqual(at(3, 10), skin[1], 'head is skin');
  assert.deepStrictEqual(at(3, 23), outfit.top[1], 'chest is shirt');
  assert.deepStrictEqual(at(3, 28), outfit.bottom[1], 'legs are trousers');
  assert.deepStrictEqual(at(5, 5), [89, 59, 61], 'outline untouched');
  // middle frame bobs up a pixel: row 20 is already shirt there
  assert.deepStrictEqual(at(16 + 3, 20), outfit.top[1]);
  assert.deepStrictEqual(at(3, 20), skin[1]);
});

console.log('\nStorage');
test('SCORM storage uses suspend_data, sets suspend exit, refuses oversize', () => {
  const data = { 'cmi.core.lesson_status': 'not attempted', 'cmi.suspend_data': '' };
  const api = {
    LMSInitialize: () => 'true', LMSFinish: () => 'true', LMSCommit: () => 'true',
    LMSGetValue: k => data[k] || '',
    LMSSetValue: (k, v) => { data[k] = v; return 'true'; }
  };
  const st = new FS.Storage.ScormStorage(api);
  assert.strictEqual(data['cmi.core.lesson_status'], 'incomplete');
  assert.strictEqual(data['cmi.core.exit'], 'suspend');
  assert.ok(st.save('abc'));
  assert.strictEqual(st.load(), 'abc');
  assert.ok(!st.save('x'.repeat(4097)), 'oversize save refused');
  assert.strictEqual(st.load(), 'abc', 'previous save kept');
  // "abc" isn't a save the game can read: it's kept, not saved over (see the next test)
  FS.Session.start({ storage: st });
  assert.strictEqual(FS.Session.problem.kind, 'damaged');
  assert.ok(!FS.Session.save());
  assert.strictEqual(st.load(), 'abc', 'an unreadable save is never saved over');
  // Full session through SCORM
  data['cmi.suspend_data'] = '';
  FS.Session.start({ storage: st });
  FS.State.setFlag(FS.Session.state, C.COMPLETION_FLAG);
  assert.ok(FS.Session.save());
  assert.strictEqual(data['cmi.core.lesson_status'], 'completed');
  FS.Session.start({ storage: st });
  assert.ok(FS.State.getFlag(FS.Session.state, C.COMPLETION_FLAG), 'reloaded from SCORM');
});

test('with EduGame Kit: saves through the helper, completes once, loads its save', () => {
  const calls = [];
  global.EduGame = {
    save: t => { calls.push(['save', t]); return Promise.resolve(); },
    complete: () => calls.push(['complete'])
  };
  try {
    const first = FS.Storage.create({ platform: 'scorm', save: null });
    assert.ok(first instanceof FS.Storage.EduGameStorage);
    FS.Session.start({ storage: first });
    FS.State.setFlag(FS.Session.state, C.COMPLETION_FLAG);
    FS.Session.save(); FS.Session.save();
    assert.strictEqual(calls.filter(c => c[0] === 'complete').length, 1, 'complete() only once');
    const text = calls.filter(c => c[0] === 'save').pop()[1];
    assert.ok(typeof text === 'string' && text.length < 3900, 'a string under the helper limit');
    // Next time, the helper hands the save back in info.save
    FS.Session.start({ storage: FS.Storage.create({ platform: 'scorm', save: text }) });
    assert.ok(FS.State.getFlag(FS.Session.state, C.COMPLETION_FLAG), 'reloaded');
  } finally { delete global.EduGame; }
});

test('saving every few seconds only writes when something changed', () => {
  const st = new FS.Storage.MemoryStorage();
  let writes = 0;
  const save = st.save.bind(st);
  st.save = t => { writes++; return save(t); };
  FS.Session.start({ storage: st });
  FS.Session.saveIfChanged(); FS.Session.saveIfChanged();
  assert.strictEqual(writes, 1, 'nothing changed: no second write');
  FS.Session.state.shipped += 40;
  FS.Session.saveIfChanged();
  assert.strictEqual(writes, 2, 'something changed: saved');
});

test('a save the game cannot read is kept until the learner starts a new farm', () => {
  const BP = FS.BitPack;
  const st = new FS.Storage.MemoryStorage();
  const good = FS.SaveCodec.encode(FS.State.newGame());
  // Damaged: cut in half on its way
  st.text = good.slice(0, Math.floor(good.length / 2));
  FS.Session.start({ storage: st });
  assert.strictEqual(FS.Session.problem.kind, 'damaged');
  assert.ok(!FS.Session.save() && !FS.Session.saveIfChanged(), 'nothing is saved');
  assert.strictEqual(st.text, good.slice(0, Math.floor(good.length / 2)), 'the damaged save is kept');
  FS.Session.startNewFarm();
  assert.ok(FS.Session.save(), 'saving starts again after choosing a new farm');
  assert.ok(FS.SaveCodec.decode(st.text));
  // From a newer version of the game (an unknown version number, with a good checksum)
  const bytes = BP.base64urlToBytes(good).slice(0, -2);
  bytes[0] = 99;
  const crc = BP.crc16(bytes);
  const newer = BP.bytesToBase64url(bytes.concat([crc >> 8, crc & 255]));
  st.text = newer;
  FS.Session.start({ storage: st });
  assert.strictEqual(FS.Session.problem.kind, 'newer');
  assert.ok(!FS.Session.save());
  assert.strictEqual(st.text, newer, 'a save from a newer version is kept');
});

test('a save that cannot be read back is never written', () => {
  const st = new FS.Storage.MemoryStorage();
  FS.Session.start({ storage: st });
  assert.ok(FS.Session.save());
  const kept = st.text;
  const decode = FS.SaveCodec.decode;
  FS.SaveCodec.decode = function () { throw new Error('a bug in the codec'); };
  try {
    FS.Session.state.shipped += 40;
    assert.ok(!FS.Session.save(), 'refused');
    assert.strictEqual(st.text, kept, 'the last good save is kept');
    assert.strictEqual(FS.Session.lastSaveError, 'a bug in the codec');
  } finally { FS.SaveCodec.decode = decode; }
});

test('area ids up to 63 fit in the save (format 3)', () => {
  assert.strictEqual(FS.Areas.maxId, 63);
  const st = new FS.Storage.MemoryStorage();
  FS.Session.start({ storage: st });
  const fake = { id: 63, key: 'far_away', map: 'farm', outdoor: true };
  const byId = FS.Areas.byId, get = FS.Areas.get;
  FS.Areas.byId = id => (id === 63 ? fake : byId(id));
  FS.Areas.get = key => (key === 'far_away' ? fake : get(key));
  try {
    FS.Session.state.pos = { area: 'far_away', x: 200, y: 31, facing: 'left' };
    const back = FS.SaveCodec.decode(FS.SaveCodec.encode(FS.Session.state));
    assert.deepStrictEqual(back.pos, { area: 'far_away', x: 200, y: 31, facing: 'left' });
  } finally { FS.Areas.byId = byId; FS.Areas.get = get; }
});

test('every map is an area with its own id, and the house is a room', () => {
  assert.deepStrictEqual(FS.MapList.map(m => m.key).sort(), Object.keys(FS.Maps).sort());
  assert.strictEqual(new Set(FS.MapList.map(m => m.id)).size, FS.MapList.length);
  assert.strictEqual(FS.Areas.rooms('house').length, 1);
  assert.deepStrictEqual(FS.Areas.rooms('farm'), []);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed ? 1 : 0);
