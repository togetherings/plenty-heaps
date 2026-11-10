/**
 * charRecolor.js
 * ==============
 * The pixel-level palette swap for characters (see data/appearance.js for
 * the idea). Works on raw RGBA pixel arrays, so it has no Phaser code and is
 * tested in Node. CharacterArt.js feeds it pixels from a canvas.
 *
 * Character sheets are 3 frames wide x 4 directions tall, each frame 16x32.
 * In every frame the neck is at row 21 and the waist at row 25 (one row
 * higher in the middle "standing" frame, because the body bobs up).
 */
(function (FS) {
  'use strict';

  const FRAME_W = 16, FRAME_H = 32;
  const NECK_ROW = 21, WAIST_ROW = 25;

  /** Index of `rgb` in a list of [r,g,b] keys, or -1. */
  function keyIndex(keys, r, g, b) {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k[0] === r && k[1] === g && k[2] === b) return i;
    }
    return -1;
  }

  function put(px, i, c) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; }

  FS.CharRecolor = {
    FRAME_W: FRAME_W,
    FRAME_H: FRAME_H,

    /**
     * Recolour a body sheet in place: skin above the neck, clothes below.
     * px = RGBA array, width = sheet width in pixels. `outline` (optional)
     * replaces the outline colour.
     */
    body: function (px, width, skinColors, outfit, outline) {
      const keys = FS.Appearance.SKIN_KEYS;
      const ol = FS.Appearance.OUTLINE;
      const bottom = outfit.onePiece ? outfit.top : outfit.bottom;
      const height = px.length / 4 / width;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (px[i + 3] === 0) continue;
          if (outline && px[i] === ol[0] && px[i + 1] === ol[1] && px[i + 2] === ol[2]) {
            put(px, i, outline);                      // darker outline/eyes for deep tones
            continue;
          }
          const k = keyIndex(keys, px[i], px[i + 1], px[i + 2]);
          if (k < 0) continue;                        // eye whites, mouth: keep
          const col = Math.floor(x / FRAME_W) % 3;
          const fy = y % FRAME_H;
          const bob = col === 1 ? -1 : 0;             // middle frame sits 1px higher
          if (fy < NECK_ROW + bob) {
            put(px, i, skinColors[k]);
          } else if (fy <= WAIST_ROW + bob) {
            put(px, i, outfit.top[k]);
          } else {
            // Dotted tie-dye pattern on wraps: some base pixels become highlights.
            const dot = outfit.pattern && k === 1 && ((x % FRAME_W) + fy) % 3 === 0;
            put(px, i, bottom[dot ? 2 : k]);
          }
        }
      }
    },

    /** Recolour a hair sheet in place. */
    hair: function (px, hairColors) {
      const keys = FS.Appearance.HAIR_KEYS;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        const k = keyIndex(keys, px[i], px[i + 1], px[i + 2]);
        if (k >= 0) put(px, i, hairColors[k]);
      }
    }
  };
})(FarmSim);
