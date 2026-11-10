/**
 * strings.js
 * ==========
 * Every piece of text the player sees, so the game can be translated.
 *
 * Use in code:   FarmSim.t('msg_harvest', { n: 2, item: 'Maize' })
 * Placeholders in {curly braces} are filled from the second argument.
 *
 * TO ADD A LANGUAGE: add a block like `fr: { ... }` below with the same keys,
 * then set FarmSim.Strings.lang = 'fr'. Missing keys fall back to English.
 *
 * NOTE ON FONTS: the slice draws text with the device's own font. Local
 * languages (Krio, Temne, Mende, Susu...) and words with letters like ɛ, ɔ or ŋ
 * will need a custom pixel font that includes those letters.
 *
 * Krio words used here (please have a native speaker review):
 *   Kushe = hello, Tenki = thank you, How di bodi? = how are you?
 */
(function (FS) {
  'use strict';

  const en = {
    // ---- HUD ----
    season_rainy: 'Rainy season',
    season_dry: 'Dry season',
    hud_date: 'Day {day} - {season} - Year {year}',
    hud_money: '{n}',
    money_cowrie: '{n} cowries',
    money_cowrie_one: '{n} cowrie',
    weather_rain: 'Rain',
    weather_sun: 'Sun',

    // ---- Items ----
    item_hoe: 'Hoe',
    item_can: 'Watering can',
    item_seed_maize: 'Maize seed',
    item_seed_groundnut: 'Groundnut seed',
    item_seed_krainkrain: 'Krain krain seed',
    item_seed_pepper: 'Pepper seed',
    item_seed_cassava: 'Cassava cutting',
    item_maize: 'Maize',
    item_groundnut: 'Groundnut',
    item_krainkrain: 'Krain krain',
    item_pepper: 'Pepper',
    item_cassava: 'Cassava',

    // ---- Farming messages ----
    msg_no_energy: "You're too tired. Rest in your bed.",
    msg_need_tilled: 'Till the soil with the hoe first.',
    msg_occupied: 'Something is already growing here.',
    msg_wrong_season: "{item} won't grow in the {season}.",
    msg_harvest: 'Harvested {n} {item}!',
    msg_bag_full: 'Your bag is full.',
    msg_not_field: 'You can only farm inside your field.',

    // ---- Shipping ----
    msg_shipped: 'Shipped {n} {item}. You will get {price} tomorrow.',
    msg_ship_nothing: 'Hold a crop and use the bin to sell it.',
    msg_ship_cant: "{item} can't be sold.",

    // ---- Day / sleep ----
    sleep_prompt: 'Go to sleep? This ends the day and saves your game.',
    yes: 'Yes',
    no: 'No',
    morning: 'Good morning! Day {day} of the {season}.',
    morning_earned: 'You earned {money} from shipping.',
    morning_rain: "It's raining - your field is watered.",
    season_start: 'The {season} has begun! Some crops may wither.',
    passed_out: 'You stayed up too late and fell asleep where you stood...',
    saved: 'Game saved.',
    save_failed: 'Could not save the game!',

    // ---- Shop ----
    shop_seeds_title: "Pa Sorie's seeds - you have {money}",
    shop_item: '{item} - {price}',
    shop_off_season: '{item} - {price} (not this season)',
    shop_leave: 'Leave',
    shop_bought: 'Bought 1 {item}.',
    shop_no_money: "You don't have enough cowries.",

    // ---- Gifts ----
    gift_liked: 'Ah, {item}! I love it. Tenki!',
    gift_ok: 'Thank you for the {item}.',
    gift_already: 'You have already given me something today.',

    // ---- Signs ----
    sign_field: 'YOUR FIELD: Till with the hoe, plant seeds, and water them every day it does not rain.',
    sign_village: 'NOTICE: Pa Sorie sells seeds at the market stall. Market prices are fair!',

    // ---- Character creation ----
    create_title: 'Plenty Heap',
    create_subtitle: 'Make your farmer',
    create_body: 'Body',
    create_skin: 'Skin',
    create_hair: 'Hair',
    create_hair_color: 'Hair colour',
    create_done: 'Start farming!',
    create_help_keys: 'Up / Down: choose a row.  Left / Right: change it.  Space: start.',
    create_help_touch: 'Tap a colour or an arrow to change your farmer.',
    body_m: 'Boy',
    body_f: 'Girl',
    hair_none: 'Shaved',
    hair_curls: 'Curls',
    hair_flattop: 'Flat top',
    hair_twists: 'Twists',
    hair_spiky: 'Spiky',
    hair_puffs: 'Puffs',
    hair_toppuff: 'Top puff',
    hair_braid: 'Braid',
    hair_cornrows: 'Cornrows',
    hair_bun: 'Bun',
    hair_ponytail: 'Ponytail',
    hair_bob: 'Bob',
    hair_mohawk: 'Mohawk',
    hair_elder: 'Short grey',

    // ---- Intro (shown once in a new game) ----
    intro_1: 'Welcome to Plenty Heap, your new farm by the sea!',
    intro_2: 'Make heaps with your hoe, plant seeds, and sell your harvest in the shipping crate for cowries.',
    intro_keys: 'Keys: arrows or WASD to move. SPACE to use or talk. 1-9 / Q E to pick an item. X to close.',
    intro_touch: 'Use the pad to move, A to use or talk, B to close. Tap an item to pick it.',

    // ---- Villagers ----
    npc_kadi: 'Aunty Kadi',
    npc_sorie: 'Pa Sorie',
    kadi_s1: 'Kushe! You must be the new farmer. Welcome to our village.',
    kadi_s2: 'The fishermen went out before sunrise. The sea is calm today.',
    kadi_f1: 'Kushe, my friend! How di bodi?',
    kadi_f2: 'The krain krain from your farm made my sauce so sweet!',
    kadi_c1: 'You are like family now. Come and eat with us on Sunday.',
    kadi_rainy: 'The rains are here. Plant your maize and groundnut now!',
    kadi_dry: 'In the dry season you must water every day. Pepper loves the heat.',
    sorie_s1: 'Kushe. I am Sorie. I sell good seed - come and look.',
    sorie_f1: 'Ah, my best customer! Your field is looking fine.',
    sorie_c1: 'Everyone at the market is talking about your harvest!'
  };

  FS.Strings = {
    lang: 'en',
    en: en
    // fr: { ... }   <- add translations here
  };

  /** Look up a string and fill in {placeholders}. */
  FS.t = function (key, params) {
    const table = FS.Strings[FS.Strings.lang] || en;
    let s = table[key];
    if (s === undefined) s = en[key];
    if (s === undefined) return key; // makes missing strings easy to spot
    if (params) {
      s = s.replace(/\{(\w+)\}/g, function (m, name) {
        return params[name] !== undefined ? String(params[name]) : m;
      });
    }
    return s;
  };

  /** Convenience: the translated name of an item, by key or id. */
  FS.itemName = function (keyOrId) {
    const item = typeof keyOrId === 'number' ? FS.Items.byId(keyOrId) : FS.Items.get(keyOrId);
    return item ? FS.t('item_' + item.key) : '?';
  };
})(FarmSim);
