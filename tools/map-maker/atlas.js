/*
 * atlas.js: draws the game's tile image (assets/tiles.png) and animated-object image
 * (assets/objects.png) from the pictures in art-src/, following the plan that tools/map_maker.py
 * works out from the tile list (maps-src/tiles.json). Used by the map maker's page.
 *
 *   Atlas.compose(plan, columns) -> Promise<{tiles: canvas, objects: canvas, missing: [paths]}>
 *
 * A plan slot is one of:
 *   {}                                   a blank tile
 *   {src, x, y, recolor?}                a 16x16 tile from a sheet (column x, row y); recolor is a
 *                                        list of ["rrggbb", "rrggbb"] pairs: exact colours to swap
 *   {auto: {src, x, y, step}, quarters, frame, under}
 *                                        an autotile piece: four 8x8 quarters from the autotile's
 *                                        2x3-tile block (moved `step` tiles right per frame), drawn
 *                                        over the `under` tile
 */
'use strict';

const Atlas = (function () {
  const T = 16;
  const cache = {};

  function loadImage(src) {
    if (!cache[src]) {
      cache[src] = new Promise(ok => {
        const im = new Image();
        im.onload = () => ok(im);
        im.onerror = () => ok(null);
        im.src = '/art-src/' + src.split('/').map(encodeURIComponent).join('/');
      });
    }
    return cache[src];
  }

  function hex(c) { return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)]; }

  /** Swap exact colours in a region of a canvas. */
  function recolor(ctx, x, y, w, h, pairs) {
    if (!pairs || !pairs.length) return;
    const map = pairs.map(p => [hex(p[0]), hex(p[1])]);
    const img = ctx.getImageData(x, y, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!d[i + 3]) continue;
      for (let k = 0; k < map.length; k++) {
        const a = map[k][0];
        if (d[i] === a[0] && d[i + 1] === a[1] && d[i + 2] === a[2]) { d[i] = map[k][1][0]; d[i + 1] = map[k][1][1]; d[i + 2] = map[k][1][2]; break; }
      }
    }
    ctx.putImageData(img, x, y);
  }

  function srcOf(slot) {
    if (slot.src) return [slot.src];
    if (slot.auto) return [slot.auto.src].concat(slot.under && slot.under.src ? [slot.under.src] : []);
    return [];
  }

  /** Draws one slot at (dx, dy) of ctx. images: {src: Image}. */
  function drawSlot(ctx, slot, dx, dy, images) {
    if (slot.src) {
      const im = images[slot.src];
      if (!im) return;
      ctx.drawImage(im, slot.x * T, slot.y * T, T, T, dx, dy, T, T);
      recolor(ctx, dx, dy, T, T, slot.recolor);
    } else if (slot.auto) {
      if (slot.under && slot.under.src) drawSlot(ctx, slot.under, dx, dy, images);
      const a = slot.auto, im = images[a.src];
      if (!im) return;
      const ox = (a.x + slot.frame * a.step) * T, oy = a.y * T;
      slot.quarters.forEach((q, i) => {
        ctx.drawImage(im, ox + q[0] * 8, oy + q[1] * 8, 8, 8, dx + (i % 2) * 8, dy + Math.floor(i / 2) * 8, 8, 8);
      });
    }
  }

  async function compose(plan, columns, objectsWidth, objectsHeight) {
    const srcs = new Set();
    plan.slots.forEach(s => srcOf(s).forEach(x => srcs.add(x)));
    plan.objects.forEach(o => srcs.add(o.src));
    const images = {}, missing = [];
    await Promise.all([...srcs].map(async s => { images[s] = await loadImage(s); if (!images[s]) missing.push(s); }));
    const rows = Math.max(1, Math.ceil(plan.slots.length / columns));
    const tiles = document.createElement('canvas');
    tiles.width = columns * T;
    tiles.height = rows * T;
    const ctx = tiles.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    plan.slots.forEach((s, i) => drawSlot(ctx, s, (i % columns) * T, Math.floor(i / columns) * T, images));
    const objects = document.createElement('canvas');
    objects.width = objectsWidth || 512;
    objects.height = Math.max(1, objectsHeight || plan.objects.reduce((h, o) => Math.max(h, o.dy + o.h), 1));
    const octx = objects.getContext('2d');
    octx.imageSmoothingEnabled = false;
    plan.objects.forEach(o => { if (images[o.src]) octx.drawImage(images[o.src], o.sx, o.sy, o.w, o.h, o.dx, o.dy, o.w, o.h); });
    return { tiles: tiles, objects: objects, missing: missing };
  }

  return { compose: compose, loadImage: loadImage, drawSlot: drawSlot, T: T };
})();
