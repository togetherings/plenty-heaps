/*
 * The map maker's page. Run it with:  python tools/map_maker.py
 *
 * It loads every map from the map maker's server (/api/project), lets you change them here,
 * and saves them all back (/api/save), which writes maps-src/*.tmj and rebuilds
 * src/data/maps.js. Maps are kept in Tiled's format: tile layers hold "gids" (tile number + 1,
 * 0 for none); the optional "collision" layer holds the collision tileset's two gids (block
 * and open). Objects are in pixels.
 *
 * A developer's tool: plain modern JavaScript for a desktop browser, no libraries.
 */
'use strict';

const T = 16;
const LAYERS = ['ground', 'decor', 'above'];
const LAYER_NAMES = { ground: 'Ground', decor: 'Decoration', above: 'Over the player' };
const TOOLS = [
  { key: 'brush', label: 'Paint', k: 'b', help: 'Click or drag to paint the chosen tiles or stamp. Right-click: pick the tile under the mouse.' },
  { key: 'rect', label: 'Rectangle', k: 'r', help: 'Drag a rectangle to fill it with the chosen tiles.' },
  { key: 'fill', label: 'Fill', k: 'f', help: 'Click to fill the area of matching tiles with the chosen tile.' },
  { key: 'erase', label: 'Erase', k: 'e', help: 'Click or drag to clear tiles on this layer.' },
  { key: 'select', label: 'Select', k: 's', help: 'Drag to select. Ctrl+C copies (every layer), Ctrl+V pastes, Delete clears this layer (Shift+Delete: every layer).' },
  { key: 'collision', label: 'Collision', k: 'c', help: 'Left: block a square. Right (or Shift): open it, whatever tiles are there. Alt: back to what the tiles say.' },
  { key: 'objects', label: 'Objects', k: 'o', help: 'Click an object to edit it, drag to move, drag its corner to resize. Click an empty square to add one.' }
];
const OBJECT_COLORS = { spawn: '#4fc3f7', warp: '#ffb74d', room: '#ce93d8', farmland: '#a1887f', ship: '#81c784',
  bed: '#f48fb1', sign: '#fff176', npc: '#90caf9', critter: '#bcaaa4' };
const RESIZABLE = { warp: 1, room: 1, farmland: 1, ship: 1, bed: 1, sign: 1 };
const FACINGS = ['down', 'up', 'left', 'right'];
const CRITTERS = ['hen', 'chick', 'crab'];

// ------------------------------------------------------------ state
let P = null;                 // the project: {maps, tiles, solid, stamps, settings, collisionFirstgid, ...}
let cur = null;               // the key of the map on screen
let deleted = [];             // maps removed since the last save
let solid = new Set();        // tile numbers that block the player
let tool = 'brush';
let layerName = 'ground';
let brush = { w: 1, h: 1, layers: { current: [1] } };   // tiles to paint (-1: leave as it is)
let clipboard = null;
let selection = null;         // {x, y, w, h} in squares (Select tool)
let chosenObject = null;      // the object being edited
let newObjectType = 'spawn';
let picked = { x: 0, y: 0 };  // the last square clicked: "Play here" and "Add an interior" use it
let hover = null;
let view = { zoom: 2, ox: 20, oy: 20 };
let show = { grid: true, above: true, collision: true, objects: true };
let dirty = false;
let undoStack = [], redoStack = [];
let drag = null;
let spaceDown = false;
const tilesImage = new Image();
const collisionImage = new Image();

const $ = id => document.getElementById(id);
const canvas = $('view');
const ctx = canvas.getContext('2d');

// ------------------------------------------------------------ map helpers
function map() { return P.maps[cur]; }
function layer(m, name) { return m.layers.find(l => l.name === name) || null; }
function ensureLayer(m, name) {
  let l = layer(m, name);
  if (!l) {
    l = name === 'objects'
      ? { name: 'objects', type: 'objectgroup', draworder: 'topdown', objects: [] }
      : { name: name, type: 'tilelayer', data: new Array(m.width * m.height).fill(0) };
    m.layers.push(l);
  }
  return l;
}
function objects(m) { return ensureLayer(m, 'objects').objects; }
function prop(o, name, fallback) {
  const p = (o.properties || []).find(x => x.name === name);
  return p ? p.value : fallback;
}
function setProp(o, name, value, type) {
  o.properties = (o.properties || []).filter(x => x.name !== name);
  if (value !== undefined && value !== '') o.properties.push({ name: name, type: type || 'string', value: value });
}
function objType(o) { return o.type || o['class'] || ''; }
function mapId(m) { return prop(m, 'id', null); }
function isOutdoor(m) { return !!prop(m, 'outdoor', false); }
function rooms(m) { return objects(m).filter(o => objType(o) === 'room'); }
function tileName(idx) {
  if (!P._names) { P._names = []; Object.keys(P.tiles.names).forEach(n => { P._names[P.tiles.names[n]] = n; }); }
  return P._names[idx] || ('tile ' + idx);
}
function tileIdx(name) { return P.tiles.names[name]; }
function getGid(m, name, x, y) { const l = layer(m, name); return l ? l.data[y * m.width + x] : 0; }
function setGid(m, name, x, y, gid) {
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return;
  ensureLayer(m, name).data[y * m.width + x] = gid;
}
function inMap(m, x, y) { return x >= 0 && y >= 0 && x < m.width && y < m.height; }
function blockedAt(m, x, y) {
  const cg = getGid(m, 'collision', x, y), cf = P.collisionFirstgid;
  if (cg === cf) return true;
  if (cg === cf + 1) return false;
  return LAYERS.some(n => { const g = getGid(m, n, x, y); return g && solid.has(g - 1); });
}
function nextObjectId(m) { return objects(m).reduce((a, o) => Math.max(a, o.id || 0), 0) + 1; }
function newObject(m, type, name, x, y, w, h, props) {
  const o = { id: nextObjectId(m), name: name, type: type, x: x * T, y: y * T, width: (w || 1) * T, height: (h || 1) * T,
              rotation: 0, visible: true, properties: [] };
  Object.keys(props || {}).forEach(k => setProp(o, k, props[k]));
  objects(m).push(o);
  return o;
}
function uniqueName(m, type, base) {
  const names = new Set(objects(m).filter(o => objType(o) === type).map(o => o.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(base + '_' + i)) return base + '_' + i;
}
function freeId() {
  const used = new Set(Object.values(P.maps).map(mapId));
  for (let i = 0; i <= P.maxId; i++) if (!used.has(i)) return i;
  return null;
}
function blankMap(w, h, outdoor, fillName) {
  const fill = fillName !== undefined && tileIdx(fillName) !== undefined ? tileIdx(fillName) + 1 : 0;
  return {
    width: w, height: h, tilewidth: T, tileheight: T, infinite: false, type: 'map', orientation: 'orthogonal',
    renderorder: 'right-down',
    properties: [{ name: 'id', type: 'int', value: freeId() }, { name: 'outdoor', type: 'bool', value: !!outdoor }],
    layers: [
      { name: 'ground', type: 'tilelayer', data: new Array(w * h).fill(fill) },
      { name: 'decor', type: 'tilelayer', data: new Array(w * h).fill(0) },
      { name: 'above', type: 'tilelayer', data: new Array(w * h).fill(0) },
      { name: 'objects', type: 'objectgroup', draworder: 'topdown', objects: [] }
    ],
    tilesets: []
  };
}

/** Changes a map's size. ax, ay: 0 keeps the left/top side, 1 the middle, 2 the right/bottom. */
function resizeMap(m, nw, nh, ax, ay) {
  const dx = ax === 0 ? 0 : ax === 1 ? Math.floor((nw - m.width) / 2) : nw - m.width;
  const dy = ay === 0 ? 0 : ay === 1 ? Math.floor((nh - m.height) / 2) : nh - m.height;
  m.layers.forEach(l => {
    if (l.type !== 'tilelayer') return;
    const data = new Array(nw * nh).fill(0);
    for (let y = 0; y < m.height; y++) {
      for (let x = 0; x < m.width; x++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < nw && ny < nh) data[ny * nw + nx] = l.data[y * m.width + x];
      }
    }
    l.data = data;
  });
  objects(m).forEach(o => { o.x += dx * T; o.y += dy * T; });
  m.width = nw;
  m.height = nh;
}

// ------------------------------------------------------------ undo
/** Call before changing maps. keys: the maps that will change (default: the one on screen). */
function begin(keys) {
  keys = keys || [cur];
  undoStack.push(snapshot(keys));
  if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
  markDirty();
}
function snapshot(keys) {
  return { cur: cur, deleted: deleted.slice(), maps: keys.map(k => ({ key: k, json: P.maps[k] ? JSON.stringify(P.maps[k]) : null })) };
}
function restore(snap) {
  const back = snapshot(snap.maps.map(e => e.key));
  snap.maps.forEach(e => { if (e.json) P.maps[e.key] = JSON.parse(e.json); else delete P.maps[e.key]; });
  deleted = snap.deleted;
  cur = P.maps[snap.cur] ? snap.cur : Object.keys(P.maps)[0];
  chosenObject = null;
  return back;
}
function undo() { if (undoStack.length) { redoStack.push(restore(undoStack.pop())); markDirty(); refreshAll(); } }
function redo() { if (redoStack.length) { undoStack.push(restore(redoStack.pop())); markDirty(); refreshAll(); } }
function markDirty() { dirty = true; $('status').textContent = 'Not saved yet'; }

// ------------------------------------------------------------ drawing the map
let needsDraw = true;
function requestDraw() { needsDraw = true; }
function frame() { if (needsDraw && P) { needsDraw = false; draw(); } requestAnimationFrame(frame); }

function resizeCanvas() {
  const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  requestDraw();
}

function drawTile(c, idx, dx, dy, size, image, cols) {
  c.drawImage(image || tilesImage, (idx % (cols || P.tiles.columns)) * T, Math.floor(idx / (cols || P.tiles.columns)) * T, T, T, dx, dy, size, size);
}

function draw() {
  const m = map(), dpr = window.devicePixelRatio || 1, s = T * view.zoom;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const W = canvas.width / dpr, H = canvas.height / dpr;
  ctx.fillStyle = '#101014';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(view.ox, view.oy, m.width * s, m.height * s);
  const x0 = Math.max(0, Math.floor(-view.ox / s)), y0 = Math.max(0, Math.floor(-view.oy / s));
  const x1 = Math.min(m.width, Math.ceil((W - view.ox) / s)), y1 = Math.min(m.height, Math.ceil((H - view.oy) / s));
  LAYERS.forEach(name => {
    if (name === 'above' && !show.above) return;
    const l = layer(m, name);
    if (!l) return;
    ctx.globalAlpha = name === layerName || tool === 'objects' || tool === 'collision' ? 1 : 0.75;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const g = l.data[y * m.width + x];
        if (g > 0 && g <= P.tiles.count) drawTile(ctx, g - 1, view.ox + x * s, view.oy + y * s, s);
      }
    }
  });
  ctx.globalAlpha = 1;
  if (show.collision || tool === 'collision') drawCollision(m, x0, y0, x1, y1, s);
  if (show.grid && view.zoom >= 1) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x++) { ctx.moveTo(view.ox + x * s + 0.5, view.oy + y0 * s); ctx.lineTo(view.ox + x * s + 0.5, view.oy + y1 * s); }
    for (let y = y0; y <= y1; y++) { ctx.moveTo(view.ox + x0 * s, view.oy + y * s + 0.5); ctx.lineTo(view.ox + x1 * s, view.oy + y * s + 0.5); }
    ctx.stroke();
  }
  if (show.objects || tool === 'objects') drawObjects(m, s);
  // The map's edge, the picked square, the selection and the brush under the mouse
  ctx.strokeStyle = '#e8c170';
  ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, m.width * s + 1, m.height * s + 1);
  ctx.strokeStyle = '#fff';
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(view.ox + picked.x * s + 1.5, view.oy + picked.y * s + 1.5, s - 3, s - 3);
  ctx.setLineDash([]);
  if (selection) {
    ctx.strokeStyle = '#4fc3f7';
    ctx.lineWidth = 2;
    ctx.strokeRect(view.ox + selection.x * s, view.oy + selection.y * s, selection.w * s, selection.h * s);
    ctx.lineWidth = 1;
  }
  if (drag && drag.rect) {
    const r = normRect(drag.rect);
    ctx.fillStyle = 'rgba(232,193,112,0.25)';
    ctx.fillRect(view.ox + r.x * s, view.oy + r.y * s, r.w * s, r.h * s);
  }
  if (hover && (tool === 'brush') && !drag) drawBrushPreview(hover.x, hover.y, s);
  if (hover && tool !== 'brush') {
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.strokeRect(view.ox + hover.x * s + 0.5, view.oy + hover.y * s + 0.5, s - 1, s - 1);
  }
}

function drawCollision(m, x0, y0, x1, y1, s) {
  const cf = P.collisionFirstgid;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const cg = getGid(m, 'collision', x, y);
      if (cg === cf || cg === cf + 1) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(collisionImage, (cg - cf) * T, 0, T, T, view.ox + x * s, view.oy + y * s, s, s);
      } else if (blockedAt(m, x, y)) {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = '#ff3b30';
        ctx.fillRect(view.ox + x * s, view.oy + y * s, s, s);
      }
    }
  }
  ctx.globalAlpha = 1;
}

function drawObjects(m, s) {
  ctx.font = Math.max(9, Math.min(13, s * 0.55)) + 'px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  objects(m).forEach(o => {
    const t = objType(o), col = OBJECT_COLORS[t] || '#fff';
    const x = view.ox + o.x / T * s, y = view.oy + o.y / T * s, w = (o.width || T) / T * s, h = (o.height || T) / T * s;
    ctx.strokeStyle = col;
    ctx.lineWidth = o === chosenObject ? 3 : (t === 'room' ? 2 : 1.5);
    if (t === 'room') ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.setLineDash([]);
    if (t !== 'room' && t !== 'farmland') { ctx.globalAlpha = 0.25; ctx.fillStyle = col; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
    let label = t + (o.name ? ': ' + o.name : '');
    if (t === 'warp') label += ' → ' + prop(o, 'target', '?') + '/' + prop(o, 'spawn', '?');
    if (t === 'spawn') label += ' ' + ({ up: '↑', down: '↓', left: '←', right: '→' }[prop(o, 'facing', 'down')] || '');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    const tw = ctx.measureText(label).width + 6;
    ctx.fillRect(x, y - 15, tw, 15);
    ctx.fillStyle = col;
    ctx.fillText(label, x + 3, y - 13);
    ctx.lineWidth = 1;
    if (o === chosenObject && RESIZABLE[t]) { ctx.fillStyle = col; ctx.fillRect(x + w - 6, y + h - 6, 6, 6); }
  });
}

function drawBrushPreview(cx, cy, s) {
  ctx.globalAlpha = 0.6;
  for (let r = 0; r < brush.h; r++) {
    for (let c = 0; c < brush.w; c++) {
      Object.keys(brush.layers).forEach(name => {
        const idx = brush.layers[name][r * brush.w + c];
        if (idx >= 0) drawTile(ctx, idx, view.ox + (cx + c) * s, view.oy + (cy + r) * s, s);
      });
    }
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#e8c170';
  ctx.strokeRect(view.ox + cx * s + 0.5, view.oy + cy * s + 0.5, brush.w * s - 1, brush.h * s - 1);
}

// ------------------------------------------------------------ editing tiles
function paintBrush(m, cx, cy) {
  for (let r = 0; r < brush.h; r++) {
    for (let c = 0; c < brush.w; c++) {
      const x = cx + c, y = cy + r;
      if (!inMap(m, x, y)) continue;
      Object.keys(brush.layers).forEach(name => {
        const idx = brush.layers[name][r * brush.w + c];
        if (idx >= 0) setGid(m, name === 'current' ? layerName : name, x, y, idx + 1);
      });
      if (brush.collision) {
        const v = brush.collision[r * brush.w + c];
        if (v) setGid(m, 'collision', x, y, v);
      }
    }
  }
}
function fillRect(m, r) {
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const c = (x - r.x) % brush.w, rr = (y - r.y) % brush.h;
      Object.keys(brush.layers).forEach(name => {
        const idx = brush.layers[name][rr * brush.w + c];
        if (idx >= 0 && inMap(m, x, y)) setGid(m, name === 'current' ? layerName : name, x, y, idx + 1);
      });
    }
  }
}
function floodFill(m, sx, sy) {
  const l = ensureLayer(m, layerName), from = l.data[sy * m.width + sx];
  const idx = (brush.layers.current || brush.layers[layerName] || [])[0];
  if (idx === undefined || idx < 0 || idx + 1 === from) return;
  const room = rooms(m).find(o => sx * T >= o.x && sx * T < o.x + o.width && sy * T >= o.y && sy * T < o.y + o.height);
  const stack = [[sx, sy]], seen = new Set();
  while (stack.length) {
    const [x, y] = stack.pop(), k = y * m.width + x;
    if (!inMap(m, x, y) || seen.has(k) || l.data[k] !== from) continue;
    if (room && !(x * T >= room.x && x * T < room.x + room.width && y * T >= room.y && y * T < room.y + room.height)) continue;
    seen.add(k);
    l.data[k] = idx + 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}
function normRect(r) {
  return { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1), w: Math.abs(r.x1 - r.x0) + 1, h: Math.abs(r.y1 - r.y0) + 1 };
}
function copySelection() {
  if (!selection) return;
  const m = map(), b = { w: selection.w, h: selection.h, layers: {}, collision: null };
  LAYERS.forEach(name => {
    b.layers[name] = [];
    for (let y = 0; y < selection.h; y++) {
      for (let x = 0; x < selection.w; x++) b.layers[name].push(getGid(m, name, selection.x + x, selection.y + y) - 1);
    }
  });
  if (layer(m, 'collision')) {
    b.collision = [];
    for (let y = 0; y < selection.h; y++) for (let x = 0; x < selection.w; x++) b.collision.push(getGid(m, 'collision', selection.x + x, selection.y + y));
  }
  clipboard = b;
  status('Copied ' + b.w + ' × ' + b.h + '. Ctrl+V to paste.');
}
function clearSelection(allLayers) {
  if (!selection) return;
  const m = map();
  begin();
  (allLayers ? LAYERS.concat(['collision']) : [layerName]).forEach(name => {
    if (!layer(m, name)) return;
    for (let y = selection.y; y < selection.y + selection.h; y++) for (let x = selection.x; x < selection.x + selection.w; x++) setGid(m, name, x, y, 0);
  });
  requestDraw();
}

// ------------------------------------------------------------ mouse
function cellAt(e) {
  const r = canvas.getBoundingClientRect(), s = T * view.zoom;
  return { x: Math.floor((e.clientX - r.left - view.ox) / s), y: Math.floor((e.clientY - r.top - view.oy) / s),
           px: (e.clientX - r.left - view.ox) / view.zoom, py: (e.clientY - r.top - view.oy) / view.zoom };
}
function objectAt(m, px, py) {
  const list = objects(m).slice().reverse();
  // Small things first, so a spawn inside a room is easy to pick
  list.sort((a, b) => (a.width * a.height) - (b.width * b.height));
  return list.find(o => px >= o.x && px < o.x + (o.width || T) && py >= o.y && py < o.y + (o.height || T)) || null;
}

canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('mousedown', e => {
  if (!P) return;
  const m = map(), c = cellAt(e);
  if (e.button === 1 || spaceDown) { drag = { pan: true, sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy }; return; }
  if (inMap(m, c.x, c.y)) { picked = { x: c.x, y: c.y }; }
  if (tool === 'brush' && e.button === 2) { pickTile(m, c.x, c.y, e.shiftKey); return; }
  if (!inMap(m, c.x, c.y) && tool !== 'objects') { requestDraw(); return; }
  if (tool === 'brush') { begin(); paintBrush(m, c.x, c.y); drag = { paint: true, last: c }; }
  else if (tool === 'erase') { begin(); setGid(m, layerName, c.x, c.y, 0); drag = { erase: true }; }
  else if (tool === 'rect') { drag = { rect: { x0: c.x, y0: c.y, x1: c.x, y1: c.y } }; }
  else if (tool === 'fill') { begin(); floodFill(m, c.x, c.y); }
  else if (tool === 'select') { drag = { rect: { x0: c.x, y0: c.y, x1: c.x, y1: c.y }, select: true }; }
  else if (tool === 'collision') {
    begin();
    const v = collisionValue(e);
    setGid(m, 'collision', c.x, c.y, v);
    drag = { collision: v };
  } else if (tool === 'objects') {
    const o = objectAt(m, c.px, c.py);
    if (o) {
      chosenObject = o;
      const s = T * view.zoom, ox = view.ox + o.x / T * s, oy = view.oy + o.y / T * s;
      const r = canvas.getBoundingClientRect();
      const nearCorner = RESIZABLE[objType(o)] && e.clientX - r.left > ox + o.width / T * s - 10 && e.clientY - r.top > oy + o.height / T * s - 10;
      drag = { object: o, resize: nearCorner, start: c, x: o.x, y: o.y, w: o.width, h: o.height, began: false };
    } else if (inMap(m, c.x, c.y)) {
      begin();
      const type = newObjectType;
      const props = type === 'warp' ? { target: Object.keys(P.maps).find(k => k !== cur) || cur, spawn: '' }
        : type === 'spawn' ? { facing: 'down' } : type === 'critter' ? { kind: 'hen' } : type === 'sign' ? { text: '' } : {};
      chosenObject = newObject(m, type, uniqueName(m, type, type), c.x, c.y, 1, 1, props);
    } else {
      chosenObject = null;
    }
    showInspector();
  }
  requestDraw();
});
window.addEventListener('mousemove', e => {
  if (!P) return;
  const m = map(), c = cellAt(e);
  const over = e.target === canvas;
  hover = over && inMap(m, c.x, c.y) ? { x: c.x, y: c.y } : null;
  if (over) showWhere(m, c);
  if (!drag) { if (over) requestDraw(); return; }
  if (drag.pan) { view.ox = drag.ox + e.clientX - drag.sx; view.oy = drag.oy + e.clientY - drag.sy; }
  else if (drag.paint && (c.x !== drag.last.x || c.y !== drag.last.y)) { paintBrush(m, c.x, c.y); drag.last = c; }
  else if (drag.erase) setGid(m, layerName, c.x, c.y, 0);
  else if (drag.collision !== undefined) setGid(m, 'collision', c.x, c.y, drag.collision);
  else if (drag.rect) { drag.rect.x1 = Math.max(0, Math.min(m.width - 1, c.x)); drag.rect.y1 = Math.max(0, Math.min(m.height - 1, c.y)); }
  else if (drag.object) {
    const o = drag.object, dx = (c.x - drag.start.x) * T, dy = (c.y - drag.start.y) * T;
    if (!drag.began && (dx || dy)) { begin(); drag.began = true; }
    if (!drag.began) return;
    if (drag.resize) { o.width = Math.max(T, drag.w + dx); o.height = Math.max(T, drag.h + dy); }
    else { o.x = drag.x + dx; o.y = drag.y + dy; }
    showInspector();
  }
  requestDraw();
});
window.addEventListener('mouseup', () => {
  if (!drag || !P) { drag = null; return; }
  const m = map();
  if (drag.rect && drag.select) { selection = normRect(drag.rect); showInspector(); }
  else if (drag.rect) { begin(); fillRect(m, normRect(drag.rect)); }
  drag = null;
  requestDraw();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey || !e.shiftKey && Math.abs(e.deltaY) > 0 && !e.altKey) {
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const old = view.zoom;
    const zooms = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6];
    let i = zooms.indexOf(old);
    if (i < 0) i = 4;
    i = Math.max(0, Math.min(zooms.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
    view.zoom = zooms[i];
    view.ox = mx - (mx - view.ox) * view.zoom / old;
    view.oy = my - (my - view.oy) * view.zoom / old;
  } else {
    view.ox -= e.deltaX || e.deltaY;
  }
  requestDraw();
}, { passive: false });

function collisionValue(e) {
  if (e.altKey) return 0;
  return e.button === 2 || e.shiftKey ? P.collisionFirstgid + 1 : P.collisionFirstgid;
}
function pickTile(m, x, y, anyLayer) {
  if (!inMap(m, x, y)) return;
  const names = anyLayer ? LAYERS.slice().reverse() : [layerName];
  for (const name of names) {
    const g = getGid(m, name, x, y);
    if (g) { brush = { w: 1, h: 1, layers: { current: [g - 1] } }; if (anyLayer) setLayer(name); paletteChoice = { x0: (g - 1) % P.tiles.columns, y0: Math.floor((g - 1) / P.tiles.columns), x1: (g - 1) % P.tiles.columns, y1: Math.floor((g - 1) / P.tiles.columns) }; drawPalette(); return; }
  }
}
function showWhere(m, c) {
  if (!inMap(m, c.x, c.y)) { $('where').textContent = ''; return; }
  const parts = LAYERS.map(n => { const g = getGid(m, n, c.x, c.y); return g ? LAYER_NAMES[n] + ': ' + tileName(g - 1) : null; }).filter(Boolean);
  $('where').textContent = cur + ' ' + c.x + ', ' + c.y + (blockedAt(m, c.x, c.y) ? ' · blocked' : '') + (parts.length ? ' · ' + parts.join(' · ') : '');
}

// ------------------------------------------------------------ keys
window.addEventListener('keydown', e => {
  if (!P) return;
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || $('dialog').open;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (typing) return;
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (ctrl && e.key.toLowerCase() === 'c') { copySelection(); return; }
  if (ctrl && e.key.toLowerCase() === 'v') { if (clipboard) { brush = clipboard; setTool('brush'); } return; }
  if (e.key === ' ') { spaceDown = true; canvas.style.cursor = 'grab'; e.preventDefault(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (tool === 'objects' && chosenObject) { deleteObject(); } else if (selection) clearSelection(e.shiftKey);
    return;
  }
  if (e.key === 'Escape') { selection = null; chosenObject = null; showInspector(); requestDraw(); return; }
  if (e.key === '1' || e.key === '2' || e.key === '3') { setLayer(LAYERS[+e.key - 1]); return; }
  if (e.key === 'g') { show.grid = !show.grid; showToggles(); requestDraw(); return; }
  if (e.key === '+' || e.key === '=') { zoomBy(1); return; }
  if (e.key === '-') { zoomBy(-1); return; }
  const t = TOOLS.find(x => x.k === e.key.toLowerCase());
  if (t && !ctrl) setTool(t.key);
});
window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; canvas.style.cursor = ''; } });
function zoomBy(d) {
  const zooms = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6];
  view.zoom = zooms[Math.max(0, Math.min(zooms.length - 1, zooms.indexOf(view.zoom) + d))] || 2;
  requestDraw();
}

// ------------------------------------------------------------ the palette
let paletteChoice = { x0: 1, y0: 0, x1: 1, y1: 0 };
const PZ = 2;
function drawPalette() {
  const c = $('palette'), cols = P.tiles.columns, rows = Math.ceil(P.tiles.count / cols);
  c.width = cols * T * PZ;
  c.height = rows * T * PZ;
  const p = c.getContext('2d');
  p.imageSmoothingEnabled = false;
  p.drawImage(tilesImage, 0, 0, P.tiles.width * PZ, P.tiles.height * PZ);
  p.fillStyle = '#ff3b30';
  solid.forEach(i => { p.beginPath(); const x = (i % cols) * T * PZ, y = Math.floor(i / cols) * T * PZ; p.moveTo(x, y); p.lineTo(x + 9, y); p.lineTo(x, y + 9); p.fill(); });
  const r = normRect(paletteChoice);
  p.strokeStyle = '#fff';
  p.lineWidth = 2;
  p.strokeRect(r.x * T * PZ + 1, r.y * T * PZ + 1, r.w * T * PZ - 2, r.h * T * PZ - 2);
  const idx = r.y * cols + r.x;
  $('tile-name').textContent = r.w * r.h === 1 ? tileName(idx) + (solid.has(idx) ? ' (solid)' : '') : r.w + ' × ' + r.h + ' tiles';
}
function paletteCell(e) {
  const c = $('palette'), r = c.getBoundingClientRect(), k = c.width / r.width;
  return { x: Math.floor((e.clientX - r.left) * k / (T * PZ)), y: Math.floor((e.clientY - r.top) * k / (T * PZ)) };
}
let paletteDrag = false;
$('palette').addEventListener('mousedown', e => { const c = paletteCell(e); paletteChoice = { x0: c.x, y0: c.y, x1: c.x, y1: c.y }; paletteDrag = true; choosePalette(); });
$('palette').addEventListener('mousemove', e => { if (!paletteDrag) return; const c = paletteCell(e); paletteChoice.x1 = c.x; paletteChoice.y1 = c.y; choosePalette(); });
window.addEventListener('mouseup', () => { paletteDrag = false; });
function choosePalette() {
  const r = normRect(paletteChoice), cols = P.tiles.columns, tiles = [];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) { const i = (r.y + y) * cols + r.x + x; tiles.push(i < P.tiles.count ? i : -1); }
  brush = { w: r.w, h: r.h, layers: { current: tiles } };
  if (tool !== 'brush' && tool !== 'rect' && tool !== 'fill') setTool('brush');
  drawPalette();
  requestDraw();
}
$('toggle-solid').addEventListener('click', () => {
  const r = normRect(paletteChoice), cols = P.tiles.columns, list = [];
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) list.push((r.y + y) * cols + r.x + x);
  const make = !list.every(i => solid.has(i));
  list.forEach(i => { if (make) solid.add(i); else solid.delete(i); });
  const base = new Set(P.tiles.collides);
  P.settings = { solid: [...solid].filter(i => !base.has(i)).sort((a, b) => a - b),
                 walkable: [...base].filter(i => !solid.has(i)).sort((a, b) => a - b) };
  markDirty();
  status(make ? 'Solid on every map (once saved).' : 'Walkable on every map (once saved).');
  drawPalette();
  requestDraw();
});

// ------------------------------------------------------------ stamps
function drawStamps() {
  const box = $('stamps');
  box.textContent = '';
  P.stamps.forEach((st, i) => {
    const b = document.createElement('button'), c = document.createElement('canvas'), z = Math.min(2, 48 / (Math.max(st.width, st.height) * T));
    c.width = st.width * T * z;
    c.height = st.height * T * z;
    const p = c.getContext('2d');
    p.imageSmoothingEnabled = false;
    LAYERS.forEach(name => (st.layers[name] || []).forEach((idx, k) => {
      if (idx >= 0) drawTile(p, idx, (k % st.width) * T * z, Math.floor(k / st.width) * T * z, T * z);
    }));
    b.appendChild(c);
    b.appendChild(document.createTextNode(st.name));
    b.title = st.name + ' (' + st.width + ' × ' + st.height + '). Right-click to remove it.';
    b.addEventListener('click', () => {
      brush = { w: st.width, h: st.height, layers: JSON.parse(JSON.stringify(st.layers)), collision: st.collision || null };
      setTool('brush');
    });
    b.addEventListener('contextmenu', e => {
      e.preventDefault();
      if (confirm('Remove the stamp "' + st.name + '"? (Maps keep what was painted with it.)')) { P.stamps.splice(i, 1); markDirty(); drawStamps(); }
    });
    box.appendChild(b);
  });
}
function saveSelectionAsStamp() {
  if (!selection) return;
  const name = prompt('A name for this stamp:', 'stamp');
  if (!name) return;
  copySelection();
  const st = { name: name, width: clipboard.w, height: clipboard.h, layers: clipboard.layers };
  if (clipboard.collision && clipboard.collision.some(v => v)) st.collision = clipboard.collision;
  P.stamps.push(st);
  markDirty();
  drawStamps();
}

// ------------------------------------------------------------ the panels
function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  Object.keys(attrs || {}).forEach(k => {
    if (k === 'text') e.textContent = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'checked' || k === 'disabled' || k === 'value') e[k] = attrs[k];
    else e.setAttribute(k, attrs[k]);
  });
  (kids || []).forEach(k => e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
  return e;
}
function row(label, input) { return el('label', { class: 'row' }, [el('span', { text: label }), input]); }
function select(options, value, onchange) {
  const s = el('select', { onchange: () => onchange(s.value) });
  options.forEach(o => { const v = typeof o === 'string' ? o : o.value; s.appendChild(el('option', { value: v, text: typeof o === 'string' ? o : o.text })); });
  s.value = value;
  return s;
}

function showTools() {
  const box = $('tools');
  box.textContent = '';
  TOOLS.forEach(t => box.appendChild(el('button', { class: t.key === tool ? 'on' : '', title: t.help + ' (' + t.k.toUpperCase() + ')', text: t.label, onclick: () => setTool(t.key) })));
  const lay = $('layers');
  lay.textContent = '';
  LAYERS.forEach((n, i) => lay.appendChild(el('button', { class: n === layerName ? 'on' : '', title: 'Paint on this layer (' + (i + 1) + ')', text: LAYER_NAMES[n], onclick: () => setLayer(n) })));
  showToggles();
  $('help').textContent = TOOLS.find(t => t.key === tool).help + ' Space+drag or middle button: move around. Wheel: zoom.';
}
function showToggles() {
  let box = $('toggles');
  if (!box) { box = el('span', { id: 'toggles', class: 'toggles' }); $('layers').after(box); }
  box.textContent = '';
  [['grid', 'Grid'], ['above', 'Over-the-player layer'], ['collision', 'Collision'], ['objects', 'Objects']].forEach(([k, label]) => {
    const c = el('input', { type: 'checkbox', checked: show[k], onchange: () => { show[k] = c.checked; requestDraw(); } });
    box.appendChild(el('label', {}, [c, label]));
  });
}
function setTool(t) { tool = t; if (t !== 'select') selection = null; if (t !== 'objects') chosenObject = null; showTools(); showInspector(); requestDraw(); }
function setLayer(n) { layerName = n; showTools(); requestDraw(); }

function showMaps() {
  const ul = $('maps');
  ul.textContent = '';
  Object.keys(P.maps).sort((a, b) => (mapId(P.maps[a]) || 0) - (mapId(P.maps[b]) || 0)).forEach(k => {
    const m = P.maps[k], kind = rooms(m).length ? 'rooms' : isOutdoor(m) ? 'outside' : 'inside';
    ul.appendChild(el('li', { class: k === cur ? 'on' : '', onclick: () => openMap(k) },
      [el('span', { text: k }), el('small', { text: '#' + mapId(m) + ' · ' + m.width + '×' + m.height + ' · ' + kind })]));
  });
}
function openMap(k) {
  cur = k;
  chosenObject = null;
  selection = null;
  picked = { x: 0, y: 0 };
  const sp = objects(map()).find(o => objType(o) === 'spawn');
  if (sp) picked = { x: Math.floor(sp.x / T), y: Math.floor(sp.y / T) };
  centreOn(picked.x, picked.y);
  refreshAll();
}
function centreOn(x, y) {
  const r = canvas.getBoundingClientRect(), s = T * view.zoom;
  view.ox = Math.round(r.width / 2 - (x + 0.5) * s);
  view.oy = Math.round(r.height / 2 - (y + 0.5) * s);
}

function showMapSettings() {
  const box = $('map-settings'), m = map();
  box.textContent = '';
  const id = el('input', { type: 'number', min: 0, max: P.maxId, value: mapId(m) });
  id.addEventListener('change', () => { begin(); setProp(m, 'id', parseInt(id.value, 10), 'int'); showMaps(); });
  const outdoor = el('input', { type: 'checkbox', checked: isOutdoor(m) });
  outdoor.addEventListener('change', () => { begin(); setProp(m, 'outdoor', outdoor.checked, 'bool'); showMaps(); });
  box.appendChild(row('Name', el('strong', { text: cur })));
  box.appendChild(row('Id', id));
  box.appendChild(el('p', { class: 'hint', text: 'Saves use the id: never change it once learners play, and never reuse one.' }));
  box.appendChild(el('label', { class: 'row' }, [outdoor, 'Outdoors (rain, night)']));
  // Size
  const w = el('input', { type: 'number', min: 1, max: P.maxSize, value: m.width });
  const h = el('input', { type: 'number', min: 1, max: P.maxSize, value: m.height });
  let ax = 0, ay = 0;
  const anchor = el('span', { class: 'anchor', title: 'Which side stays put' });
  function drawAnchor() {
    anchor.textContent = '';
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      anchor.appendChild(el('button', { type: 'button', class: x === ax && y === ay ? 'on' : '', text: x === ax && y === ay ? '●' : '', onclick: () => { ax = x; ay = y; drawAnchor(); } }));
    }
  }
  drawAnchor();
  box.appendChild(row('Size', el('span', {}, [w, ' × ', h])));
  box.appendChild(row('Keep', anchor));
  box.appendChild(el('p', {}, [el('button', { text: 'Change the size', onclick: () => {
    const nw = Math.max(1, Math.min(P.maxSize, parseInt(w.value, 10) || m.width));
    const nh = Math.max(1, Math.min(P.maxSize, parseInt(h.value, 10) || m.height));
    if (nw === m.width && nh === m.height) return;
    if ((nw < m.width || nh < m.height) && !confirm('Squares outside the new size will be lost. Change the size?')) return;
    begin();
    resizeMap(m, nw, nh, ax, ay);
    refreshAll();
  } })]));
  box.appendChild(el('p', {}, [
    el('button', { text: 'Add an interior…', title: 'A room for the building whose door is the chosen square', onclick: addInteriorDialog }),
    ' ',
    el('button', { text: 'Rename…', disabled: cur === 'farm' || cur === 'house', title: cur === 'farm' || cur === 'house' ? "The game's code uses this name" : '', onclick: renameMap }),
    ' ',
    el('button', { class: 'danger', text: 'Delete…', disabled: cur === 'farm' || cur === 'house', onclick: deleteMap })
  ]));
}

function showInspector() {
  const box = $('inspector');
  box.textContent = '';
  const m = map();
  if (tool === 'objects' && chosenObject && objects(m).includes(chosenObject)) return objectInspector(box, m, chosenObject);
  if (tool === 'objects') {
    box.appendChild(el('h2', { text: 'Objects' }));
    box.appendChild(row('Add', select(P.objectTypes.slice(), newObjectType, v => { newObjectType = v; })));
    box.appendChild(el('p', { class: 'hint', text: 'Click an empty square to add this kind of object there. spawn: where the player arrives. warp: walking into it goes to another map. room: one room of an interiors map.' }));
    return;
  }
  if (tool === 'select' && selection) {
    box.appendChild(el('h2', { text: 'Selection ' + selection.w + ' × ' + selection.h }));
    box.appendChild(el('p', {}, [
      el('button', { text: 'Copy', onclick: copySelection }), ' ',
      el('button', { text: 'Save as a stamp…', onclick: saveSelectionAsStamp }), ' ',
      el('button', { text: 'Clear this layer', onclick: () => clearSelection(false) })
    ]));
    return;
  }
  if (tool === 'collision') {
    box.appendChild(el('h2', { text: 'Collision' }));
    box.appendChild(el('p', { class: 'hint', text: 'Red squares block the player. Squares you block or open by hand show a cross or a circle; Alt+click puts a square back to what its tiles say. To make a kind of tile solid everywhere, choose it below and press Solid / walkable.' }));
  }
}

function objectInspector(box, m, o) {
  const t = objType(o);
  box.appendChild(el('h2', { text: 'Object' }));
  const name = el('input', { value: o.name || '' });
  name.addEventListener('change', () => { begin(); o.name = name.value.trim(); requestDraw(); });
  box.appendChild(row('Name', name));
  box.appendChild(row('Kind', select(P.objectTypes.slice(), t, v => { begin(); o.type = v; showInspector(); requestDraw(); })));
  ['x', 'y', 'width', 'height'].forEach(k => {
    if ((k === 'width' || k === 'height') && !RESIZABLE[t]) return;
    const i = el('input', { type: 'number', value: Math.round(o[k] / T), min: k === 'width' || k === 'height' ? 1 : 0 });
    i.addEventListener('change', () => { begin(); o[k] = Math.max(k === 'width' || k === 'height' ? 1 : 0, parseInt(i.value, 10) || 0) * T; requestDraw(); });
    box.appendChild(row({ x: 'Across', y: 'Down', width: 'Width', height: 'Height' }[k], i));
  });
  if (t === 'warp') {
    const target = prop(o, 'target', '');
    box.appendChild(row('Goes to', select(Object.keys(P.maps).sort(), target, v => { begin(); setProp(o, 'target', v); setProp(o, 'spawn', ''); showInspector(); requestDraw(); })));
    const spawns = P.maps[target] ? objects(P.maps[target]).filter(s => objType(s) === 'spawn').map(s => s.name) : [];
    box.appendChild(row('Arrive at', select([{ value: '', text: '(choose)' }].concat(spawns), prop(o, 'spawn', ''), v => { begin(); setProp(o, 'spawn', v); requestDraw(); })));
    box.appendChild(el('p', {}, [el('button', { text: 'Add the way back', title: 'A spawn here, and a warp back to it next to where this warp arrives', onclick: () => addWayBack(o) }),
      ' ', el('button', { text: 'Go there', onclick: () => { const tm = P.maps[target]; if (!tm) return; const sp = objects(tm).find(s => objType(s) === 'spawn' && s.name === prop(o, 'spawn')); openMap(target); if (sp) { picked = { x: sp.x / T, y: sp.y / T }; centreOn(picked.x, picked.y); requestDraw(); } } })]));
  }
  if (t === 'spawn' || t === 'npc') box.appendChild(row('Facing', select(FACINGS, prop(o, 'facing', 'down'), v => { begin(); setProp(o, 'facing', v); requestDraw(); })));
  if (t === 'critter') box.appendChild(row('Animal', select(CRITTERS, prop(o, 'kind', 'hen'), v => { begin(); setProp(o, 'kind', v); })));
  if (t === 'sign') {
    const text = el('input', { value: prop(o, 'text', '') });
    text.addEventListener('change', () => { begin(); setProp(o, 'text', text.value.trim()); });
    box.appendChild(row('Words', text));
    box.appendChild(el('p', { class: 'hint', text: 'The key of the sign\'s words in src/data/strings.js, like sign_field.' }));
  }
  if (t === 'npc') {
    const npc = el('input', { value: prop(o, 'npc', '') });
    npc.addEventListener('change', () => { begin(); setProp(o, 'npc', npc.value.trim()); });
    box.appendChild(row('Villager', npc));
  }
  box.appendChild(el('p', {}, [el('button', { class: 'danger', text: 'Delete', onclick: deleteObject })]));
}
function deleteObject() {
  const m = map();
  if (!chosenObject) return;
  begin();
  ensureLayer(m, 'objects').objects = objects(m).filter(o => o !== chosenObject);
  chosenObject = null;
  showInspector();
  requestDraw();
}

/** A spawn next to this warp, and a warp next to where it arrives that leads back to it. */
function addWayBack(w) {
  const tKey = prop(w, 'target'), tm = P.maps[tKey], m = map();
  const sp = tm && objects(tm).find(s => objType(s) === 'spawn' && s.name === prop(w, 'spawn'));
  if (!sp) { alert('Choose where the warp arrives first.'); return; }
  begin([cur, tKey]);
  const wx = Math.floor(w.x / T), wy = Math.floor(w.y / T), ww = Math.round(w.width / T), wh = Math.round(w.height / T);
  // Here: a spawn on the first free square next to the warp (below it first)
  const around = [];
  for (let x = wx; x < wx + ww; x++) around.push([x, wy + wh, 'down'], [x, wy - 1, 'up']);
  for (let y = wy; y < wy + wh; y++) around.push([wx - 1, y, 'left'], [wx + ww, y, 'right']);
  const free = around.find(([x, y]) => inMap(m, x, y) && !blockedAt(m, x, y) && !objectAt(m, x * T + 8, y * T + 8)) || around[0];
  const backName = uniqueName(m, 'spawn', 'from_' + tKey);
  newObject(m, 'spawn', backName, free[0], free[1], 1, 1, { facing: free[2] });
  // There: a warp one square behind where the player arrives
  const behind = { down: [0, -1], up: [0, 1], left: [1, 0], right: [-1, 0] }[prop(sp, 'facing', 'down')];
  const bx = Math.floor(sp.x / T) + behind[0], by = Math.floor(sp.y / T) + behind[1];
  const back = newObject(tm, 'warp', uniqueName(tm, 'warp', 'to_' + cur), bx, by, 1, 1, { target: cur, spawn: backName });
  openMap(tKey);
  tool = 'objects';
  chosenObject = back;
  picked = { x: bx, y: by };
  showTools();
  showInspector();
  status('Added the way back. Move the warp if it isn\'t where you want it.');
}

// ------------------------------------------------------------ maps: new, rename, delete, interiors
function dialog(title, fields, ok) {
  const d = $('dialog'), f = $('dialog-form');
  f.textContent = '';
  f.appendChild(el('h2', { text: title }));
  fields.forEach(x => f.appendChild(x));
  const okb = el('button', { class: 'primary', value: 'ok', text: 'OK' }), cancel = el('button', { value: 'cancel', text: 'Cancel' });
  f.appendChild(el('p', {}, [okb, ' ', cancel]));
  d.onclose = () => { if (d.returnValue === 'ok') ok(); };
  d.returnValue = '';
  d.showModal();
}
function validKey(k) { return /^[a-z][a-z0-9_]{0,31}$/.test(k); }

function newMapDialog() {
  const key = el('input', { value: '', placeholder: 'like beach' });
  const kind = select([{ value: 'outside', text: 'Outside' }, { value: 'rooms', text: 'Interiors (rooms of buildings)' }], 'outside', () => {});
  const w = el('input', { type: 'number', value: 40, min: 1, max: P.maxSize }), h = el('input', { type: 'number', value: 30, min: 1, max: P.maxSize });
  dialog('New map', [row('Name', key), row('Kind', kind), row('Size', el('span', {}, [w, ' × ', h])),
    el('p', { class: 'hint', text: 'Lowercase letters, digits and _. For a building\'s rooms, use Add an interior on the outside map instead.' })], () => {
    const k = key.value.trim();
    if (!validKey(k) || P.maps[k]) { alert(P.maps[k] ? 'There is already a map called ' + k + '.' : 'Use lowercase letters, digits and _, starting with a letter.'); return; }
    if (freeId() === null) { alert('There are already ' + (P.maxId + 1) + ' maps, the most the save can tell apart.'); return; }
    begin([k]);
    P.maps[k] = blankMap(Math.min(P.maxSize, +w.value || 40), Math.min(P.maxSize, +h.value || 30), kind.value === 'outside', kind.value === 'outside' ? 'grass' : 'void');
    deleted = deleted.filter(x => x !== k);
    openMap(k);
  });
}

function renameMap() {
  const key = el('input', { value: cur });
  dialog('Rename ' + cur, [row('New name', key), el('p', { class: 'hint', text: 'Warps that lead here are changed too.' })], () => {
    const k = key.value.trim();
    if (k === cur) return;
    if (!validKey(k) || P.maps[k]) { alert(P.maps[k] ? 'There is already a map called ' + k + '.' : 'Use lowercase letters, digits and _, starting with a letter.'); return; }
    begin(Object.keys(P.maps).concat([k]));
    P.maps[k] = P.maps[cur];
    delete P.maps[cur];
    deleted.push(cur);
    Object.values(P.maps).forEach(m => objects(m).forEach(o => { if (objType(o) === 'warp' && prop(o, 'target') === cur) setProp(o, 'target', k); }));
    cur = k;
    refreshAll();
  });
}

function deleteMap() {
  const leading = Object.keys(P.maps).filter(k => k !== cur && objects(P.maps[k]).some(o => objType(o) === 'warp' && prop(o, 'target') === cur));
  if (!confirm('Delete the map ' + cur + '?' + (leading.length ? ' Warps on ' + leading.join(', ') + ' lead here and will need changing.' : '') + ' (Undo can bring it back until you close the map maker.)')) return;
  begin([cur]);
  delete P.maps[cur];
  deleted.push(cur);
  openMap(Object.keys(P.maps)[0]);
}

function addInteriorDialog() {
  const m = map(), door = { x: picked.x, y: picked.y };
  if (rooms(m).length) { alert('This is an interiors map. Go to the outside map, click the building\'s door square, then Add an interior.'); return; }
  const existing = Object.keys(P.maps).filter(k => k !== cur && rooms(P.maps[k]).length);
  const linked = existing.find(k => objects(m).some(o => objType(o) === 'warp' && prop(o, 'target') === k));
  const newKey = cur + '_inside';
  const target = select(existing.map(k => ({ value: k, text: k })).concat(P.maps[newKey] ? [] : [{ value: '+' + newKey, text: 'A new map: ' + newKey }]),
    linked || (existing.length && !P.maps[newKey] ? '+' + newKey : existing[0] || '+' + newKey), () => {});
  const name = el('input', { value: 'house' });
  const w = el('input', { type: 'number', value: 10, min: 5, max: 60 }), h = el('input', { type: 'number', value: 8, min: 5, max: 60 });
  dialog('Add an interior', [
    el('p', { text: 'The door is the chosen square on ' + cur + ': ' + door.x + ', ' + door.y + '. (Click the door square first.)' }),
    row('Put it in', target), row('Room name', name), row('Size', el('span', {}, [w, ' × ', h])),
    el('p', { class: 'hint', text: 'Size includes the walls. The room gets a floor, walls and a doorway, linked both ways to the door. Paint it after.' })
  ], () => {
    const room = name.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_') || 'room';
    let key = target.value;
    const isNew = key.charAt(0) === '+';
    if (isNew) key = key.slice(1);
    if (isNew && freeId() === null) { alert('There are already ' + (P.maxId + 1) + ' maps.'); return; }
    begin([cur, key]);
    if (isNew) P.maps[key] = blankMap(1, 1, false, 'void');
    addInterior(cur, door, key, room, Math.max(5, +w.value || 10), Math.max(5, +h.value || 8));
  });
}

/** Builds a room in the interiors map `key`, linked both ways to the door square on `outsideKey`. */
function addInterior(outsideKey, door, key, room, rw, rh) {
  const im = P.maps[key], out = P.maps[outsideKey];
  const existing = rooms(im);
  const rx = existing.length ? Math.max(...existing.map(o => (o.x + o.width) / T)) + 2 : 1, ry = 1;
  resizeMap(im, Math.max(im.width, rx + rw + 1), Math.max(im.height, ry + rh + 1), 0, 0);
  const g = n => tileIdx(n) + 1;
  const ground = ensureLayer(im, 'ground').data;
  for (let i = 0; i < ground.length; i++) if (!ground[i]) ground[i] = g('void');   // the space between rooms
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const wall = y < ry + 2, edge = x === rx || x === rx + rw - 1 || y === ry + rh - 1;
      setGid(im, 'ground', x, y, wall ? g('wall_in') : edge ? g('void') : g('floor'));
      setGid(im, 'decor', x, y, 0);
      setGid(im, 'above', x, y, 0);
    }
  }
  const dx = rx + Math.floor(rw / 2), dy = ry + rh - 1;
  setGid(im, 'ground', dx, dy, g('floor'));
  const roomName = uniqueName(im, 'room', room);
  newObject(im, 'room', roomName, rx, ry, rw, rh);
  const inName = uniqueName(im, 'spawn', roomName + '_in'), outName = uniqueName(out, 'spawn', roomName + '_out');
  newObject(im, 'spawn', inName, dx, dy - 1, 1, 1, { facing: 'up' });
  newObject(im, 'warp', uniqueName(im, 'warp', roomName + '_exit'), dx, dy, 1, 1, { target: outsideKey, spawn: outName });
  newObject(out, 'warp', uniqueName(out, 'warp', roomName + '_door'), door.x, door.y, 1, 1, { target: key, spawn: inName });
  newObject(out, 'spawn', outName, door.x, Math.min(out.height - 1, door.y + 1), 1, 1, { facing: 'down' });
  openMap(key);
  picked = { x: dx, y: dy - 1 };
  centreOn(rx + rw / 2, ry + rh / 2);
  status('Added the room ' + roomName + ' to ' + key + ', linked to the door on ' + outsideKey + '.');
  refreshAll();
}

// ------------------------------------------------------------ saving, problems, playing
function status(text) { $('status').textContent = text; }
function showProblems(list) {
  const box = $('problems');
  box.textContent = '';
  if (!list.length) { box.appendChild(el('p', { class: 'ok', text: 'No problems found.' })); return; }
  const ul = el('ul', { class: 'problems' });
  list.forEach(p => ul.appendChild(el('li', { class: p.text.startsWith('Note:') ? 'note' : 'bad', text: p.map + ': ' + p.text, onclick: () => {
    if (P.maps[p.map]) { openMap(p.map); if (p.x !== null) { picked = { x: p.x, y: p.y }; centreOn(p.x, p.y); requestDraw(); } }
  } })));
  box.appendChild(ul);
}
async function save() {
  status('Saving…');
  try {
    const r = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maps: P.maps, deleted: deleted, settings: P.settings, stamps: P.stamps }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    deleted = [];
    dirty = false;
    showProblems(data.problems);
    const bad = data.problems.filter(p => !p.text.startsWith('Note:')).length;
    status(bad ? 'Saved, with ' + bad + ' problem' + (bad > 1 ? 's' : '') + ' to fix (left).' : 'Saved.');
    return true;
  } catch (e) {
    status('Not saved: ' + e.message);
    alert('The map maker couldn\'t save: ' + e.message + '\nIs python tools/map_maker.py still running?');
    return false;
  }
}
async function play() {
  if (dirty && !(await save())) return;
  window.open('/index.html?at=' + encodeURIComponent(cur + ',' + picked.x + ',' + picked.y), 'plenty-heaps-play');
}

function refreshAll() {
  if (!P.maps[cur]) cur = Object.keys(P.maps)[0];
  showMaps();
  showMapSettings();
  showTools();
  showInspector();
  drawPalette();
  drawStamps();
  requestDraw();
}

$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
$('save').addEventListener('click', save);
$('play').addEventListener('click', play);
$('new-map').addEventListener('click', newMapDialog);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

async function start() {
  const r = await fetch('/api/project');
  P = await r.json();
  solid = new Set(P.solid);
  P.settings = P.settings || { solid: [], walkable: [] };
  await Promise.all([
    new Promise((ok, fail) => { tilesImage.onload = ok; tilesImage.onerror = fail; tilesImage.src = '/assets/tiles.png'; }),
    new Promise(ok => { collisionImage.onload = ok; collisionImage.onerror = ok; collisionImage.src = 'collision.png'; })
  ]);
  resizeCanvas();
  cur = P.maps.farm ? 'farm' : Object.keys(P.maps)[0];
  openMap(cur);
  showProblems(P.problems);
  status('');
  window.mapMaker = { get project() { return P; }, get current() { return cur; }, addInterior: addInterior, save: save, openMap: openMap };
  requestAnimationFrame(frame);
}
start().catch(e => { document.body.textContent = 'The map maker couldn\'t start: ' + e.message; });
