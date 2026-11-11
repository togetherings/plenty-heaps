/**
 * BootScene.js
 * ============
 * Runs once at start-up:
 *   1. Loads the images (tiles, animated objects, characters, hair, critters,
 *      icons, UI) and makes the animated tile texture (TileArt.js).
 *   2. Registers the Tiled maps (already loaded as scripts) with Phaser.
 *   3. Builds every villager's sprite sheet from their look (npcs.js), and
 *      the player's if they have already made their character.
 *   4. Starts the character creation screen (new game), or the UI scene and
 *      the World scene in the right place: where the player was during a
 *      mid-day save, or at home for a new day.
 */
(function (FS) {
  'use strict';

  const C = FS.Config;

  // Ambient animals. Each sheet is 3 frames x 4 directions.
  FS.CRITTERS = {
    crab: { frameWidth: 16, frameHeight: 16, speed: 14 },
    hen: { frameWidth: 16, frameHeight: 32, speed: 16 },
    chick: { frameWidth: 16, frameHeight: 16, speed: 18 }
  };

  class BootScene extends Phaser.Scene {
    constructor() { super('Boot'); }

    preload() {
      // Simple loading bar - on a slow device the first load can take a moment.
      const w = C.GAME_WIDTH, h = C.GAME_HEIGHT;
      const bar = this.add.rectangle(w / 2 - 100, h / 2, 0, 8, 0xffe484).setOrigin(0, 0.5);
      this.add.rectangle(w / 2, h / 2, 204, 12).setStrokeStyle(1, 0xf8f4de);
      this.load.on('progress', function (p) { bar.width = 200 * p; });

      this.load.image('tiles_src', 'assets/tiles.png');
      this.load.image('objects', 'assets/objects.png');
      this.load.spritesheet('items', 'assets/items.png', { frameWidth: 16, frameHeight: 16 });
      this.load.image('body_m', 'assets/chars/body_m.png');
      this.load.image('body_f', 'assets/chars/body_f.png');
      this.load.image('hair', 'assets/chars/hair.png');
      Object.keys(FS.CRITTERS).forEach(function (k) {
        const c = FS.CRITTERS[k];
        this.load.spritesheet(k, 'assets/chars/' + k + '.png', { frameWidth: c.frameWidth, frameHeight: c.frameHeight });
      }, this);
      this.load.image('ui_window', 'assets/ui/window.png');
      this.load.image('ui_buttons', 'assets/ui/buttons.png');
    }

    create() {
      // The tile texture (with animated tiles) and the animated objects.
      // (The World scene hands Phaser each map as it looks at the moment: see mapView.js.)
      FS.TileArt.init(this);

      // Critter walking animations (frames 0,1,2,1 per direction row).
      Object.keys(FS.CRITTERS).forEach(function (k) { FS.CharacterArt.makeWalkAnims(this, k, 6); }, this);

      // Villagers' sprites, made from their looks.
      FS.Npcs.list.forEach(function (npc) { FS.CharacterArt.build(this, 'char-' + npc.key, npc.look); }, this);

      FS.UIArt.makeTextures(this);

      const state = FS.Session.state;
      if (!state.look) {
        this.scene.start('Create');     // new game: make a character first
        return;
      }
      FS.CharacterArt.build(this, 'char-player', state.look);
      FS.startWorld(this, true);
    }
  }

  /**
   * Start (or continue) the game world: the UI scene plus the World scene
   * where the player should be. Used by Boot and by the creation screen.
   */
  FS.startWorld = function (scene, firstLoad) {
    const state = FS.Session.state;
    const data = state.pos
      ? { area: state.pos.area, resumeAt: { x: state.pos.x, y: state.pos.y, facing: state.pos.facing } }
      : { area: FS.Areas.HOME.area, spawn: FS.Areas.HOME.spawn };
    data.firstLoad = !!firstLoad;
    scene.scene.launch('UI');       // HUD, dialogue and controls (always running)
    scene.scene.start('World', data);
  };

  FS.BootScene = BootScene;
})(FarmSim);
