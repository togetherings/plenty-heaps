/**
 * CreateScene.js
 * ==============
 * The character creation screen, shown once at the start of a new game.
 * The player chooses:
 *
 *   Body         Boy / Girl (decides the starting outfit)
 *   Skin         colour swatches (no names, on purpose)
 *   Hair         style, with arrows
 *   Hair colour  colour swatches
 *
 * A large preview walks in place and turns, and is redrawn instantly when a
 * choice changes (it's the same palette swap the game uses; see
 * CharacterArt.js). "Start farming!" saves the look and starts the game.
 *
 * Controls: Up/Down choose a row, Left/Right change it, Space/Enter on the
 * last row starts. Everything can also be tapped.
 *
 * To offer more options, add entries in data/appearance.js - this screen
 * builds its rows from those lists.
 */
(function (FS) {
  'use strict';

  const C = FS.Config;
  const W = C.GAME_WIDTH, H = C.GAME_HEIGHT;
  const FONT = 'Verdana, Arial, sans-serif';

  function hex(rgb) { return Phaser.Display.Color.GetColor(rgb[0], rgb[1], rgb[2]); }

  class CreateScene extends Phaser.Scene {
    constructor() { super('Create'); }

    create() {
      const A = FS.Appearance;
      const CR = FS.Colors;
      this.look = FS.Session.state.look ? Object.assign({}, FS.Session.state.look) : A.defaultLook();
      this.row = 0;
      this.cameras.main.setBackgroundColor('#3a683d');

      // Rows: each has a list of option keys and the look field it changes.
      this.rows = [
        { field: 'body', label: 'create_body', options: A.bodies.list.map(function (b) { return b.key; }) },
        { field: 'skin', label: 'create_skin', options: A.skins.list.map(function (s) { return s.key; }), swatches: A.skins },
        { field: 'hair', label: 'create_hair', options: A.hairs.list.map(function (h) { return h.key; }) },
        { field: 'hairColor', label: 'create_hair_color', options: A.hairColors.list.map(function (h) { return h.key; }), swatches: A.hairColors },
        { done: true }
      ];

      // ---- Left: preview
      this.add.image(14, 14, FS.UIArt.panel(this, 196, 332)).setOrigin(0, 0);
      FS.CharacterArt.build(this, 'char-player', this.look);
      this.preview = this.add.sprite(112, 196, 'char-player', 1).setScale(5);
      this.previewDirs = ['down', 'left', 'up', 'right'];
      this.previewDir = 0;
      this.preview.anims.play('char-player-walk-down');
      this.time.addEvent({ delay: 1600, loop: true, callback: this.turnPreview, callbackScope: this });

      // ---- Right: title and rows
      this.add.image(220, 14, FS.UIArt.panel(this, 406, 332)).setOrigin(0, 0);
      this.add.text(423, 34, FS.t('create_title'), { fontFamily: FONT, fontSize: '24px', color: CR.yellow, stroke: CR.dark, strokeThickness: 4 }).setOrigin(0.5, 0);
      this.add.text(423, 66, FS.t('create_subtitle'), { fontFamily: FONT, fontSize: '13px', color: CR.cream }).setOrigin(0.5, 0);

      this.rowY = [104, 148, 192, 236, 300];
      this.highlight = this.add.rectangle(234, 0, 378, 38, CR.yellowHex, 0.16).setOrigin(0, 0.5);
      this.widgets = [];
      this.rows.forEach(function (row, i) { this.buildRow(row, i); }, this);

      const touch = this.sys.game.device.input.touch || C.FORCE_TOUCH === true;
      this.add.text(423, 330, FS.t(touch ? 'create_help_touch' : 'create_help_keys'), {
        fontFamily: FONT, fontSize: '10px', color: CR.sky, align: 'center', wordWrap: { width: 380 }
      }).setOrigin(0.5, 1);

      this.input.keyboard.on('keydown', this.onKey, this);
      this.input.on('pointerdown', function () { try { window.focus(); } catch (e) { /* ignore */ } });
      this.refresh();
    }

    // --------------------------------------------------------------- building
    buildRow(row, i) {
      const CR = FS.Colors;
      const y = this.rowY[i];
      const w = { row: row };
      this.widgets[i] = w;

      if (row.done) {
        const btn = this.add.image(423, y, FS.UIArt.panel(this, 200, 40)).setInteractive();
        this.add.image(352, y, 'ui_buttons', 'check').setScale(0.5);
        this.add.text(436, y, FS.t('create_done'), { fontFamily: FONT, fontSize: '15px', color: CR.yellow }).setOrigin(0.5);
        btn.on('pointerdown', function () { this.row = i; this.finish(); }, this);
        return;
      }

      this.add.text(244, y, FS.t(row.label), { fontFamily: FONT, fontSize: '13px', color: CR.cream }).setOrigin(0, 0.5);

      if (row.swatches) {
        // Colour swatches
        w.swatches = row.options.map(function (key, j) {
          const entry = row.swatches.get(key);
          const rgb = entry.swatch || entry.colors[1];
          const sw = this.add.rectangle(352 + j * 32, y, 26, 26, hex(rgb)).setInteractive();
          sw.on('pointerdown', function () { this.row = i; this.set(row, key); }, this);
          return sw;
        }, this);
      } else if (row.field === 'body') {
        // Two (or more) labelled choices
        w.choices = row.options.map(function (key, j) {
          const x = 380 + j * 110;
          const box = this.add.rectangle(x, y, 96, 28, CR.blueHex, 1).setInteractive();
          const label = this.add.text(x, y, FS.t('body_' + key), { fontFamily: FONT, fontSize: '14px', color: CR.cream }).setOrigin(0.5);
          box.on('pointerdown', function () { this.row = i; this.set(row, key); }, this);
          return { box: box, label: label };
        }, this);
      } else {
        // < value >
        const left = this.add.image(372, y, 'ui_buttons', 'left').setScale(0.6).setInteractive();
        const right = this.add.image(572, y, 'ui_buttons', 'right').setScale(0.6).setInteractive();
        left.on('pointerdown', function () { this.row = i; this.step(row, -1); }, this);
        right.on('pointerdown', function () { this.row = i; this.step(row, 1); }, this);
        w.value = this.add.text(472, y, '', { fontFamily: FONT, fontSize: '14px', color: CR.cream }).setOrigin(0.5);
      }
    }

    // ---------------------------------------------------------------- choices
    set(row, key) {
      this.look[row.field] = key;
      if (row.field === 'body') {
        // Each body starts in its own farm clothes (more outfits come later).
        this.look.outfit = FS.Appearance.bodies.get(key).defaultOutfit;
      }
      FS.CharacterArt.build(this, 'char-player', this.look);
      this.refresh();
    }

    step(row, dir) {
      const n = row.options.length;
      const i = row.options.indexOf(this.look[row.field]);
      this.set(row, row.options[(i + dir + n) % n]);
    }

    /** Redraw selection marks to match this.look and the current row. */
    refresh() {
      const CR = FS.Colors;
      this.highlight.y = this.rowY[this.row];
      this.highlight.setSize(this.rows[this.row].done ? 0 : 378, 38);
      this.widgets.forEach(function (w) {
        const row = w.row;
        if (row.done) return;
        const current = this.look[row.field];
        if (w.swatches) {
          w.swatches.forEach(function (sw, j) {
            const on = row.options[j] === current;
            sw.setStrokeStyle(on ? 3 : 2, on ? CR.yellowHex : CR.darkHex, 1);
          });
        } else if (w.choices) {
          w.choices.forEach(function (c, j) {
            const on = row.options[j] === current;
            c.box.setStrokeStyle(on ? 3 : 2, on ? CR.yellowHex : CR.darkHex, 1);
            c.box.setFillStyle(on ? CR.blueHex : 0x3a4a5a, 1);
          });
        } else {
          w.value.setText(FS.t(row.field + '_' + current));
        }
      }, this);
    }

    turnPreview() {
      this.previewDir = (this.previewDir + 1) % 4;
      this.preview.anims.play('char-player-walk-' + this.previewDirs[this.previewDir]);
    }

    // ----------------------------------------------------------------- input
    onKey(e) {
      const k = e.key;
      const row = this.rows[this.row];
      if (k === 'ArrowUp' || k === 'w' || k === 'W') { this.row = (this.row + this.rows.length - 1) % this.rows.length; this.refresh(); }
      else if (k === 'ArrowDown' || k === 's' || k === 'S') { this.row = (this.row + 1) % this.rows.length; this.refresh(); }
      else if (!row.done && (k === 'ArrowLeft' || k === 'a' || k === 'A')) this.step(row, -1);
      else if (!row.done && (k === 'ArrowRight' || k === 'd' || k === 'D')) this.step(row, 1);
      else if (k === ' ' || k === 'Enter' || k === 'z' || k === 'Z') {
        if (row.done) this.finish(); else this.step(row, 1);
      }
    }

    finish() {
      if (this.finished) return;
      this.finished = true;
      const state = FS.Session.state;
      FS.State.setLook(state, this.look);
      FS.Session.save();
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', function () { FS.startWorld(this, true); }, this);
    }
  }

  FS.CreateScene = CreateScene;
})(FarmSim);
