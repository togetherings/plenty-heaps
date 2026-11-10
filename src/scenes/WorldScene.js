/**
 * WorldScene.js
 * =============
 * ONE scene draws EVERY area (farm, village, house...). It is restarted with a
 * different area whenever the player walks through a door or exit, so adding
 * an area means adding a map and a line in data/areas.js - not new code.
 *
 * What it does:
 *   - builds the area from its Tiled map (layers, collisions, objects)
 *   - places the player and villagers
 *   - moves the player from FarmSim.Controls (keyboard + touch, set by UIScene)
 *   - handles the action button: talk, gift, ship, sleep, read signs, farm
 *   - runs the clock, autosaves, and handles sleeping / passing out
 *
 * Drawing order (depth), back to front:
 *   0 ground  |  1 heaps  |  2 crops  |  2.5 target cursor
 *   3 decor (bases of trees, walls)  |  4+ characters and critters, sorted
 *   by where their feet are  |  1000 "above" (roofs, tree tops)
 *
 * Characters are 16x32 sprites but only their FEET collide (Config.FEET_BOX),
 * so they can walk in front of things. Tiles on the "above" layer with the
 * collides property also block (e.g. the walls just under a roof).
 */
(function (FS) {
  'use strict';

  const C = FS.Config;
  const T = C.TILE;
  const DIRS = {
    down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 }
  };

  class WorldScene extends Phaser.Scene {
    constructor() { super('World'); }

    /**
     * data: { area, spawn }                 arrive at a named spawn point
     *       { area, resumeAt: {x, y, facing} }   continue a mid-day save
     *       morning: summary from FS.Day.endDay, to show after waking up
     */
    init(data) {
      this.areaKey = data.area;
      this.spawnName = data.spawn || null;
      this.resumeAt = data.resumeAt || null;
      this.morning = data.morning || null;
      this.firstLoad = !!data.firstLoad;
      this.arrivedByWarp = !!data.byWarp;
      this.transitioning = false;
      this.minuteTimer = 0;
    }

    create() {
      const state = FS.Session.state;
      this.area = FS.Areas.get(this.areaKey);
      FS.currentArea = this.area;

      this.buildMap();
      this.buildObjects();
      this.createPlayer();
      this.setupCamera();

      // Listen for buttons pressed in the UI scene. Removed again when this
      // scene shuts down, or the old scene would keep reacting.
      FS.bus.on('action', this.onAction, this);
      this.events.once('shutdown', function () { FS.bus.off('action', this.onAction, this); }, this);

      // Ignore warps for a moment after arriving so the player can't bounce
      // straight back through a door they spawned next to.
      this.warpsArmedAt = this.time.now + 400;
      this.saveTimer = 0;

      // Save after moving between areas (cheap, and protects progress).
      if (this.arrivedByWarp) FS.Session.save();

      // Messages to show once the screen has faded in.
      this.time.delayedCall(350, this.showArrivalMessages, [], this);
    }

    // ===================================================================== MAP
    buildMap() {
      const map = this.map = this.make.tilemap({ key: this.area.map });
      // 'tiles' = tileset name in Tiled, 'tiles' = image key loaded in BootScene.
      const tileset = this.tileset = map.addTilesetImage('tiles', 'tiles');

      this.groundLayer = map.createLayer('ground', tileset, 0, 0).setDepth(0);
      this.decorLayer = map.createLayer('decor', tileset, 0, 0).setDepth(3);
      // Tiles with the custom property collides=true (set on the tileset in
      // Tiled) block movement. Water is on the ground layer, so check both.
      this.groundLayer.setCollisionByProperty({ collides: true });
      this.decorLayer.setCollisionByProperty({ collides: true });

      // Layer drawn over the player (roofs, tree tops). Optional.
      this.aboveLayer = null;
      if (map.layers.some(function (l) { return l.name === 'above'; })) {
        this.aboveLayer = map.createLayer('above', tileset, 0, 0).setDepth(1000);
        this.aboveLayer.setCollisionByProperty({ collides: true });
      }

      // The field: two runtime layers for soil and plants, drawn from state.
      const plotObj = FS.Areas.findObject(this.area.map, 'farmland');
      this.plot = plotObj ? FS.Areas.farmland() : null;
      if (this.plot) {
        this.soilLayer = map.createBlankLayer('soil', tileset).setDepth(1);
        this.cropLayer = map.createBlankLayer('crops', tileset).setDepth(2);
        this.drawWholeField();
      }

      this.physics.world.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
    }

    /** Redraw one field tile from the state. c, r are field coordinates. */
    drawFieldTile(c, r) {
      const tile = FS.Farming.tile(FS.Session.state, c, r);
      if (!tile) return;
      const x = this.plot.col + c, y = this.plot.row + r;
      const soil = FS.Farming.soilFrame(tile);
      const plant = FS.Farming.plantFrame(tile);
      if (soil >= 0) this.soilLayer.putTileAt(FS.Tiles.gid(soil), x, y);
      else this.soilLayer.removeTileAt(x, y);
      if (plant >= 0) this.cropLayer.putTileAt(FS.Tiles.gid(plant), x, y);
      else this.cropLayer.removeTileAt(x, y);
    }

    drawWholeField() {
      const farm = FS.Session.state.farm;
      for (let r = 0; r < Math.min(farm.rows, this.plot.rows); r++) {
        for (let c = 0; c < Math.min(farm.cols, this.plot.cols); c++) this.drawFieldTile(c, r);
      }
    }

    // ================================================================= OBJECTS
    /** Read the "objects" layer and set up warps, villagers and interactables. */
    buildObjects() {
      const A = FS.Areas;
      // The scene object is reused when it restarts in a new area, so every
      // list must be reset here.
      this.spawns = {};
      this.warpZones = [];
      this.interactables = [];   // {type, rect, obj}
      this.npcs = [];            // villager sprites
      this.critters = [];        // wandering animals
      this.npcGroup = this.physics.add.staticGroup();   // villagers' feet

      A.objects(this.area.map).forEach(function (o) {
        const type = A.objType(o);
        const cx = o.x + o.width / 2, cy = o.y + o.height / 2;

        if (type === 'spawn') {
          this.spawns[o.name] = { x: cx, y: cy, facing: A.prop(o, 'facing', 'down') };

        } else if (type === 'warp') {
          const zone = this.add.zone(cx, cy, o.width, o.height);
          this.physics.add.existing(zone, true);
          zone.warpTarget = A.prop(o, 'target');
          zone.warpSpawn = A.prop(o, 'spawn');
          this.warpZones.push(zone);

        } else if (type === 'npc') {
          // The villager stands with their feet on this spot. The sprite is
          // only a picture; a small invisible box at their feet blocks the player.
          const def = FS.Npcs.get(A.prop(o, 'npc'));
          const facing = A.prop(o, 'facing', 'down');
          const sprite = this.add.sprite(cx, cy - C.FEET_Y, 'char-' + def.key, FS.CharacterArt.frame(facing));
          sprite.npcDef = def;
          sprite.homeFacing = facing;
          sprite.feetX = cx;
          sprite.feetY = cy;
          sprite.setDepth(4 + cy / 10000);
          this.npcs.push(sprite);
          const blocker = this.add.zone(cx, cy, 12, 10);
          this.npcGroup.add(blocker);

        } else if (type === 'critter') {
          this.addCritter(A.prop(o, 'kind', 'hen'), cx, cy);

        } else if (type === 'ship' || type === 'bed' || type === 'sign') {
          this.interactables.push({ type: type, obj: o, rect: new Phaser.Geom.Rectangle(o.x - 2, o.y - 2, o.width + 4, o.height + 4) });
        }
      }, this);
    }

    /** Standing frame for a facing (see CharacterArt.frame). */
    charFrame(facing) {
      return FS.CharacterArt.frame(facing);
    }

    // ================================================================== PLAYER
    createPlayer() {
      // Choose the starting position: a saved position, a spawn point, or
      // (as a fallback) the first spawn in the map.
      let x, y, facing;
      if (this.resumeAt && this.isWalkableTile(this.resumeAt.x, this.resumeAt.y)) {
        x = this.resumeAt.x * T + T / 2;
        y = this.resumeAt.y * T + T / 2;
        facing = this.resumeAt.facing;
      } else {
        const sp = this.spawns[this.spawnName] || this.spawns[Object.keys(this.spawns)[0]];
        FS.assert(sp, 'area "' + this.areaKey + '" has no spawn points');
        x = sp.x; y = sp.y; facing = sp.facing;
      }

      // Only the feet collide (Config.FEET_BOX), so the player can walk in
      // front of walls and trees. The sprite is placed so the feet sit on
      // the chosen spot.
      const fb = C.FEET_BOX;
      const p = this.player = this.physics.add.sprite(x, y - C.FEET_Y, 'char-player', 1);
      p.body.setSize(fb.w, fb.h, false);
      p.body.setOffset(fb.x, fb.y);
      p.setCollideWorldBounds(true);
      this.facing = facing || 'down';
      p.setFrame(this.charFrame(this.facing));

      this.physics.add.collider(p, this.groundLayer);
      this.physics.add.collider(p, this.decorLayer);
      if (this.aboveLayer) this.physics.add.collider(p, this.aboveLayer);
      this.physics.add.collider(p, this.npcGroup);
      this.warpZones.forEach(function (zone) {
        this.physics.add.overlap(p, zone, function () { this.tryWarp(zone); }, null, this);
      }, this);

      // Target cursor: shows which field tile the action button will affect.
      this.cursor = this.add.rectangle(0, 0, T, T).setStrokeStyle(1, 0xffffff, 0.7).setDepth(2.5).setVisible(false);

      // Keep the saved position up to date (one object, updated in place).
      FS.Session.state.pos = { area: this.areaKey, x: 0, y: 0, facing: this.facing };
      this.updateSavedPosition();
    }

    /** Is a tile free to stand on (inside the map and not blocked)? */
    isWalkableTile(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= this.map.width || ty >= this.map.height) return false;
      const layers = [this.groundLayer, this.decorLayer, this.aboveLayer];
      for (let i = 0; i < layers.length; i++) {
        if (!layers[i]) continue;
        const t = layers[i].getTileAt(tx, ty);
        if (t && t.collides) return false;
      }
      return true;
    }

    /** The player's feet (centre of the collision box), in pixels. */
    feet() { return this.player.body.center; }

    /** The point just in front of the player, where actions happen. */
    targetPoint() {
      const f = this.feet(), d = DIRS[this.facing];
      return { x: f.x + d.x * 12, y: f.y + d.y * 12 };
    }

    updateSavedPosition() {
      const pos = FS.Session.state.pos, f = this.feet();
      if (!pos) return;  // null right after sleeping: wake up at home
      pos.x = Math.floor(f.x / T);
      pos.y = Math.floor(f.y / T);
      pos.facing = this.facing;
    }

    // ================================================================== CAMERA
    setupCamera() {
      const cam = this.cameras.main;
      cam.setZoom(C.WORLD_ZOOM);
      const viewW = cam.width / cam.zoom, viewH = cam.height / cam.zoom;
      const mapW = this.map.widthInPixels, mapH = this.map.heightInPixels;
      if (mapW <= viewW && mapH <= viewH) {
        cam.centerOn(mapW / 2, mapH / 2);     // small room: just centre it
      } else {
        cam.setBounds(0, 0, mapW, mapH);
        cam.startFollow(this.player, true);
      }
      cam.setBackgroundColor('#101014');
      cam.fadeIn(250, 0, 0, 0);
    }

    // ================================================================== UPDATE
    update(time, delta) {
      const state = FS.Session.state;
      const uiBusy = FS.UI && FS.UI.busy;

      if (this.transitioning || uiBusy) {
        this.player.setVelocity(0, 0);
        this.player.anims.stop();
        this.player.setFrame(this.charFrame(this.facing));
      } else {
        this.movePlayer();
        this.runClock(delta, state);
      }

      this.player.setDepth(4 + this.feet().y / 10000);
      this.updateCritters(delta);
      if (!this.transitioning) this.updateSavedPosition();
      this.updateCursor();
    }

    movePlayer() {
      const k = FS.Controls;
      let vx = (k.right ? 1 : 0) - (k.left ? 1 : 0);
      let vy = (k.down ? 1 : 0) - (k.up ? 1 : 0);

      if (vx !== 0 && vy !== 0) {      // diagonal: same speed as straight
        vx *= Math.SQRT1_2;
        vy *= Math.SQRT1_2;
      }
      this.player.setVelocity(vx * C.PLAYER_SPEED, vy * C.PLAYER_SPEED);

      if (vx === 0 && vy === 0) {
        this.player.anims.stop();
        this.player.setFrame(this.charFrame(this.facing));
        return;
      }
      // Face the direction of movement. When moving diagonally, keep the
      // current facing if it's one of the two directions being pressed.
      const horiz = vx < 0 ? 'left' : vx > 0 ? 'right' : null;
      const vert = vy < 0 ? 'up' : vy > 0 ? 'down' : null;
      if (this.facing !== horiz && this.facing !== vert) this.facing = vert || horiz;
      this.player.anims.play('char-player-walk-' + this.facing, true);
    }

    /** Advance game time; save every few seconds; pass out at midnight. */
    runClock(delta, state) {
      this.minuteTimer += delta;
      while (this.minuteTimer >= C.MS_PER_GAME_MINUTE) {
        this.minuteTimer -= C.MS_PER_GAME_MINUTE;
        state.time++;
      }
      this.saveTimer += delta;
      if (this.saveTimer >= C.SAVE_EVERY_MS) {
        this.saveTimer = 0;
        FS.Session.saveIfChanged();
      }
      if (state.time >= C.DAY_END_MIN) this.sleep(true);
    }

    /** Show the white square on the field tile in front of the player. */
    updateCursor() {
      if (!this.plot || this.transitioning) { this.cursor.setVisible(false); return; }
      const t = this.targetPoint();
      const tx = Math.floor(t.x / T), ty = Math.floor(t.y / T);
      const inField = tx >= this.plot.col && ty >= this.plot.row &&
        tx < this.plot.col + this.plot.cols && ty < this.plot.row + this.plot.rows;
      this.cursor.setVisible(inField);
      if (inField) this.cursor.setPosition(tx * T + T / 2, ty * T + T / 2);
    }

    // ================================================================= ACTIONS
    /** The action button (Space / A). Decides what to do from what's in front. */
    onAction() {
      if (this.transitioning) return;
      const tp = this.targetPoint();

      // 1. A villager?
      const npc = this.npcs.find(function (s) {
        return Math.abs(s.feetX - tp.x) <= 12 && Math.abs(s.feetY - tp.y) <= 12;
      });
      if (npc) { this.interactNpc(npc); return; }

      // 2. An object (shipping bin, bed, sign)?
      const thing = this.interactables.find(function (it) { return it.rect.contains(tp.x, tp.y); });
      if (thing) {
        if (thing.type === 'ship') this.shipHeldItem();
        else if (thing.type === 'bed') this.askToSleep();
        else if (thing.type === 'sign') FS.UI.showDialogue([{ text: FS.t(FS.Areas.prop(thing.obj, 'text', '')) }]);
        return;
      }

      // 3. The field?
      if (this.plot) this.farmAction(Math.floor(tp.x / T), Math.floor(tp.y / T));
    }

    farmAction(tx, ty) {
      const state = FS.Session.state;
      const c = tx - this.plot.col, r = ty - this.plot.row;
      const tile = FS.Farming.tile(state, c, r);
      const item = FS.State.selectedItem(state);

      if (!tile) {
        // Only complain if they were clearly trying to farm.
        if (item && (item.kind === 'seed' || item.kind === 'tool')) FS.UI.toast(FS.t('msg_not_field'));
        return;
      }

      // Ripe crops are picked whatever is being held.
      if (FS.Farming.isRipe(tile)) {
        const res = FS.Farming.harvest(state, c, r);
        if (res.code === 'harvested') {
          FS.State.setFlag(state, 'firstHarvest');
          FS.UI.toast(FS.t('msg_harvest', { n: res.qty, item: FS.itemName(res.item) }));
          this.popEffect(tx, ty);
        } else if (res.code === 'bag_full') {
          FS.UI.toast(FS.t('msg_bag_full'));
        }
        this.drawFieldTile(c, r);
        return;
      }
      if (!item) return;

      let code = null;
      if (item.kind === 'tool') {
        const cost = C.ENERGY_COST[item.tool] || 0;
        if (state.energy < cost) { FS.UI.toast(FS.t('msg_no_energy')); return; }
        code = item.tool === 'hoe' ? FS.Farming.till(state, c, r) : FS.Farming.water(state, c, r);
        if (code === 'tilled' || code === 'cleared' || code === 'watered') state.energy -= cost;
        this.swingEffect();
      } else if (item.kind === 'seed') {
        code = FS.Farming.plant(state, c, r, item);
        if (code === 'planted') FS.State.removeFromSlot(state, state.selected, 1);
      }

      // Explain why nothing happened, when it's not obvious.
      if (code === 'need_tilled') FS.UI.toast(FS.t('msg_need_tilled'));
      else if (code === 'occupied' && item.kind === 'seed') FS.UI.toast(FS.t('msg_occupied'));
      else if (code === 'wrong_season') {
        FS.UI.toast(FS.t('msg_wrong_season', {
          item: FS.itemName(item.id),
          season: FS.t('season_' + FS.State.calendar(state).season).toLowerCase()
        }));
      }
      this.drawFieldTile(c, r);
    }

    /** Put the whole held stack in the shipping bin. Paid overnight. */
    shipHeldItem() {
      const state = FS.Session.state;
      const item = FS.State.selectedItem(state);
      if (!item) { FS.UI.toast(FS.t('msg_ship_nothing')); return; }
      if (!item.sell) { FS.UI.toast(FS.t('msg_ship_cant', { item: FS.itemName(item.id) })); return; }
      const qty = state.inventory[state.selected].qty;
      const value = item.sell * qty;
      state.shipped = Math.min(state.shipped + value, FS.SaveCodec.LIMITS.shipped);
      FS.State.removeFromSlot(state, state.selected, qty);
      FS.State.setFlag(state, 'firstShipment');
      FS.UI.toast(FS.t('msg_shipped', { n: qty, item: FS.itemName(item.id), price: FS.Wallet.format('cowrie', value) }));
    }

    // ================================================================= PEOPLE
    interactNpc(sprite) {
      const state = FS.Session.state;
      const def = sprite.npcDef;
      const npcState = FS.State.npc(state, def.key);
      const name = FS.t('npc_' + def.key);

      // Turn to face the player.
      const opposite = { up: 'down', down: 'up', left: 'right', right: 'left' };
      sprite.setFrame(this.charFrame(opposite[this.facing]));
      const turnBack = function () { sprite.setFrame(this.charFrame(sprite.homeFacing)); }.bind(this);

      if (def.metFlag) FS.State.setFlag(state, def.metFlag);

      // Holding produce = give it as a gift (one gift per villager per day).
      const held = FS.State.selectedItem(state);
      if (held && held.kind === 'produce') {
        let text;
        if (npcState.gifted) {
          text = FS.t('gift_already');
        } else {
          const liked = def.likes.indexOf(held.key) !== -1;
          npcState.gifted = true;
          npcState.friend = Math.min(FS.Friendship.MAX, npcState.friend + (liked ? FS.Friendship.GIFT_LIKED : FS.Friendship.GIFT));
          FS.State.removeFromSlot(state, state.selected, 1);
          text = FS.t(liked ? 'gift_liked' : 'gift_ok', { item: FS.itemName(held.id) });
        }
        FS.UI.showDialogue([{ name: name, text: text }], turnBack);
        return;
      }

      // Otherwise, talk. The first chat each day raises friendship.
      if (!npcState.talked) {
        npcState.talked = true;
        npcState.friend = Math.min(FS.Friendship.MAX, npcState.friend + FS.Friendship.TALK);
      }
      const tier = FS.Friendship.tier(npcState.friend);
      const season = FS.State.calendar(state).season;
      const lines = (def.lines[tier] || []).concat(def.lines[season] || []);
      // One line per day, so talking twice doesn't cycle through everything.
      const line = lines.length ? lines[(state.day + def.id) % lines.length] : null;

      FS.UI.showDialogue(line ? [{ name: name, text: FS.t(line) }] : [], function () {
        turnBack();
        if (def.shop) FS.UI.openShop(def.shop);
      });
    }

    // ========================================================= DOORS & SLEEP
    tryWarp(zone) {
      if (this.transitioning || this.time.now < this.warpsArmedAt) return;
      if (FS.UI && FS.UI.busy) return;
      this.changeArea({ area: zone.warpTarget, spawn: zone.warpSpawn, byWarp: true });
    }

    /** Fade out, then restart this scene in another area. */
    changeArea(data) {
      this.transitioning = true;
      this.player.setVelocity(0, 0);
      this.cameras.main.fadeOut(220, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', function () {
        this.scene.restart(data);
      }, this);
    }

    askToSleep() {
      FS.UI.showMenu({
        title: FS.t('sleep_prompt'),
        options: [{ label: FS.t('yes') }, { label: FS.t('no') }],
        onPick: function (i) { if (i === 0) this.sleep(false); }.bind(this)
      });
    }

    /** End the day (in bed, or passed out at midnight), save, wake at home. */
    sleep(passedOut) {
      if (this.transitioning) return;
      const summary = FS.Day.endDay(FS.Session.state, { passedOut: passedOut });
      summary.saved = FS.Session.save();
      this.transitioning = true;
      this.player.setVelocity(0, 0);
      this.cameras.main.fadeOut(passedOut ? 900 : 600, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', function () {
        this.scene.restart({ area: FS.Areas.HOME.area, spawn: FS.Areas.HOME.spawn, morning: summary });
      }, this);
    }

    // ================================================================ MESSAGES
    showArrivalMessages() {
      if (!FS.UI) return;
      const state = FS.Session.state;
      const pages = [];

      if (this.morning) {
        const m = this.morning, cal = FS.State.calendar(state);
        if (m.passedOut) pages.push({ text: FS.t('passed_out') });
        if (m.newSeason) pages.push({ text: FS.t('season_start', { season: FS.t('season_' + m.newSeason).toLowerCase() }) });
        let text = FS.t('morning', { day: cal.dayOfSeason, season: FS.t('season_' + cal.season).toLowerCase() });
        if (m.earned > 0) text += ' ' + FS.t('morning_earned', { money: FS.Wallet.format('cowrie', m.earned) });
        if (m.rain) text += ' ' + FS.t('morning_rain');
        pages.push({ text: text });
        if (!m.saved) pages.push({ text: FS.t('save_failed') });
      }

      if (!FS.State.getFlag(state, 'introSeen')) {
        pages.push({ text: FS.t('intro_1') }, { text: FS.t('intro_2') });
        pages.push({ text: FS.t(FS.UI.touchEnabled ? 'intro_touch' : 'intro_keys') });
        FS.State.setFlag(state, 'introSeen');
      }

      if (this.firstLoad && FS.Session.loadError) {
        pages.unshift({ text: 'Your saved game could not be loaded, so a new game was started. (' + FS.Session.loadError + ')' });
        FS.Session.loadError = null;
      }
      if (pages.length) FS.UI.showDialogue(pages);
    }

    // ================================================================ EFFECTS
    /** A small sparkle when something is harvested. */
    popEffect(tx, ty) {
      const star = this.add.rectangle(tx * T + T / 2, ty * T + T / 2, 4, 4, 0xfff4a0).setDepth(900);
      this.tweens.add({ targets: star, y: star.y - 12, alpha: 0, duration: 400, onComplete: function () { star.destroy(); } });
    }

    /** A tiny "bob" so tool use feels responsive. */
    swingEffect() {
      this.tweens.add({ targets: this.player, scaleY: 0.92, duration: 60, yoyo: true });
    }

    // =============================================================== CRITTERS
    /**
     * Ambient animals (map objects of type "critter", property kind =
     * crab / hen / chick). They wander near where they were placed. They are
     * decoration only: not saved, and they don't block the player.
     */
    addCritter(kind, x, y) {
      const def = FS.CRITTERS[kind];
      if (!def) return;
      const feet = def.frameHeight / 2 - 3;    // feet near the bottom of the frame
      const s = this.add.sprite(x, y - feet, kind, FS.CharacterArt.frame('down'));
      s.critter = { kind: kind, home: { x: x, y: y }, feet: feet, speed: def.speed, dir: null, timer: 500 + Math.random() * 1500 };
      this.critters.push(s);
    }

    updateCritters(delta) {
      const dirs = ['down', 'up', 'left', 'right'];
      this.critters.forEach(function (s) {
        const c = s.critter;
        c.timer -= delta;
        if (c.timer <= 0) {
          // Alternate between pausing and walking a short way.
          c.dir = c.dir ? null : dirs[Math.floor(Math.random() * 4)];
          c.timer = c.dir ? 400 + Math.random() * 900 : 800 + Math.random() * 2200;
          if (c.dir) s.anims.play(c.kind + '-walk-' + c.dir, true);
          else { s.anims.stop(); s.setFrame(FS.CharacterArt.frame(s.lastDir || 'down')); }
        }
        if (c.dir) {
          const d = DIRS[c.dir], step = c.speed * delta / 1000;
          const nx = s.x + d.x * step, ny = s.y + c.feet + d.y * step;
          const far = Math.abs(nx - c.home.x) > 48 || Math.abs(ny - c.home.y) > 48;
          if (far || !this.isWalkableTile(Math.floor(nx / T), Math.floor(ny / T))) {
            c.timer = 0;                       // blocked: stop and pick again
          } else {
            s.x = nx; s.y = ny - c.feet;
            s.lastDir = c.dir;
          }
        }
        s.setDepth(4 + (s.y + c.feet) / 10000);
      }, this);
    }
  }

  FS.WorldScene = WorldScene;
})(FarmSim);
