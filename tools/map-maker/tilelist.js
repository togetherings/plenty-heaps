/*
 * The tile list (maps-src/tiles.json) in the map maker: add tiles from the art in art-src/, give a
 * tile a new picture (even the ones the game's code uses), make recoloured copies, animate tiles,
 * add autotiles and animated objects, set the seasons' swap rules and the shore foam.
 *
 * Any change to the pictures redraws the game's tile image in the page (atlas.js) from the plan the
 * server works out (/api/plan); saving writes it to assets/tiles.png. That needs the art packs in
 * art-src/, so without them only the parts that don't change pictures work (solid, names, seasons,
 * shore foam).
 */
'use strict';

let sourceSel = null;          // {x0, y0, x1, y1} in 16 px squares of the source sheet
let sourceName = '';
let sourceImage = null;
let ruleFrom = null, ruleTo = null;
let ruleSeason = 'harmattan';
const SZ = 2;                  // the source sheet is shown at 2x

function catTiles() { return P.catalog.tiles; }
function haveArt() { return P.sources && P.sources.length > 0; }

/** Something in the tile list changed: work out the new plan, redraw the tile image if needed. */
async function refreshCatalog(message) {
  catalogDirty = true;
  markDirty();
  const r = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalog: P.catalog }) });
  const plan = await r.json();
  if (!r.ok) { alert('The tile list has a problem: ' + (plan.error || r.status)); return; }
  if (plan.meta.planHash !== P.composedHash) {
    status('Drawing the tiles…');
    const res = await Atlas.compose(plan, plan.meta.columns, plan.meta.objectsWidth, plan.meta.objectsHeight);
    if (res.missing.length) alert('These pictures are missing from art-src/: ' + res.missing.join(', '));
    tilesImage = res.tiles;
    objectsImage = res.objects;
    P.composedHash = plan.meta.planHash;
  }
  plan.meta.drawnHash = P.tiles.drawnHash;
  setTileMeta(plan.meta);
  if (plan.problems && plan.problems.length) status('Tile list: ' + plan.problems[0]);
  else status(message || 'Not saved yet');
  drawPalette();
  drawStamps();
  showTileList();
  requestDraw();
}

/** Every use of tile numbers in maps and stamps, renumbered by fn(old) -> new. */
function renumberTiles(fn) {
  Object.values(P.maps).forEach(m => m.layers.forEach(l => {
    if (l.type !== 'tilelayer' || l.name === 'collision' || l.name === 'tide') return;
    l.data = l.data.map(g => (g ? gidFlags(g) + fn(gidIdx(g)) + 1 : 0));
  }));
  P.stamps.forEach(st => Object.keys(st.layers).forEach(k => {
    st.layers[k] = st.layers[k].map(v => (v < 0 ? v : gidFlags(v + 1) + fn(cellIdx(v))));
  }));
  brush = { w: 1, h: 1, layers: { current: [tileIdx('grass') || 0] } };
  clipboard = null;
}

function tileUsed(i) {
  const inMaps = Object.values(P.maps).some(m => m.layers.some(l => l.type === 'tilelayer' && l.name !== 'collision' && l.name !== 'tide' &&
    l.data.some(g => g && gidIdx(g) === i)));
  const inStamps = P.stamps.some(st => Object.values(st.layers).some(a => a.some(v => cellIdx(v) === i)));
  return inMaps || inStamps;
}

function uniqueTileName(base) {
  const names = new Set(catTiles().map(t => t.name));
  base = base.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 36) || 'tile';
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(base + '_' + i)) return base + '_' + i;
}

// ------------------------------------------------------------ the buttons under the palette
function showTileButtons() {
  const box = $('tile-buttons');
  box.textContent = '';
  const chosen = chosenTiles(), one = chosen.length === 1 ? catTiles()[chosen[0]] : null;
  box.appendChild(el('button', { text: 'Solid / walkable', title: 'Make the chosen tiles solid, or walkable, on every map', onclick: toggleSolid }));
  box.appendChild(el('button', { text: 'Rename…', disabled: !one || !!one.locked, title: one && one.locked ? 'The game\'s code uses this name' : '', onclick: () => renameTile(chosen[0]) }));
  box.appendChild(el('button', { text: 'Recoloured copy…', disabled: !haveArt(), title: 'New tiles: the chosen ones with colours swapped', onclick: recolorDialog }));
  box.appendChild(el('button', { class: 'danger', text: 'Remove…', disabled: !haveArt(), title: 'Remove the chosen tiles from the list (only ones no map uses)', onclick: removeTiles }));
  if (!haveArt()) box.appendChild(el('p', { class: 'hint', text: 'The art packs aren\'t in art-src/ on this computer, so tiles can\'t be added or redrawn here. You can still paint, and change solid, names, seasons and shore foam.' }));
}

function toggleSolid() {
  const list = chosenTiles();
  const make = !list.every(i => solid.has(i));
  list.forEach(i => { if (make) catTiles()[i].solid = true; else delete catTiles()[i].solid; });
  refreshCatalog(make ? 'Solid on every map (once saved).' : 'Walkable on every map (once saved).');
}

function renameTile(i) {
  const t = catTiles()[i];
  const name = prompt('A new name for ' + t.name + ' (lowercase letters, digits and _):', t.name);
  if (!name || name === t.name) return;
  const n = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (catTiles().some(x => x.name === n)) { alert('There is already a tile called ' + n + '.'); return; }
  const old = t.name;
  t.name = n;
  Object.values(P.catalog.seasons || {}).forEach(rules => {
    Object.keys(rules).forEach(k => { if (rules[k] === old) rules[k] = n; });
    if (rules[old] !== undefined) { rules[n] = rules[old]; delete rules[old]; }
  });
  catTiles().forEach(x => { if (x.autotile && x.autotile.under === old) x.autotile.under = n; });
  refreshCatalog();
}

function removeTiles() {
  const list = chosenTiles();
  const locked = list.filter(i => catTiles()[i].locked).map(i => catTiles()[i].name);
  if (locked.length) { alert('The game\'s code uses ' + locked.join(', ') + ': give them a new picture instead.'); return; }
  const used = list.filter(tileUsed).map(i => catTiles()[i].name);
  if (used.length) { alert('These are on a map or in a stamp: ' + used.join(', ') + '.'); return; }
  const names = list.map(i => catTiles()[i].name);
  const inRules = names.filter(n => Object.values(P.catalog.seasons || {}).some(r => r[n] !== undefined || Object.values(r).indexOf(n) !== -1));
  if (inRules.length) { alert('A season\'s rules use ' + inRules.join(', ') + '. Remove those rules first.'); return; }
  if (!confirm('Remove ' + names.join(', ') + ' from the tile list? (This can\'t be undone, but nothing is lost until you save.)')) return;
  const gone = new Set(list);
  const newIndex = [];
  let k = 0;
  catTiles().forEach((t, i) => { newIndex[i] = gone.has(i) ? -1 : k++; });
  P.catalog.tiles = catTiles().filter((t, i) => !gone.has(i));
  renumberTiles(i => newIndex[i]);
  undoStack = []; redoStack = [];
  paletteChoice = { x0: 1, y0: 0, x1: 1, y1: 0 };
  refreshCatalog('Removed ' + names.length + ' tile' + (names.length > 1 ? 's' : '') + '.');
}

function recolorDialog() {
  const list = chosenTiles().filter(i => catTiles()[i].src);
  if (!list.length) { alert('Choose tiles with a picture from a sheet first.'); return; }
  const sets = Object.keys(P.catalog.recolors || {});
  const which = select([{ value: '+', text: 'A new recolouring…' }].concat(sets), sets[0] || '+', () => {});
  const pairs = el('textarea', { rows: 4, cols: 30, placeholder: '92d69a > 7c9e3d\n3da282 > 3a683d' });
  const name = el('input', { value: 'dry' });
  dialog('Recoloured copies of ' + list.length + ' tile' + (list.length > 1 ? 's' : ''), [
    row('Colours', which),
    el('p', { class: 'hint', text: 'For a new recolouring: its name, and one swap per line, "from > to", as 6-digit colours (rrggbb). Use the pack\'s own colours.' }),
    row('Name', name), pairs
  ], () => {
    let key = which.value;
    if (key === '+') {
      key = name.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'recolour';
      const swaps = pairs.value.split('\n').map(s => s.split('>').map(x => x.trim().replace('#', '').toLowerCase())).filter(p => p.length === 2 && /^[0-9a-f]{6}$/.test(p[0]) && /^[0-9a-f]{6}$/.test(p[1]));
      if (!swaps.length) { alert('Write at least one swap like 92d69a > 7c9e3d.'); return; }
      P.catalog.recolors[key] = swaps;
    }
    list.forEach(i => {
      const t = catTiles()[i];
      catTiles().push({ name: uniqueTileName(t.name + '_' + key), src: t.src, x: t.x, y: t.y, recolor: key, solid: t.solid || undefined });
    });
    refreshCatalog('Added ' + list.length + ' recoloured tile' + (list.length > 1 ? 's' : '') + ' at the end of the list.');
  });
}

// ------------------------------------------------------------ adding from the art
function showSources() {
  const box = $('sources');
  box.textContent = '';
  if (!haveArt()) { box.appendChild(el('p', { class: 'hint', text: 'Put the art packs in art-src/ (see art-src/README.md) to add tiles from them.' })); return; }
  box.appendChild(row('Sheet', select([{ value: '', text: '(choose a picture)' }].concat(P.sources), sourceName, v => { sourceName = v; sourceSel = null; loadSource(); })));
  const c = el('canvas', { id: 'source', class: 'checker' });
  box.appendChild(el('div', { class: 'scroll' }, [c]));
  box.appendChild(el('p', { id: 'source-info', class: 'hint', text: 'Drag over the squares you want, then:' }));
  const b = el('div', { class: 'buttons' });
  b.appendChild(el('button', { text: 'Add as new tiles…', onclick: addSourceTiles }));
  b.appendChild(el('button', { text: 'Use for the chosen tile', title: 'Give the tile chosen in the palette this picture (works for the tiles the game\'s code uses too)', onclick: useForChosen }));
  b.appendChild(el('button', { text: 'Animate the chosen tile…', title: 'The chosen tile shows these squares in turn', onclick: animateChosen }));
  b.appendChild(el('button', { text: 'Add as an autotile…', title: 'An RPG Maker-style autotile: the selection\'s top-left is its 2 x 3-tile block', onclick: addAutotile }));
  b.appendChild(el('button', { text: 'Add as an animated object…', title: 'Frames of any size (shore foam, fish, washing...)', onclick: addObject }));
  box.appendChild(b);
  let dragging = false;
  const cell = e => { const r = c.getBoundingClientRect(), k = c.width / r.width; return { x: Math.floor((e.clientX - r.left) * k / (T * SZ)), y: Math.floor((e.clientY - r.top) * k / (T * SZ)) }; };
  c.addEventListener('mousedown', e => { const p = cell(e); sourceSel = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; dragging = true; drawSource(); });
  c.addEventListener('mousemove', e => { if (!dragging) return; const p = cell(e); sourceSel.x1 = p.x; sourceSel.y1 = p.y; drawSource(); });
  window.addEventListener('mouseup', () => { dragging = false; });
  drawSource();
}
async function loadSource() {
  sourceImage = sourceName ? await Atlas.loadImage(sourceName) : null;
  drawSource();
}
function drawSource() {
  const c = $('source');
  if (!c) return;
  if (!sourceImage) { c.width = 1; c.height = 1; return; }
  c.width = sourceImage.width * SZ;
  c.height = sourceImage.height * SZ;
  const p = c.getContext('2d');
  p.imageSmoothingEnabled = false;
  p.drawImage(sourceImage, 0, 0, c.width, c.height);
  p.strokeStyle = 'rgba(255,255,255,0.12)';
  p.beginPath();
  for (let x = 0; x <= c.width; x += T * SZ) { p.moveTo(x + 0.5, 0); p.lineTo(x + 0.5, c.height); }
  for (let y = 0; y <= c.height; y += T * SZ) { p.moveTo(0, y + 0.5); p.lineTo(c.width, y + 0.5); }
  p.stroke();
  if (sourceSel) {
    const r = normRect(sourceSel);
    p.strokeStyle = '#fff';
    p.lineWidth = 2;
    p.strokeRect(r.x * T * SZ + 1, r.y * T * SZ + 1, r.w * T * SZ - 2, r.h * T * SZ - 2);
    const info = $('source-info');
    if (info) info.textContent = r.w + ' × ' + r.h + ' squares at column ' + r.x + ', row ' + r.y + '. Then:';
  }
}
function selectedCells() {
  if (!sourceName || !sourceSel) { alert('Choose a sheet and drag over some squares first.'); return null; }
  const r = normRect(sourceSel), out = [];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out.push({ src: sourceName, x: r.x + x, y: r.y + y, c: x, r: y });
  return { rect: r, cells: out };
}
function baseName() { return sourceName.split('/').pop().replace(/\.png$/i, '').replace(/^[!$]+/, '').replace(/^Petixel (Tileset|Autotile) - /, ''); }

function addSourceTiles() {
  const sel = selectedCells();
  if (!sel) return;
  const name = el('input', { value: baseName().toLowerCase() });
  const isSolid = el('input', { type: 'checkbox' });
  const stamp = el('input', { type: 'checkbox', checked: sel.cells.length > 1 });
  dialog('Add ' + sel.cells.length + ' tile' + (sel.cells.length > 1 ? 's' : ''), [row('Name', name),
    el('label', { class: 'row' }, [isSolid, 'Solid (blocks the player)']),
    el('label', { class: 'row' }, [stamp, 'Also make a stamp of them']),
    el('p', { class: 'hint', text: 'Several squares are named name_column_row. New tiles go at the end of the list.' })], () => {
    const base = name.value.trim() || 'tile';
    const first = catTiles().length;
    sel.cells.forEach(c => {
      const t = { name: uniqueTileName(sel.cells.length > 1 ? base + '_' + c.c + '_' + c.r : base), src: c.src, x: c.x, y: c.y };
      if (isSolid.checked) t.solid = true;
      catTiles().push(t);
    });
    if (stamp.checked && sel.cells.length > 1) {
      const n = sel.rect.w * sel.rect.h, layers = { ground: new Array(n).fill(-1), decor: [], above: new Array(n).fill(-1) };
      for (let i = 0; i < n; i++) layers.decor.push(first + i);
      P.stamps.push({ name: base, width: sel.rect.w, height: sel.rect.h, layers: layers });
    }
    const cols = P.tiles.columns;
    paletteChoice = { x0: first % cols, y0: Math.floor(first / cols), x1: first % cols, y1: Math.floor(first / cols) };
    refreshCatalog('Added ' + sel.cells.length + ' tile' + (sel.cells.length > 1 ? 's' : '') + ' at the end of the list.');
  });
}

function useForChosen() {
  const sel = selectedCells();
  const chosen = chosenTiles();
  if (!sel) return;
  if (chosen.length !== 1 || sel.cells.length !== 1) { alert('Choose one tile in the palette and one square of the sheet.'); return; }
  const t = catTiles()[chosen[0]];
  if (t.autotile) { alert(t.name + ' is an autotile: add a new autotile instead.'); return; }
  delete t.recolor; delete t.frames; delete t.ms;
  t.src = sel.cells[0].src; t.x = sel.cells[0].x; t.y = sel.cells[0].y;
  refreshCatalog(t.name + ' has a new picture.');
}

function animateChosen() {
  const sel = selectedCells();
  const chosen = chosenTiles();
  if (!sel) return;
  if (chosen.length !== 1 || catTiles()[chosen[0]].autotile) { alert('Choose one (plain) tile in the palette.'); return; }
  const t = catTiles()[chosen[0]];
  const ms = el('input', { type: 'number', min: 50, max: 5000, step: 50, value: t.ms || 250 });
  const keep = el('input', { type: 'checkbox', checked: !!t.src });
  dialog('Animate ' + t.name, [row('Each frame', el('span', {}, [ms, ' ms'])),
    el('label', { class: 'row' }, [keep, 'Its own picture is the first frame']),
    el('p', { class: 'hint', text: 'The chosen squares are the next frames, left to right, top to bottom. To stop animating, choose one square and untick the box.' })], () => {
    const frames = (keep.checked && t.src ? [{ src: t.src, x: t.x, y: t.y, recolor: t.recolor }] : []).concat(sel.cells.map(c => ({ src: c.src, x: c.x, y: c.y })));
    frames.forEach(f => { if (!f.recolor) delete f.recolor; });
    t.src = frames[0].src; t.x = frames[0].x; t.y = frames[0].y;
    if (frames.length > 1) { t.frames = frames; t.ms = Math.max(50, +ms.value || 250); } else { delete t.frames; delete t.ms; }
    refreshCatalog(t.name + (frames.length > 1 ? ' is animated (' + frames.length + ' frames).' : ' is not animated now.'));
  });
}

function addAutotile() {
  const sel = selectedCells();
  if (!sel) return;
  const name = el('input', { value: uniqueTileName(baseName().toLowerCase()) });
  const frames = el('input', { type: 'number', min: 1, max: 8, value: 1 });
  const step = el('input', { type: 'number', min: 1, max: 16, value: 2 });
  const ms = el('input', { type: 'number', min: 50, max: 5000, step: 50, value: 300 });
  const under = select([{ value: '', text: '(nothing)' }].concat(catTiles().filter(t => !t.autotile).map(t => t.name)), '', () => {});
  const isSolid = el('input', { type: 'checkbox', checked: true });
  dialog('Add an autotile', [
    el('p', { class: 'hint', text: 'Its 2 × 3-tile block starts at column ' + sel.rect.x + ', row ' + sel.rect.y + ' (RPG Maker layout: the top-right tile holds the inside corners, the 2 × 2 below the outside corners, edges and middle). Paint it as one tile; the edges choose themselves.' }),
    row('Name', name), row('Frames', frames), row('Next frame', el('span', {}, [step, ' tiles to the right'])), row('Each frame', el('span', {}, [ms, ' ms'])),
    row('Drawn over', under), el('label', { class: 'row' }, [isSolid, 'Solid (like water)'])], () => {
    const a = { src: sourceName, x: sel.rect.x, y: sel.rect.y, frames: Math.max(1, +frames.value || 1), step: Math.max(1, +step.value || 2), ms: Math.max(50, +ms.value || 300) };
    if (under.value) a.under = under.value;
    const t = { name: uniqueTileName(name.value.trim() || 'autotile'), autotile: a };
    if (isSolid.checked) t.solid = true;
    catTiles().push(t);
    refreshCatalog('Added the autotile ' + t.name + '. Paint it like any tile.');
  });
}

function addObject() {
  const sel = selectedCells();
  if (!sel) return;
  const name = el('input', { value: baseName().toLowerCase().replace(/[^a-z0-9_]/g, '_') });
  const w = el('input', { type: 'number', min: 8, max: 256, value: Math.min(48, sel.rect.w * T) });
  const h = el('input', { type: 'number', min: 8, max: 256, value: Math.min(48, sel.rect.h * T) });
  const ms = el('input', { type: 'number', min: 50, max: 5000, step: 50, value: 200 });
  const bounce = el('input', { type: 'checkbox' });
  dialog('Add an animated object', [
    el('p', { class: 'hint', text: 'The selection (' + sel.rect.w * T + ' × ' + sel.rect.h * T + ' pixels) is cut into frames of this size, left to right, top to bottom.' }),
    row('Name', name), row('Frame size', el('span', {}, [w, ' × ', h, ' pixels'])), row('Each frame', el('span', {}, [ms, ' ms'])),
    el('label', { class: 'row' }, [bounce, 'Play back and forth (1 2 3 2 1 2 3…)'])], () => {
    const fw = Math.max(8, +w.value || 16), fh = Math.max(8, +h.value || 16);
    const across = Math.max(1, Math.floor(sel.rect.w * T / fw)), down = Math.max(1, Math.floor(sel.rect.h * T / fh));
    let frames = [];
    for (let r = 0; r < down; r++) for (let c = 0; c < across; c++) frames.push([c, r]);
    if (bounce.checked && frames.length > 2) frames = frames.concat(frames.slice(1, -1).reverse());
    let n = name.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'object';
    const names = new Set((P.catalog.objects || []).map(o => o.name));
    if (names.has(n)) { let i = 2; while (names.has(n + '_' + i)) i++; n = n + '_' + i; }
    P.catalog.objects.push({ name: n, src: sourceName, x: sel.rect.x * T, y: sel.rect.y * T, w: fw, h: fh, frames: frames, ms: Math.max(50, +ms.value || 200) });
    refreshCatalog('Added the animated object ' + n + ' (' + frames.length + ' frames). Place it with the Objects tool (kind: anim).');
  });
}

// ------------------------------------------------------------ seasons
function showSeasons() {
  const box = $('seasons');
  box.textContent = '';
  P.catalog.seasons = P.catalog.seasons || {};
  box.appendChild(el('p', { class: 'hint', text: 'Each season can show some tiles as others, on every map (dry grass in the Harmattan...). Choose a tile in the palette, then press From or To.' }));
  box.appendChild(row('Season', select(P.seasons.map(s => ({ value: s, text: SEASON_NAMES[s] || s })), ruleSeason, v => { ruleSeason = v; showSeasons(); })));
  const rules = P.catalog.seasons[ruleSeason] = P.catalog.seasons[ruleSeason] || {};
  const ul = el('ul', { class: 'rules' });
  Object.keys(rules).sort().forEach(a => ul.appendChild(el('li', {}, [
    el('span', { text: a + ' → ' + rules[a] }),
    el('button', { text: '×', title: 'Remove this rule', onclick: () => { delete rules[a]; refreshCatalog(); } })])));
  if (!Object.keys(rules).length) ul.appendChild(el('li', { class: 'muted', text: 'No changes in this season.' }));
  box.appendChild(ul);
  const one = () => { const c = chosenTiles(); return c.length === 1 ? catTiles()[c[0]].name : null; };
  box.appendChild(el('div', { class: 'buttons' }, [
    el('button', { text: 'From: ' + (ruleFrom || '(choose)'), onclick: () => { ruleFrom = one(); showSeasons(); } }),
    el('button', { text: 'To: ' + (ruleTo || '(choose)'), onclick: () => { ruleTo = one(); showSeasons(); } }),
    el('button', { text: 'Add the rule', disabled: !ruleFrom || !ruleTo || ruleFrom === ruleTo, onclick: () => { rules[ruleFrom] = ruleTo; ruleFrom = ruleTo = null; refreshCatalog(); } })
  ]));
  box.appendChild(el('p', { class: 'hint', text: 'For a few squares on one map, paint a layer shown only in that season instead (New… by the layer buttons, shown when season:harmattan).' }));
}

// ------------------------------------------------------------ animated objects and shore foam
function showObjectList() {
  const box = $('objects-box');
  box.textContent = '';
  const objs = P.catalog.objects || [];
  const ul = el('ul', { class: 'rules' });
  objs.forEach((o, i) => ul.appendChild(el('li', {}, [
    el('span', { text: o.name + ' · ' + o.frames.length + ' frames of ' + o.w + ' × ' + o.h + ' · ' + o.ms + ' ms' }),
    el('button', { text: '×', title: 'Remove it', disabled: !haveArt(), onclick: () => {
      const used = Object.values(P.maps).some(m => objects(m).some(x => objType(x) === 'anim' && prop(x, 'sprite') === o.name)) ||
        Object.values(P.catalog.shore || {}).indexOf(o.name) !== -1;
      if (used) { alert(o.name + ' is used on a map or as shore foam.'); return; }
      objs.splice(i, 1);
      refreshCatalog();
    } })])));
  box.appendChild(ul);
  box.appendChild(el('p', { class: 'hint', text: 'Add more from a sheet above (Add as an animated object). Place them with the Objects tool, kind anim.' }));
  box.appendChild(el('h2', { text: 'Shore foam' }));
  box.appendChild(el('p', { class: 'hint', text: 'Foam along the water\'s edge (outdoor maps), moving with the tide. Which object, by where the land is:' }));
  P.catalog.shore = P.catalog.shore || {};
  [['north', 'Land to the north'], ['south', 'Land to the south'], ['east', 'Land to the east'], ['west', 'Land to the west']].forEach(([side, label]) => {
    box.appendChild(row(label, select([{ value: '', text: '(none)' }].concat(objs.map(o => o.name)), P.catalog.shore[side] || '', v => {
      if (v) P.catalog.shore[side] = v; else delete P.catalog.shore[side];
      refreshCatalog();
    })));
  });
}

function showTileList() {
  showTileButtons();
  if (!$('source')) showSources();
  showSeasons();
  showObjectList();
}
