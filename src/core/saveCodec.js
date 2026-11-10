/**
 * saveCodec.js
 * ============
 * Turns the game state into a compact text string (and back) that fits in
 * SCORM 1.2's 4096-character cmi.suspend_data.
 *
 * HOW IT STAYS SMALL
 *   - Each value uses only the bits it needs (see the LAYOUT below).
 *   - Only things that can't be recalculated are stored (no weather, no map
 *     data, no text - only numbers and IDs).
 *   - Farm tiles use a variable size: untilled ground costs 1 bit; an empty
 *     heap 7 bits; a planted heap 12 bits.
 *
 * FORMAT VERSIONS
 *   The first byte is the format version. When you change the layout:
 *     1. Increase VERSION and teach encode() the new layout.
 *     2. Teach decode() to read the new version, and KEEP reading the old
 *        ones (old saves must always load). upgrade() then fills in anything
 *        an older save didn't have.
 *
 * LAYOUT (bits per field). Fields marked [v2] were added in version 2.
 *   version 8 | seed 32 | day 16 | time 11
 *   v1 only: money 24
 *   shipped 20 | energy 7
 *   hasPos 1 [area 4 | x 8 | y 8 | facing 2]
 *   selected 4 | slots 5 | per slot: itemId 8 [qty 7 if itemId > 0]
 *   farmCols 6 | farmRows 6 | per tile: tilled 1 [watered 1 | crop 5 [growth 5 if crop > 0]]
 *   npcCount-1 6 | per npc: friendship 10 | talked 1 | gifted 1
 *   flagCount 8 | per flag: 1
 *   [v2] currencyCount 4 | per currency: amount 24
 *   [v2] hasLook 1 [body 2 | skin 4 | hair 5 | hairColor 4 | outfit 8]
 *   [v2] outfitCount 8 | per outfit: owned 1
 *   ...then a 16-bit CRC checksum of everything above.
 *
 * Run `node tests/run-tests.js` to see the worst-case size of a save.
 */
(function (FS) {
  'use strict';

  const BP = FS.BitPack;
  const VERSION = 2;

  // Largest value each field can hold. Game code clamps to these.
  const LIMITS = {
    day: 65535, time: 2047, money: 16777215, shipped: 1048575, energy: 127,
    tileXY: 255, slots: 31, qty: 127, farmSide: 63, growth: 31, friendship: 1023,
    npcs: 64, flags: 255, currencies: 15, outfits: 255
  };

  function clamp(v, max) { return Math.max(0, Math.min(max, Math.floor(v || 0))); }

  // ------------------------------------------------------------------ encode
  function encode(state) {
    const w = new BP.BitWriter();
    const A = FS.Appearance;
    w.write(VERSION, 8);
    w.write(state.seed >>> 0, 32);
    w.write(clamp(state.day, LIMITS.day), 16);
    w.write(clamp(state.time, LIMITS.time), 11);
    w.write(clamp(state.shipped, LIMITS.shipped), 20);
    w.write(clamp(state.energy, LIMITS.energy), 7);

    // Player position (only during a mid-day save)
    w.writeBool(!!state.pos);
    if (state.pos) {
      w.write(FS.Areas.get(state.pos.area).id, 4);
      w.write(clamp(state.pos.x, LIMITS.tileXY), 8);
      w.write(clamp(state.pos.y, LIMITS.tileXY), 8);
      w.write(Math.max(0, FS.State.FACINGS.indexOf(state.pos.facing)), 2);
    }

    // Inventory
    w.write(clamp(state.selected, 15), 4);
    w.write(clamp(state.inventory.length, LIMITS.slots), 5);
    state.inventory.slice(0, LIMITS.slots).forEach(function (slot) {
      if (!slot) { w.write(0, 8); return; }
      w.write(slot.id, 8);
      w.write(clamp(slot.qty, LIMITS.qty), 7);
    });

    // Farm field
    const farm = state.farm;
    w.write(clamp(farm.cols, LIMITS.farmSide), 6);
    w.write(clamp(farm.rows, LIMITS.farmSide), 6);
    for (let i = 0; i < farm.cols * farm.rows; i++) {
      const t = farm.tiles[i];
      w.writeBool(t.tilled);
      if (!t.tilled) continue;
      w.writeBool(t.watered);
      w.write(t.crop, 5);
      if (t.crop !== FS.CROP_NONE) w.write(clamp(t.growth, LIMITS.growth), 5);
    }

    // Villagers. Stored as (count - 1) so 6 bits cover 1-64 villagers.
    w.write(clamp(state.npcs.length, LIMITS.npcs) - 1, 6);
    state.npcs.slice(0, LIMITS.npcs).forEach(function (n) {
      w.write(clamp(n.friend, LIMITS.friendship), 10);
      w.writeBool(n.talked);
      w.writeBool(n.gifted);
    });

    // Story flags
    w.write(clamp(state.flags.length, LIMITS.flags), 8);
    state.flags.slice(0, LIMITS.flags).forEach(function (f) { w.writeBool(f); });

    // [v2] Wallet: one amount per currency
    w.write(clamp(state.wallet.length, LIMITS.currencies), 4);
    state.wallet.slice(0, LIMITS.currencies).forEach(function (n) { w.write(clamp(n, LIMITS.money), 24); });

    // [v2] Player look
    w.writeBool(!!state.look);
    if (state.look) {
      w.write(A.bodies.get(state.look.body).id, 2);
      w.write(A.skins.get(state.look.skin).id, 4);
      w.write(A.hairs.get(state.look.hair).id, 5);
      w.write(A.hairColors.get(state.look.hairColor).id, 4);
      w.write(A.outfits.get(state.look.outfit).id, 8);
    }

    // [v2] Outfits owned
    w.write(clamp(state.outfits.length, LIMITS.outfits), 8);
    state.outfits.slice(0, LIMITS.outfits).forEach(function (o) { w.writeBool(o); });

    // Checksum
    const bytes = w.finish();
    const crc = BP.crc16(bytes);
    bytes.push(crc >> 8, crc & 255);
    return BP.bytesToBase64url(bytes);
  }

  // ------------------------------------------------------------------ decode
  function decode(text) {
    if (!text) throw new Error('empty save');
    const bytes = BP.base64urlToBytes(text);
    if (bytes.length < 3) throw new Error('save too short');
    const body = bytes.slice(0, bytes.length - 2);
    const crc = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
    if (BP.crc16(body) !== crc) throw new Error('save checksum mismatch (damaged or cut off)');

    const r = new BP.BitReader(body);
    const version = r.read(8);
    if (version === 1 || version === 2) return upgrade(read(r, version));
    throw new Error('unknown save version ' + version + ' (made by a newer game?)');
  }

  /** Read versions 1 and 2 (they share most of the layout). */
  function read(r, version) {
    const A = FS.Appearance;
    const s = {};
    s.seed = r.read(32) >>> 0;
    s.day = r.read(16);
    s.time = r.read(11);
    s.wallet = [];
    if (version === 1) s.wallet[0] = r.read(24);   // v1 had a single "money" amount
    s.shipped = r.read(20);
    s.energy = r.read(7);

    s.pos = null;
    if (r.readBool()) {
      const area = FS.Areas.byId(r.read(4));
      const x = r.read(8), y = r.read(8);
      const facing = FS.State.FACINGS[r.read(2)];
      // If the area was removed in an update, the player just wakes up at home.
      if (area) s.pos = { area: area.key, x: x, y: y, facing: facing };
    }

    s.selected = r.read(4);
    const slots = r.read(5);
    s.inventory = [];
    for (let i = 0; i < slots; i++) {
      const id = r.read(8);
      if (id === 0) { s.inventory.push(null); continue; }
      const qty = r.read(7);
      // Unknown item (removed in an update)? Drop it rather than crash.
      s.inventory.push(FS.Items.byId(id) ? { id: id, qty: qty } : null);
    }

    const cols = r.read(6), rows = r.read(6);
    s.farm = { cols: cols, rows: rows, tiles: [] };
    for (let i = 0; i < cols * rows; i++) {
      const t = FS.State.emptyFarmTile();
      t.tilled = r.readBool();
      if (t.tilled) {
        t.watered = r.readBool();
        t.crop = r.read(5);
        if (t.crop !== FS.CROP_NONE) t.growth = r.read(5);
      }
      s.farm.tiles.push(t);
    }

    const npcCount = r.read(6) + 1;
    s.npcs = [];
    for (let i = 0; i < npcCount; i++) {
      s.npcs.push({ friend: r.read(10), talked: r.readBool(), gifted: r.readBool() });
    }

    const flagCount = r.read(8);
    s.flags = [];
    for (let i = 0; i < flagCount; i++) s.flags.push(r.readBool());

    s.look = null;
    s.outfits = [];
    if (version >= 2) {
      const currencies = r.read(4);
      for (let i = 0; i < currencies; i++) s.wallet[i] = r.read(24);

      if (r.readBool()) {
        const body = A.bodies.byId(r.read(2)), skin = A.skins.byId(r.read(4)), hair = A.hairs.byId(r.read(5));
        const hairColor = A.hairColors.byId(r.read(4)), outfit = A.outfits.byId(r.read(8));
        const d = A.defaultLook();
        // Any part removed in an update falls back to the default.
        s.look = {
          body: body ? body.key : d.body, skin: skin ? skin.key : d.skin, hair: hair ? hair.key : d.hair,
          hairColor: hairColor ? hairColor.key : d.hairColor, outfit: outfit ? outfit.key : d.outfit
        };
      }
      const outfits = r.read(8);
      for (let i = 0; i < outfits; i++) s.outfits.push(r.readBool());
    }
    return s;
  }

  /**
   * Bring a decoded save up to date with the CURRENT data tables, for example
   * after an update added villagers, flags, currencies, outfits or inventory
   * slots, or changed the size of the field.
   */
  function upgrade(s) {
    const fresh = FS.State.newGame(s.seed);

    while (s.inventory.length < fresh.inventory.length) s.inventory.push(null);
    while (s.npcs.length < fresh.npcs.length) s.npcs.push({ friend: 0, talked: false, gifted: false });
    while (s.flags.length < fresh.flags.length) s.flags.push(false);
    while (s.wallet.length < fresh.wallet.length) s.wallet.push(0);
    while (s.outfits.length < fresh.outfits.length) s.outfits.push(false);
    if (s.selected >= s.inventory.length) s.selected = 0;

    // Field size changed? Copy the old field into the top-left of the new one.
    if (s.farm.cols !== fresh.farm.cols || s.farm.rows !== fresh.farm.rows) {
      for (let r = 0; r < Math.min(s.farm.rows, fresh.farm.rows); r++) {
        for (let c = 0; c < Math.min(s.farm.cols, fresh.farm.cols); c++) {
          fresh.farm.tiles[r * fresh.farm.cols + c] = s.farm.tiles[r * s.farm.cols + c];
        }
      }
      s.farm = fresh.farm;
    }

    // A crop removed in an update becomes withered instead of crashing.
    s.farm.tiles.forEach(function (t) {
      if (t.crop !== FS.CROP_NONE && t.crop !== FS.CROP_WITHERED && !FS.Crops.byId(t.crop)) {
        t.crop = FS.CROP_WITHERED;
      }
    });
    return s;
  }

  FS.SaveCodec = {
    VERSION: VERSION,
    LIMITS: LIMITS,
    encode: encode,
    decode: decode
  };
})(FarmSim);
