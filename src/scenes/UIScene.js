/**
 * UIScene.js
 * ==========
 * Everything drawn ON TOP of the world, plus all input handling. This scene
 * starts once and keeps running while the World scene restarts for each area.
 *
 *   HUD          date, season, clock, weather, money, energy
 *   Hotbar       the inventory slots (tap or press 1-0 / Q / E to select)
 *   Toast        short one-line messages ("Harvested 2 Maize!")
 *   Dialogue     boxes of text, one page at a time
 *   Menu         a list of choices (Yes/No, the seed shop)
 *   Weather      rain streaks and night-time darkening (outdoors only)
 *   Controls     keyboard, plus an on-screen pad and A/B buttons for touch
 *
 * Other code uses it through FarmSim.UI:
 *   FarmSim.UI.toast(text)
 *   FarmSim.UI.showDialogue([{name, text}, ...], onDone)
 *   FarmSim.UI.showMenu({title, options: [{label}], onPick(i), onCancel})
 *   FarmSim.UI.openShop('seeds')
 *   FarmSim.UI.busy   -> true while a dialogue or menu is open (world pauses)
 *
 * Movement keys are copied into FarmSim.Controls every frame; the action
 * button is sent to the world as the 'action' event on FarmSim.bus.
 */
(function (FS) {
  'use strict';

  const C = FS.Config;
  const W = C.GAME_WIDTH, H = C.GAME_HEIGHT;

  // Shared text styles. The device's own font is used for now; see the note
  // in strings.js about a pixel font for local-language letters.
  const FONT = 'Verdana, Arial, sans-serif';
  const CR = FS.Colors;
  const STYLE = { fontFamily: FONT, fontSize: '13px', color: CR.cream };
  const STYLE_SHADOW = { fontFamily: FONT, fontSize: '13px', color: CR.cream, stroke: CR.dark, strokeThickness: 3 };
  const STYLE_SMALL = { fontFamily: FONT, fontSize: '10px', color: CR.cream, stroke: CR.dark, strokeThickness: 3 };
  const STYLE_DIALOG = { fontFamily: FONT, fontSize: '14px', color: CR.cream, lineSpacing: 4, wordWrap: { width: W - 88 } };

  // Hotbar layout
  const SLOT = 34, GAP = 2;

  FS.Controls = { up: false, down: false, left: false, right: false };

  class UIScene extends Phaser.Scene {
    constructor() { super('UI'); }

    create() {
      FS.UI = this;
      this.busy = false;
      this.dialogPages = [];
      this.dialogIndex = 0;
      this.dialogDone = null;
      this.menu = null;               // the open menu, or null
      this.lastHud = {};              // to only redraw text that changed
      this.touchEnabled = this.sys.game.device.input.touch || C.FORCE_TOUCH === true;

      this.createWeatherOverlay();
      this.createHud();
      this.createHotbar();
      this.createToast();
      this.createDialogue();
      if (this.touchEnabled) this.createTouchControls();
      this.createKeyboard();

      // In Kolibri the game runs inside a frame; it must have keyboard focus.
      this.input.on('pointerdown', function () { try { window.focus(); } catch (e) { /* ignore */ } });
    }

    // ============================================================== OVERLAYS
    createWeatherOverlay() {
      this.night = this.add.rectangle(0, 0, W, H, 0x0a1038, 0).setOrigin(0, 0).setDepth(0);
      this.rain = this.add.graphics().setDepth(1);
      this.drops = [];
      for (let i = 0; i < 70; i++) {
        this.drops.push({ x: Math.random() * W, y: Math.random() * H, len: 6 + Math.random() * 6 });
      }
    }

    updateWeather(delta) {
      const state = FS.Session.state;
      const outdoor = FS.currentArea && FS.currentArea.outdoor;

      // Night: darken gradually from 18:00 to 22:00.
      const dark = outdoor ? Phaser.Math.Clamp((state.time - C.NIGHT_START_MIN) / 240, 0, 1) * 0.55 : 0;
      this.night.setFillStyle(0x0a1038, dark);

      // Rain streaks.
      this.rain.clear();
      if (!outdoor || !FS.State.isRaining(state)) return;
      this.rain.lineStyle(1, 0xb8d4ff, 0.55);
      const fall = delta * 0.45;
      this.drops.forEach(function (d) {
        d.y += fall; d.x -= fall * 0.25;
        if (d.y > H) { d.y = -d.len; d.x = Math.random() * (W + 40); }
        this.rain.lineBetween(d.x, d.y, d.x - d.len * 0.25, d.y + d.len);
      }, this);
    }

    // =================================================================== HUD
    createHud() {
      this.add.image(6, 6, FS.UIArt.panel(this, 268, 54)).setOrigin(0, 0).setDepth(10);
      this.dateText = this.add.text(18, 13, '', STYLE).setDepth(11);
      this.clockText = this.add.text(18, 32, '', STYLE).setDepth(11);
      // Money: cowrie shell icon + amount (more currencies can be shown later)
      this.add.image(170, 41, 'items', FS.Currencies.get('cowrie').icon).setDepth(11);
      this.moneyText = this.add.text(182, 32, '', STYLE).setDepth(11);

      this.add.image(W - 138, 6, FS.UIArt.panel(this, 132, 38)).setOrigin(0, 0).setDepth(10);
      this.add.text(W - 126, 11, 'Energy', STYLE_SMALL).setDepth(11);
      this.energyBar = this.add.graphics().setDepth(11);

      if (C.DEBUG_PHYSICS) this.debugText = this.add.text(8, H - 14, '', STYLE_SMALL).setDepth(11);
    }

    /** Set a text object's content only if it changed (redrawing text is slow). */
    setIfChanged(key, textObj, value) {
      if (this.lastHud[key] === value) return;
      this.lastHud[key] = value;
      textObj.setText(value);
    }

    updateHud() {
      const state = FS.Session.state;
      const cal = FS.State.calendar(state);
      this.setIfChanged('date', this.dateText,
        FS.t('hud_date', { day: cal.dayOfSeason, season: FS.t('season_' + cal.season), year: cal.year }));
      // Show the clock in 10-minute steps, like most farming games.
      const shownTime = state.time - (state.time % 10);
      this.setIfChanged('clock', this.clockText,
        FS.State.clockText(shownTime) + '  ' + FS.t(FS.State.isRaining(state) ? 'weather_rain' : 'weather_sun'));
      this.setIfChanged('money', this.moneyText, FS.t('hud_money', { n: FS.Wallet.get(state, 'cowrie') }));

      if (this.lastHud.energy !== state.energy) {
        this.lastHud.energy = state.energy;
        const pct = state.energy / C.MAX_ENERGY;
        const g = this.energyBar;
        g.clear();
        g.fillStyle(0x593b3d, 1).fillRect(W - 126, 26, 112, 7);
        g.fillStyle(pct > 0.3 ? 0x92d69a : 0xff5654, 1).fillRect(W - 126, 26, Math.round(112 * pct), 7);
      }

      if (this.debugText) {
        this.setIfChanged('debug', this.debugText,
          'storage: ' + FS.Session.storage.kind + '  last save: ' + FS.Session.lastSaveChars + '/' + C.SCORM_MAX_CHARS + ' chars');
      }
    }

    // ================================================================ HOTBAR
    createHotbar() {
      const n = C.INVENTORY_SLOTS;
      const total = n * (SLOT + GAP) - GAP;
      const x0 = (W - total) / 2, y = H - SLOT - 6;
      this.slots = [];
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (SLOT + GAP);
        const bg = this.add.rectangle(x, y, SLOT, SLOT, CR.blueHex, 0.85).setOrigin(0, 0)
          .setStrokeStyle(2, CR.darkHex, 1).setDepth(10).setInteractive();
        bg.on('pointerdown', function () { if (!this.busy) this.selectSlot(i); }, this);
        const icon = this.add.image(x + SLOT / 2, y + SLOT / 2, 'items', 0).setScale(2).setDepth(11).setVisible(false);
        const qty = this.add.text(x + SLOT - 2, y + SLOT - 1, '', STYLE_SMALL).setOrigin(1, 1).setDepth(12);
        this.slots.push({ bg: bg, icon: icon, qty: qty, x: x, y: y, lastKey: null });
      }
      this.selectFrame = this.add.rectangle(0, y - 1, SLOT + 2, SLOT + 2).setOrigin(0, 0)
        .setStrokeStyle(2, CR.yellowHex, 1).setDepth(12);
      this.itemLabel = this.add.text(W / 2, y - 6, '', STYLE_SHADOW).setOrigin(0.5, 1).setDepth(12);
    }

    updateHotbar() {
      const state = FS.Session.state;
      this.slots.forEach(function (s, i) {
        const item = state.inventory[i];
        const key = item ? item.id + ':' + item.qty : '';
        if (s.lastKey === key) return;
        s.lastKey = key;
        if (item) {
          s.icon.setFrame(FS.Items.byId(item.id).icon).setVisible(true);
          s.qty.setText(item.qty > 1 ? String(item.qty) : '');
        } else {
          s.icon.setVisible(false);
          s.qty.setText('');
        }
      });
      this.selectFrame.x = this.slots[state.selected].x - 1;
      const sel = FS.State.selectedItem(state);
      this.setIfChanged('itemLabel', this.itemLabel, sel ? FS.itemName(sel.id) : '');
    }

    selectSlot(i) {
      const n = C.INVENTORY_SLOTS;
      FS.Session.state.selected = ((i % n) + n) % n;
    }

    // ================================================================= TOAST
    createToast() {
      this.toastText = this.add.text(W / 2, H - SLOT - 32, '', STYLE_SHADOW).setOrigin(0.5, 1).setDepth(20).setAlpha(0);
      this.toastUntil = 0;
    }

    toast(message) {
      this.toastText.setText(message).setAlpha(1);
      this.toastUntil = this.time.now + 2600;
    }

    updateToast() {
      if (this.toastText.alpha > 0 && this.time.now > this.toastUntil) {
        this.toastText.setAlpha(Math.max(0, this.toastText.alpha - 0.05));
      }
    }

    // ============================================================== DIALOGUE
    createDialogue() {
      // Placed above the touch pad and buttons so taps don't overlap.
      const x = 24, y = H - 232, w = W - 48, h = 92;
      this.dlgBox = this.add.image(x, y, FS.UIArt.panel(this, w, h)).setOrigin(0, 0).setDepth(30).setInteractive();
      this.dlgBox.on('pointerdown', this.pressAction, this);
      this.dlgName = this.add.text(x + 14, y - 13, '', {
        fontFamily: FONT, fontSize: '13px', color: CR.dark, backgroundColor: CR.yellow, padding: { x: 7, y: 3 }
      }).setDepth(31);
      this.dlgText = this.add.text(x + 20, y + 18, '', STYLE_DIALOG).setDepth(31);
      this.dlgMore = this.add.text(x + w - 16, y + h - 10, '>>', { fontFamily: FONT, fontSize: '12px', color: CR.yellow })
        .setOrigin(1, 1).setDepth(31);
      this.setDialogueVisible(false);
    }

    setDialogueVisible(v) {
      [this.dlgBox, this.dlgName, this.dlgText, this.dlgMore].forEach(function (o) { o.setVisible(v); });
    }

    /**
     * Show pages of text. Each page: {name (optional), text}.
     * onDone runs after the last page is closed. If a dialogue is already
     * open, the new pages are added to the end.
     */
    showDialogue(pages, onDone) {
      if (!pages || !pages.length) { if (onDone) onDone(); return; }
      if (this.dialogPages.length) {
        const prevDone = this.dialogDone;
        this.dialogPages = this.dialogPages.concat(pages);
        this.dialogDone = function () { if (prevDone) prevDone(); if (onDone) onDone(); };
        return;
      }
      this.dialogPages = pages.slice();
      this.dialogIndex = 0;
      this.dialogDone = onDone || null;
      this.setDialogueVisible(true);
      this.renderPage();
      this.refreshBusy();
    }

    renderPage() {
      const page = this.dialogPages[this.dialogIndex];
      this.dlgName.setText(page.name || '').setVisible(!!page.name);
      this.dlgText.setText(page.text);
      this.dlgMore.setText(this.dialogIndex < this.dialogPages.length - 1 ? '>>' : 'OK');
    }

    advanceDialogue() {
      this.dialogIndex++;
      if (this.dialogIndex < this.dialogPages.length) { this.renderPage(); return; }
      const done = this.dialogDone;
      this.dialogPages = [];
      this.dialogDone = null;
      this.setDialogueVisible(false);
      this.refreshBusy();
      if (done) done();
    }

    // ================================================================== MENU
    /**
     * A list of choices. options: [{label, dim}]. onPick(index) runs after
     * the menu closes; onCancel runs if the player backs out (B / X / Esc).
     */
    showMenu(config) {
      this.closeMenu();
      const opts = config.options;
      const rowH = 24, w = 420;
      const titleObj = this.add.text(0, 0, config.title || '', {
        fontFamily: FONT, fontSize: '14px', color: CR.yellow, wordWrap: { width: w - 40 }
      });
      const titleH = config.title ? titleObj.height + 12 : 0;
      const h = titleH + opts.length * rowH + 30;
      const x = (W - w) / 2, y = Math.max(8, (H - h) / 2 - 20);

      const objs = [];
      objs.push(this.add.image(x, y, FS.UIArt.panel(this, w, h)).setOrigin(0, 0));
      titleObj.setPosition(x + 20, y + 14);
      objs.push(titleObj);

      const rows = opts.map(function (opt, i) {
        const ry = y + 15 + titleH + i * rowH;
        const hit = this.add.rectangle(x + 12, ry, w - 24, rowH - 2, CR.yellowHex, 0).setOrigin(0, 0).setInteractive();
        hit.on('pointerdown', function () { this.menu.cursor = i; this.pickMenu(); }, this);
        const label = this.add.text(x + 34, ry + 3, opt.label, {
          fontFamily: FONT, fontSize: '14px', color: opt.dim ? '#b2a89a' : CR.cream
        });
        objs.push(hit, label);
        return { hit: hit, label: label };
      }, this);
      const pointer = this.add.text(x + 18, 0, '>', { fontFamily: FONT, fontSize: '14px', color: CR.yellow });
      objs.push(pointer);
      // Window at the back, text on top of it.
      objs.forEach(function (o) { o.setDepth(o === objs[0] ? 40 : 41); });

      this.menu = {
        config: config, objs: objs, rows: rows, pointer: pointer,
        cursor: Phaser.Math.Clamp(config.cursor || 0, 0, opts.length - 1)
      };
      this.drawMenuCursor();
      this.refreshBusy();
    }

    drawMenuCursor() {
      const m = this.menu;
      m.rows.forEach(function (r, i) { r.hit.setFillStyle(CR.yellowHex, i === m.cursor ? 0.18 : 0); });
      m.pointer.y = m.rows[m.cursor].label.y;
    }

    moveMenu(dir) {
      const m = this.menu, n = m.rows.length;
      m.cursor = (m.cursor + dir + n) % n;
      this.drawMenuCursor();
    }

    pickMenu() {
      const m = this.menu;
      this.closeMenu();
      if (m.config.onPick) m.config.onPick(m.cursor);
    }

    cancelMenu() {
      const m = this.menu;
      this.closeMenu();
      if (m.config.onCancel) m.config.onCancel();
    }

    closeMenu() {
      if (!this.menu) return;
      this.menu.objs.forEach(function (o) { o.destroy(); });
      this.menu = null;
      this.refreshBusy();
    }

    refreshBusy() {
      this.busy = this.dialogPages.length > 0 || !!this.menu;
    }

    // ================================================================== SHOP
    /** The seed stall. Buying keeps the menu open so several can be bought. */
    openShop(shopKey, cursor) {
      const state = FS.Session.state;
      const season = FS.State.calendar(state).season;
      const stock = FS.Items.list.filter(function (it) { return it.kind === 'seed' && it.buy > 0; });

      const options = stock.map(function (it) {
        const inSeason = FS.Crops.get(it.crop).seasons.indexOf(season) !== -1;
        return {
          label: FS.t(inSeason ? 'shop_item' : 'shop_off_season', {
            item: FS.itemName(it.id), price: FS.Wallet.format(it.currency, it.buy)
          }),
          dim: !inSeason
        };
      });
      options.push({ label: FS.t('shop_leave') });

      this.showMenu({
        title: FS.t('shop_seeds_title', { money: FS.Wallet.format('cowrie', FS.Wallet.get(state, 'cowrie')) }),
        options: options,
        cursor: cursor,
        onPick: function (i) {
          if (i >= stock.length) return;   // "Leave"
          const it = stock[i];
          if (!FS.State.canFit(state, it.key, 1)) this.toast(FS.t('msg_bag_full'));
          else if (!FS.Wallet.spend(state, it.currency, it.buy)) this.toast(FS.t('shop_no_money'));
          else {
            FS.State.addItem(state, it.key, 1);
            this.toast(FS.t('shop_bought', { item: FS.itemName(it.id) }));
          }
          this.openShop(shopKey, i);
        }.bind(this)
      });
    }

    // ============================================================== CONTROLS
    createKeyboard() {
      const kb = this.input.keyboard;
      this.keys = kb.addKeys('UP,DOWN,LEFT,RIGHT,W,A,S,D');
      kb.addCapture('SPACE');
      kb.on('keydown', this.onKeyDown, this);
    }

    onKeyDown(e) {
      if (e.repeat) return;
      const k = e.key;
      if (k === ' ' || k === 'Spacebar' || k === 'Enter' || k === 'z' || k === 'Z') { this.pressAction(); return; }
      if (k === 'x' || k === 'X' || k === 'Escape' || k === 'Backspace') { this.pressCancel(); return; }
      if (this.menu) {
        if (k === 'ArrowUp' || k === 'w' || k === 'W') this.moveMenu(-1);
        if (k === 'ArrowDown' || k === 's' || k === 'S') this.moveMenu(1);
        return;
      }
      if (this.busy) return;
      if (k >= '1' && k <= '9') this.selectSlot(Number(k) - 1);
      else if (k === '0') this.selectSlot(9);
      else if (k === 'q' || k === 'Q') this.selectSlot(FS.Session.state.selected - 1);
      else if (k === 'e' || k === 'E') this.selectSlot(FS.Session.state.selected + 1);
    }

    /** A / Space: confirm a menu, turn a dialogue page, or act in the world. */
    pressAction() {
      if (this.menu) this.pickMenu();
      else if (this.dialogPages.length) this.advanceDialogue();
      else FS.bus.emit('action');
    }

    /** B / X / Esc: back out of a menu, or turn a dialogue page. */
    pressCancel() {
      if (this.menu) this.cancelMenu();
      else if (this.dialogPages.length) this.advanceDialogue();
    }

    createTouchControls() {
      this.input.addPointer(2);          // allow moving and pressing A at once
      // D-pad: four arrow buttons around a centre point. Movement is read from
      // where the finger is relative to the centre (see readTouchPad), so
      // sliding between arrows and diagonals both work.
      this.pad = { x: 70, y: H - 84, r: 54 };
      this.padButtons = {};
      [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]].forEach(function (d) {
        this.padButtons[d[0]] = this.add.image(this.pad.x + d[1] * 34, this.pad.y + d[2] * 34, 'ui_buttons', d[0])
          .setScale(0.72).setAlpha(0.85).setDepth(50);
      }, this);

      // A (check) = use / talk / confirm.  B (back) = close.
      const makeButton = function (x, y, frame, scale, handler) {
        const btn = this.add.image(x, y, 'ui_buttons', frame).setScale(scale).setAlpha(0.9).setDepth(50).setInteractive();
        btn.on('pointerdown', function () { btn.setFrame(frame + '_p'); handler.call(this); }, this);
        btn.on('pointerup', function () { btn.setFrame(frame); });
        btn.on('pointerout', function () { btn.setFrame(frame); });
      }.bind(this);
      makeButton(W - 58, H - 106, 'check', 0.85, this.pressAction);
      makeButton(W - 58, H - 62, 'back', 0.7, this.pressCancel);
      this.padPrev = { up: false, down: false };
    }

    /** Read the on-screen pad from any finger touching it. */
    readTouchPad() {
      const out = { up: false, down: false, left: false, right: false };
      if (!this.pad) return out;
      const pad = this.pad;
      this.input.manager.pointers.forEach(function (p) {
        if (!p.isDown) return;
        const dx = p.x - pad.x, dy = p.y - pad.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > pad.r * 1.4 || dist < 8) return;   // outside the pad, or dead zone
        // 8 directions: a direction counts if the finger is clearly that way.
        out.right = dx > dist * 0.38;
        out.left = dx < -dist * 0.38;
        out.down = dy > dist * 0.38;
        out.up = dy < -dist * 0.38;
      });
      // Show pressed arrows.
      Object.keys(this.padButtons).forEach(function (k) {
        this.padButtons[k].setFrame(out[k] ? k + '_p' : k);
      }, this);
      return out;
    }

    updateControls() {
      const k = this.keys;
      const t = this.readTouchPad();
      FS.Controls.up = k.UP.isDown || k.W.isDown || t.up;
      FS.Controls.down = k.DOWN.isDown || k.S.isDown || t.down;
      FS.Controls.left = k.LEFT.isDown || k.A.isDown || t.left;
      FS.Controls.right = k.RIGHT.isDown || k.D.isDown || t.right;

      // Let the touch pad move the menu cursor (one step per push).
      if (this.pad) {
        if (this.menu && t.up && !this.padPrev.up) this.moveMenu(-1);
        if (this.menu && t.down && !this.padPrev.down) this.moveMenu(1);
        this.padPrev.up = t.up;
        this.padPrev.down = t.down;
      }
    }

    // ================================================================ UPDATE
    update(time, delta) {
      this.updateControls();
      this.updateWeather(delta);
      this.updateHud();
      this.updateHotbar();
      this.updateToast();
    }
  }

  FS.UIScene = UIScene;
})(FarmSim);
