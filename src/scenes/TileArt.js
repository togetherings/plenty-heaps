/**
 * TileArt.js
 * ==========
 * The tile image and the animated objects, made ready by the Boot scene.
 *
 * TILES: assets/tiles.png is loaded as "tiles_src" and copied into a canvas
 * texture called "tiles", which every map uses. Animated tiles (water...)
 * are animated by drawing their next frame into their own place in that
 * canvas a few times a second (FarmSim.Tiles.anims), so every square showing
 * them moves together. It works the same with the WebGL and Canvas renderers.
 *
 * OBJECTS: assets/objects.png holds the frames of animated objects (shore
 * foam, a school of fish, drying clothes...): FarmSim.Tiles.objects gives each
 * one's frames. Each becomes a Phaser animation called "obj-<name>".
 */
(function (FS) {
  'use strict';

  const T = 16;

  FS.TileArt = {
    /** Make the "tiles" canvas texture and the objects' frames and animations. */
    init: function (scene) {
      const src = scene.textures.get('tiles_src').getSourceImage();
      if (scene.textures.exists('tiles')) scene.textures.remove('tiles');
      const tex = scene.textures.createCanvas('tiles', src.width, src.height);
      tex.context.drawImage(src, 0, 0);
      tex.refresh();
      this.src = src;
      this.tex = tex;
      this.cols = Math.floor(src.width / T);
      this.shown = {};
      this.anims = Object.keys(FS.Tiles.anims || {}).map(function (slot) {
        const a = FS.Tiles.anims[slot];
        return { slot: Number(slot), frames: a.frames, ms: a.ms };
      });

      const objs = scene.textures.get('objects');
      Object.keys(FS.Tiles.objects || {}).forEach(function (name) {
        const def = FS.Tiles.objects[name];
        const frames = def.frames.map(function (r, i) {
          const key = name + '_' + i;
          if (!objs.has(key)) objs.add(key, 0, r[0], r[1], r[2], r[3]);
          return { key: 'objects', frame: key };
        });
        if (!scene.anims.exists('obj-' + name)) {
          scene.anims.create({ key: 'obj-' + name, frames: frames, frameRate: 1000 / def.ms, repeat: -1 });
        }
      });
    },

    /**
     * Animate only the tiles a map shows (layers: arrays of gids), so maps without animated
     * tiles cost nothing: the tile image is only sent to the graphics card when a frame changes.
     */
    use: function (layers) {
      const shown = {};
      layers.forEach(function (data) {
        for (let i = 0; i < data.length; i++) if (data[i]) shown[FS.MapView.index(data[i])] = true;
      });
      this.active = this.anims.filter(function (a) { return shown[a.slot]; });
    },

    /** Show each animated tile's frame for this moment (time in ms). */
    update: function (time) {
      if (!this.tex) return;
      const ctx = this.tex.context, cols = this.cols, list = this.active || this.anims;
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const f = a.frames[Math.floor(time / a.ms) % a.frames.length];
        if (this.shown[a.slot] === f) continue;
        this.shown[a.slot] = f;
        const dx = (a.slot % cols) * T, dy = Math.floor(a.slot / cols) * T;
        ctx.clearRect(dx, dy, T, T);
        ctx.drawImage(this.src, (f % cols) * T, Math.floor(f / cols) * T, T, T, dx, dy, T, T);
        changed = true;
      }
      if (changed) this.tex.refresh();
    },

    /** Size of an animated object's frames: [w, h]. */
    objectSize: function (name) {
      const def = FS.Tiles.objects[name];
      return def ? [def.frames[0][2], def.frames[0][3]] : [16, 16];
    }
  };
})(FarmSim);
