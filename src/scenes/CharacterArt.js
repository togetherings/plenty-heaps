/**
 * CharacterArt.js
 * ===============
 * Builds a character's sprite sheet from a "look" (body, skin, hair, hair
 * colour, outfit) and registers it with Phaser, plus walking animations.
 *
 *   FarmSim.CharacterArt.build(scene, 'char-player', look)
 *
 * It draws the body sheet onto a canvas, palette-swaps it (charRecolor.js),
 * draws the recoloured hair on top, and makes Phaser frames 0-11:
 *
 *      frame = directionRow * 3 + step      rows: down, left, right, up
 *      steps: 0 = left foot, 1 = standing, 2 = right foot
 *
 * Calling build() again with the same key redraws the same texture (used by
 * the character creation screen when a choice changes), so sprites already
 * using it simply update.
 */
(function (FS) {
  'use strict';

  const ROWS = { down: 0, left: 1, right: 2, up: 3 };
  const W = 48, H = 128;   // one character sheet: 3 x 16 by 4 x 32

  /** Copy part of an image into a new canvas and return its pixels. */
  function pixelsOf(image, sx, sy) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.drawImage(image, sx, sy, W, H, 0, 0, W, H);
    return { canvas: c, ctx: ctx, data: ctx.getImageData(0, 0, W, H) };
  }

  FS.CharacterArt = {
    ROWS: ROWS,

    /** Frame number for a direction and step (default: standing). */
    frame: function (dir, step) {
      return ROWS[dir] * 3 + (step === undefined ? 1 : step);
    },

    build: function (scene, key, look) {
      const A = FS.Appearance;
      const body = A.bodies.get(look.body);
      const skin = A.skins.get(look.skin);
      const hair = A.hairs.get(look.hair);
      const hairColor = A.hairColors.get(look.hairColor);
      const outfit = A.outfits.get(look.outfit);

      // Body: skin and clothes.
      const b = pixelsOf(scene.textures.get(body.texture).getSourceImage(), 0, 0);
      FS.CharRecolor.body(b.data.data, W, skin.colors, outfit, skin.outline);
      b.ctx.putImageData(b.data, 0, 0);

      // Hair on top.
      if (hair.col >= 0) {
        const h = pixelsOf(scene.textures.get('hair').getSourceImage(), hair.col * W, 0);
        FS.CharRecolor.hair(h.data.data, hairColor.colors);
        h.ctx.putImageData(h.data, 0, 0);
        b.ctx.drawImage(h.canvas, 0, 0);
      }

      // Into a Phaser canvas texture (created once, then redrawn).
      let tex = scene.textures.exists(key) ? scene.textures.get(key) : null;
      if (!tex) {
        tex = scene.textures.createCanvas(key, W, H);
        for (let i = 0; i < 12; i++) tex.add(i, 0, (i % 3) * 16, Math.floor(i / 3) * 32, 16, 32);
      }
      tex.context.clearRect(0, 0, W, H);
      tex.context.drawImage(b.canvas, 0, 0);
      tex.refresh();

      FS.CharacterArt.makeWalkAnims(scene, key, 8);
      return key;
    },

    /** Walking animations "<key>-walk-<dir>", stepping 0,1,2,1. */
    makeWalkAnims: function (scene, key, rate) {
      Object.keys(ROWS).forEach(function (dir) {
        const ak = key + '-walk-' + dir;
        if (scene.anims.exists(ak)) return;
        const r = ROWS[dir];
        scene.anims.create({
          key: ak,
          frames: [0, 1, 2, 1].map(function (c) { return { key: key, frame: r * 3 + c }; }),
          frameRate: rate,
          repeat: -1
        });
      });
    }
  };
})(FarmSim);
