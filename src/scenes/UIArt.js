/**
 * UIArt.js
 * ========
 * Turns the Petixel UI images into things the UI can draw:
 *
 *   FarmSim.UIArt.panel(scene, w, h)   -> texture key of a framed window of
 *                                         that size (built once, then reused)
 *   'ui_buttons' frames                -> 'back', 'check', 'up', 'down',
 *                                         'left', 'right', 'menu' (+ '_p' =
 *                                         pressed), e.g. add.image(x, y,
 *                                         'ui_buttons', 'check')
 *
 * WHY NOT PHASER'S NineSlice? It only works with the WebGL renderer, and
 * older phones may fall back to Canvas. Drawing the frame onto a canvas
 * texture works with both.
 *
 * The window skin (assets/ui/window.png) follows the RPG Maker layout:
 *   (0,0)-(96,96)   background fill
 *   (96,0)-(192,96) frame: 16px corners and edges are used here
 */
(function (FS) {
  'use strict';

  const CORNER = 16;
  const FRAME_X = 96;      // frame area in window.png
  const FRAME_SIZE = 96;

  // Colours from the Petixel palette, for code that draws shapes or text.
  FS.Colors = {
    cream: '#f8f4de', yellow: '#ffe484', dark: '#593b3d', blue: '#206fa9', sky: '#b2d0ff',
    creamHex: 0xf8f4de, yellowHex: 0xffe484, darkHex: 0x593b3d, blueHex: 0x206fa9,
    panelFill: 'rgba(32, 72, 110, 0.94)'
  };

  FS.UIArt = {
    /** Called once at boot: name the frames of the button sheet. */
    makeTextures: function (scene) {
      const tex = scene.textures.get('ui_buttons');
      if (tex.has('check')) return;
      const defs = { back: [0, 96], left: [96, 48], right: [144, 48], down: [192, 48], up: [240, 48], check: [384, 96], menu: [480, 48] };
      Object.keys(defs).forEach(function (name) {
        const x = defs[name][0], w = defs[name][1];
        tex.add(name, 0, x, 0, w, 48);
        tex.add(name + '_p', 0, x, 48, w, 48);
      });
    },

    /** A framed window texture of the given size. */
    panel: function (scene, w, h) {
      w = Math.round(w); h = Math.round(h);
      const key = 'panel-' + w + 'x' + h;
      if (scene.textures.exists(key)) return key;
      const src = scene.textures.get('ui_window').getSourceImage();
      const tex = scene.textures.createCanvas(key, w, h);
      const ctx = tex.context;
      ctx.imageSmoothingEnabled = false;

      // Background, inset so it sits inside the rounded frame.
      ctx.fillStyle = FS.Colors.panelFill;
      ctx.fillRect(4, 4, w - 8, h - 8);

      const c = CORNER, fx = FRAME_X, fs = FRAME_SIZE;
      const inner = fs - 2 * c;
      // corners
      ctx.drawImage(src, fx, 0, c, c, 0, 0, c, c);
      ctx.drawImage(src, fx + fs - c, 0, c, c, w - c, 0, c, c);
      ctx.drawImage(src, fx, fs - c, c, c, 0, h - c, c, c);
      ctx.drawImage(src, fx + fs - c, fs - c, c, c, w - c, h - c, c, c);
      // edges, stretched along their length (they're plain lines, so this is crisp)
      ctx.drawImage(src, fx + c, 0, inner, c, c, 0, w - 2 * c, c);
      ctx.drawImage(src, fx + c, fs - c, inner, c, c, h - c, w - 2 * c, c);
      ctx.drawImage(src, fx, c, c, inner, 0, c, c, h - 2 * c);
      ctx.drawImage(src, fx + fs - c, c, c, inner, w - c, c, c, h - 2 * c);
      tex.refresh();
      return key;
    }
  };
})(FarmSim);
