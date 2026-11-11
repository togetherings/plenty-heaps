/**
 * gameState.js
 * ============
 * The game's MODEL: everything that must survive between sessions, plus
 * helpers to read and change it. It contains no drawing or Phaser code.
 *
 * Rule of thumb: if it's in `state`, it's in the save file (see saveCodec.js).
 * If it can be worked out from other data (today's weather, crop pictures,
 * NPC positions), it is NOT stored - it's recalculated.
 *
 * Shape of the state object:
 *   {
 *     seed       world seed (weather and other randomness come from this)
 *     day        days since the game started (0 = first day)
 *     time       minutes since midnight (360 = 06:00)
 *     wallet     money: an amount per currency, index = currency id
 *                (use FarmSim.Wallet to read/change it)
 *     shipped    cowries owed for the shipping bin, paid out overnight
 *     energy     0..MAX_ENERGY
 *     pos        where the player is mid-day: {area, x, y, facing} in tiles,
 *                or null = wake up at home (start of day)
 *     selected   index of the selected hotbar slot
 *     inventory  array of {id, qty} or null for empty slots
 *     farm       {cols, rows, tiles: [{tilled, watered, crop, growth}]}
 *     npcs       per villager id: {friend, talked, gifted}
 *     flags      array of booleans, index = flag id
 *     look       how the player looks {body, skin, hair, hairColor, outfit}
 *                (keys from data/appearance.js), or null = not created yet
 *     outfits    outfits the player owns: array of booleans, index = outfit id
 *   }
 */
(function (FS) {
  'use strict';

  const C = FS.Config;
  const FACINGS = ['down', 'up', 'left', 'right'];

  function emptyFarmTile() {
    return { tilled: false, watered: false, crop: FS.CROP_NONE, growth: 0 };
  }

  const State = {
    FACINGS: FACINGS,

    /** Create a fresh game. */
    newGame: function (seed) {
      const plot = FS.Areas.farmland();
      const state = {
        seed: seed === undefined ? FS.Rng.newSeed() : seed,
        day: 0,
        time: C.DAY_START_MIN,
        wallet: [],
        shipped: 0,
        energy: C.MAX_ENERGY,
        pos: null,
        selected: 0,
        inventory: [],
        farm: { cols: plot.cols, rows: plot.rows, tiles: [] },
        npcs: [],
        flags: [],
        look: null,
        outfits: []
      };
      for (let i = 0; i <= FS.Currencies.highestId; i++) state.wallet.push(0);
      Object.keys(C.START_WALLET).forEach(function (k) { FS.Wallet.add(state, k, C.START_WALLET[k]); });
      for (let i = 0; i <= FS.Appearance.outfits.highestId; i++) state.outfits.push(false);
      for (let i = 0; i < C.INVENTORY_SLOTS; i++) state.inventory.push(null);
      for (let i = 0; i < plot.cols * plot.rows; i++) state.farm.tiles.push(emptyFarmTile());
      // One entry per villager / flag id in use. Adding villagers or flags in an
      // update simply makes these lists longer (see upgrade() in saveCodec.js).
      for (let i = 0; i <= FS.Npcs.highestId; i++) state.npcs.push({ friend: 0, talked: false, gifted: false });
      for (let i = 0; i <= FS.Flags.highestId; i++) state.flags.push(false);
      C.START_ITEMS.forEach(function (pair) { State.addItem(state, pair[0], pair[1]); });
      // If it rains on the very first day, the field (still untilled) needs nothing.
      return state;
    },

    emptyFarmTile: emptyFarmTile,

    // ---------------------------------------------------------------- calendar
    /** Season, day of season, day of year and year for the current day (calendar.js). */
    calendar: function (state) { return FS.Calendar.of(state.day); },

    /** Is it raining right now? Worked out from the seed, never saved (weather.js). */
    isRaining: function (state) { return FS.Weather.isRainingAt(state.seed, state.day, state.time); },

    /** Has today's rain watered the crops yet (4 hours of rain, storms counting double)? */
    rainHasWatered: function (state) { return FS.Weather.watered(state.seed, state.day, state.time); },

    /** "06:30" style clock text. */
    clockText: function (minutes) {
      const h = Math.floor(minutes / 60) % 24;
      const m = Math.floor(minutes % 60);
      return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    },

    // --------------------------------------------------------------- inventory
    /**
     * Add items, stacking onto existing stacks first, then empty slots.
     * Returns how many did NOT fit (0 = all added).
     */
    addItem: function (state, key, qty) {
      const item = FS.Items.get(key);
      let left = qty;
      const inv = state.inventory;
      for (let i = 0; i < inv.length && left > 0; i++) {
        if (inv[i] && inv[i].id === item.id && inv[i].qty < C.MAX_STACK) {
          const add = Math.min(left, C.MAX_STACK - inv[i].qty);
          inv[i].qty += add;
          left -= add;
        }
      }
      for (let i = 0; i < inv.length && left > 0; i++) {
        if (!inv[i]) {
          const add = Math.min(left, C.MAX_STACK);
          inv[i] = { id: item.id, qty: add };
          left -= add;
        }
      }
      return left;
    },

    /** Would `qty` of this item fit in the bag? */
    canFit: function (state, key, qty) {
      const item = FS.Items.get(key);
      let space = 0;
      state.inventory.forEach(function (s) {
        if (!s) space += C.MAX_STACK;
        else if (s.id === item.id) space += C.MAX_STACK - s.qty;
      });
      return space >= qty;
    },

    /** Remove `qty` from one slot; clears the slot when it reaches zero. */
    removeFromSlot: function (state, slot, qty) {
      const s = state.inventory[slot];
      if (!s) return;
      s.qty -= qty;
      if (s.qty <= 0) state.inventory[slot] = null;
    },

    /** The item definition in the selected slot, or null. */
    selectedItem: function (state) {
      const s = state.inventory[state.selected];
      return s ? FS.Items.byId(s.id) : null;
    },

    // ------------------------------------------------------------------- flags
    getFlag: function (state, key) { return !!state.flags[FS.Flags.get(key).id]; },
    setFlag: function (state, key, value) { state.flags[FS.Flags.get(key).id] = value !== false; },

    // -------------------------------------------------------------------- npcs
    npc: function (state, key) { return state.npcs[FS.Npcs.get(key).id]; },

    // ------------------------------------------------------------------ looks
    /** Set the player's look, and mark its outfit as owned. */
    setLook: function (state, look) {
      state.look = {
        body: look.body, skin: look.skin, hair: look.hair, hairColor: look.hairColor, outfit: look.outfit
      };
      state.outfits[FS.Appearance.outfits.get(look.outfit).id] = true;
    }
  };

  /**
   * Money helpers. Always go through these rather than touching
   * state.wallet directly, so every currency works the same way.
   */
  FS.Wallet = {
    get: function (state, currency) {
      return state.wallet[FS.Currencies.get(currency || FS.Currencies.MAIN).id] || 0;
    },
    add: function (state, currency, amount) {
      const id = FS.Currencies.get(currency || FS.Currencies.MAIN).id;
      state.wallet[id] = Math.max(0, Math.min(FS.Currencies.MAX, (state.wallet[id] || 0) + Math.floor(amount)));
    },
    /** Take money if there is enough. Returns true if paid. */
    spend: function (state, currency, amount) {
      if (FS.Wallet.get(state, currency) < amount) return false;
      FS.Wallet.add(state, currency, -amount);
      return true;
    },
    /** "15 cowries" / "1 cowrie" in the current language. */
    format: function (currency, amount) {
      const key = currency || FS.Currencies.MAIN;
      return FS.t(amount === 1 ? 'money_' + key + '_one' : 'money_' + key, { n: amount });
    }
  };

  FS.State = State;
})(FarmSim);
