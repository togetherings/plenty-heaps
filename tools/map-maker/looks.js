/*
 * The Looks page of the map maker: every skin tone, hairstyle, hair colour and outfit, drawn with the
 * game's own recolouring code (src/core/charRecolor.js). Try a look, give it to a villager
 * (src/data/npcs.js), change an outfit's colours or add an outfit (src/data/appearance.js).
 * Saving rewrites those two lists in the files (/api/looks); everything else in them is kept.
 */
'use strict';

const A = FarmSim.Appearance;
const W = 48, H = 128, Z = 3;
// The Petixel palette (the packs' 24 colours). Outfits look best in these.
const PAL = ['f8f4de', 'ff5654', 'ffe484', '7c9e3d', '92d69a', '235d6a', 'd0b8a4', 'b2364e', 'ff9d51', '3a683d', '3da282', 'ffc1ae',
  '897a6f', 'e6a27e', 'be82bc', 'b2d0ff', '48a5ce', 'ff84b4', '593b3d', 'a15d4d', '835691', '8b82d3', '206fa9', '7a4157'];
const images = {};
let look = A.defaultLook();
let outfits = A.outfits.list.map(o => JSON.parse(JSON.stringify(o)));
const npcLooks = {};
FarmSim.Npcs.list.forEach(n => { npcLooks[n.key] = Object.assign({}, n.look); });
let editing = outfits[0].key, slot = { part: 'top', i: 1 };
let dirty = false;

const $ = id => document.getElementById(id);
function el(tag, attrs, kids) {
  const e = document.createElement(tag);
  Object.keys(attrs || {}).forEach(k => {
    if (k === 'text') e.textContent = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'checked' || k === 'value' || k === 'disabled') e[k] = attrs[k];
    else e.setAttribute(k, attrs[k]);
  });
  (kids || []).forEach(k => e.appendChild(typeof k === 'string' ? document.createTextNode(k) : k));
  return e;
}
function row(label, input) { return el('label', { class: 'row' }, [el('span', { text: label }), input]); }
function select(list, value, onchange) {
  const s = el('select', { onchange: () => onchange(s.value) });
  list.forEach(v => s.appendChild(el('option', { value: v, text: v })));
  s.value = value;
  return s;
}
function hex(c) { return c.map(v => v.toString(16).padStart(2, '0')).join(''); }
function rgb(h) { return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
function outfit(key) { return outfits.find(o => o.key === key); }
function changed(text) { dirty = true; $('status').textContent = text || 'Not saved yet'; }

/** A character's sheet (3 frames x 4 directions) for a look, as a canvas: as CharacterArt.js builds it. */
function sheet(lk) {
  const c = el('canvas', { width: W, height: H }), ctx = c.getContext('2d');
  const body = A.bodies.get(lk.body);
  ctx.drawImage(images[body.texture], 0, 0);
  const img = ctx.getImageData(0, 0, W, H);
  const skin = A.skins.get(lk.skin);
  FarmSim.CharRecolor.body(img.data, W, skin.colors, outfit(lk.outfit) || outfits[0], skin.outline);
  ctx.putImageData(img, 0, 0);
  const hair = A.hairs.get(lk.hair);
  if (hair.col >= 0) {
    const h = el('canvas', { width: W, height: H }), hc = h.getContext('2d');
    hc.drawImage(images.hair, hair.col * W, 0, W, H, 0, 0, W, H);
    const hi = hc.getImageData(0, 0, W, H);
    FarmSim.CharRecolor.hair(hi.data, A.hairColors.get(lk.hairColor).colors);
    hc.putImageData(hi, 0, 0);
    ctx.drawImage(h, 0, 0);
  }
  return c;
}
/** One standing frame (facing down) at scale z. */
function portrait(lk, z) {
  const c = el('canvas', { width: 16 * z, height: 32 * z }), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet(lk), 16, 0, 16, 32, 0, 0, 16 * z, 32 * z);
  return c;
}

function drawLook() {
  const s = sheet(look), c = $('sheet'), ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(s, 0, 0, W * Z, H * Z);
  walkSheet = s;
}
let walkSheet = null;
function walk(t) {
  if (walkSheet) {
    const c = $('walk'), ctx = c.getContext('2d'), step = [0, 1, 2, 1][Math.floor(t / 160) % 4], dir = Math.floor(t / 2560) % 4;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(walkSheet, step * 16, dir * 32, 16, 32, 0, 0, 64, 128);
  }
  requestAnimationFrame(walk);
}

function showLook() {
  const box = $('look');
  box.textContent = '';
  box.appendChild(row('Body', select(A.bodies.list.map(b => b.key), look.body, v => { look.body = v; refresh(); })));
  const sk = el('div', { class: 'swatches' });
  A.skins.list.forEach(s => sk.appendChild(el('button', { class: 'swatch' + (s.key === look.skin ? ' on' : ''), title: s.key,
    style: 'background:#' + hex(s.colors[1]), onclick: () => { look.skin = s.key; refresh(); } })));
  box.appendChild(row('Skin', sk));
  box.appendChild(row('Hair', select(A.hairs.list.map(h => h.key), look.hair, v => { look.hair = v; refresh(); })));
  const hc = el('div', { class: 'swatches' });
  A.hairColors.list.forEach(h => hc.appendChild(el('button', { class: 'swatch' + (h.key === look.hairColor ? ' on' : ''), title: h.key,
    style: 'background:#' + hex(h.swatch), onclick: () => { look.hairColor = h.key; refresh(); } })));
  box.appendChild(row('Hair colour', hc));
  box.appendChild(row('Outfit', select(outfits.map(o => o.key), look.outfit, v => { look.outfit = v; editing = v; refresh(); })));
  box.appendChild(el('p', { class: 'hint', text: JSON.stringify(look) }));
}

function showNpcs() {
  const box = $('npcs');
  box.textContent = '';
  FarmSim.Npcs.list.forEach(n => {
    box.appendChild(el('div', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0' }, [
      portrait(npcLooks[n.key], 2), el('strong', { text: n.key }),
      el('button', { text: 'Show', title: 'Try this villager\'s look above', onclick: () => { look = Object.assign({}, npcLooks[n.key]); editing = look.outfit; refresh(); } }),
      el('button', { text: 'Give this look', title: 'Give the look above to ' + n.key, onclick: () => { npcLooks[n.key] = Object.assign({}, look); changed(n.key + ' has a new look (not saved yet).'); refresh(); } })
    ]));
  });
}

function showGrids() {
  const skins = $('skins');
  skins.textContent = '';
  A.skins.list.forEach(s => skins.appendChild(el('figure', { onclick: () => { look.skin = s.key; refresh(); } },
    [portrait(Object.assign({}, look, { skin: s.key }), 2), el('figcaption', { text: s.key })])));
  const hairs = $('hairs');
  hairs.textContent = '';
  A.hairs.list.forEach(h => {
    const fig = el('figure', {}, []);
    const strip = el('div', { style: 'display:flex;gap:2px' });
    A.hairColors.list.forEach(c => strip.appendChild(el('span', { title: h.key + ', ' + c.key, onclick: () => { look.hair = h.key; look.hairColor = c.key; refresh(); } },
      [portrait(Object.assign({}, look, { hair: h.key, hairColor: c.key }), 1)])));
    fig.appendChild(strip);
    fig.appendChild(el('figcaption', { text: h.key }));
    hairs.appendChild(fig);
  });
  const outs = $('outfits');
  outs.textContent = '';
  outfits.forEach(o => outs.appendChild(el('figure', { onclick: () => { look.outfit = o.key; editing = o.key; refresh(); } },
    [portrait(Object.assign({}, look, { outfit: o.key }), 2), el('figcaption', { text: o.key })])));
}

function showOutfitEditor() {
  const box = $('outfit-edit');
  box.textContent = '';
  const o = outfit(editing);
  box.appendChild(row('Outfit', select(outfits.map(x => x.key), editing, v => { editing = v; look.outfit = v; refresh(); })));
  box.appendChild(el('p', {}, [el('button', { text: 'New outfit…', onclick: newOutfit })]));
  if (!o) return;
  const one = el('input', { type: 'checkbox', checked: !!o.onePiece, onchange: () => { o.onePiece = one.checked; if (o.onePiece) delete o.bottom; else o.bottom = o.bottom || o.top.map(c => c.slice()); changed(); refresh(); } });
  const pat = el('input', { type: 'checkbox', checked: !!o.pattern, onchange: () => { o.pattern = pat.checked; changed(); refresh(); } });
  const price = el('input', { type: 'number', min: 0, value: o.price || 0, onchange: () => { o.price = Math.max(0, +price.value || 0); changed(); } });
  box.appendChild(el('label', { class: 'row' }, [one, 'One piece (a kaftan, a kaba: the top\'s colours cover the body)']));
  box.appendChild(el('label', { class: 'row' }, [pat, 'Gara (tie-dye) dots on the bottom']));
  box.appendChild(row('Price', price));
  const grid = el('div', { class: 'colors' });
  ['top', 'bottom'].forEach(part => {
    if (part === 'bottom' && o.onePiece) return;
    grid.appendChild(el('span', { class: 'hint', text: part === 'top' ? 'Top' : 'Bottom' }));
    o[part].forEach((c, i) => grid.appendChild(el('button', { class: 'slot' + (slot.part === part && slot.i === i ? ' on' : ''),
      title: ['shadow', 'base', 'highlight'][i] + ' #' + hex(c), style: 'background:#' + hex(c), onclick: () => { slot = { part: part, i: i }; showOutfitEditor(); } })));
  });
  box.appendChild(grid);
  box.appendChild(el('p', { class: 'hint', text: 'Choose a box (shadow, base, highlight), then a colour. The pack\'s colours:' }));
  const pal = el('div', { class: 'palette' });
  const setColor = h => { const part = o[slot.part]; if (!part) return; part[slot.i] = rgb(h); changed(); refresh(); };
  PAL.forEach(h => pal.appendChild(el('button', { title: '#' + h, style: 'background:#' + h, onclick: () => setColor(h) })));
  box.appendChild(pal);
  const own = el('input', { value: (o[slot.part] && hex(o[slot.part][slot.i])) || '', size: 7 });
  box.appendChild(row('Or', el('span', {}, [own, ' ', el('button', { text: 'Use', onclick: () => { if (/^[0-9a-f]{6}$/i.test(own.value)) setColor(own.value.toLowerCase()); } })])));
  box.appendChild(el('p', { class: 'hint', text: 'Never change an outfit\'s id or name once learners play: saves keep which outfits a player owns.' }));
}

function newOutfit() {
  const name = prompt('A name for the new outfit (lowercase letters, digits and _):', 'outfit');
  if (!name) return;
  const key = name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (outfit(key)) { alert('There is already an outfit called ' + key + '.'); return; }
  const base = outfit(editing) || outfits[0];
  const id = outfits.reduce((m, o) => Math.max(m, o.id), -1) + 1;
  const o = { id: id, key: key, price: 0, top: base.top.map(c => c.slice()) };
  if (base.onePiece) o.onePiece = true; else o.bottom = base.bottom.map(c => c.slice());
  outfits.push(o);
  editing = key;
  look.outfit = key;
  changed('Added the outfit ' + key + ' (not saved yet).');
  refresh();
}

function refresh() { showLook(); drawLook(); showNpcs(); showGrids(); showOutfitEditor(); }

$('save').addEventListener('click', async () => {
  $('status').textContent = 'Saving…';
  try {
    const r = await fetch('/api/looks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outfits: outfits, npcLooks: npcLooks }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    dirty = false;
    $('status').textContent = 'Saved (src/data/appearance.js and src/data/npcs.js).';
  } catch (e) {
    $('status').textContent = 'Not saved: ' + e.message;
  }
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

function load(key, src) { return new Promise(ok => { const im = new Image(); im.onload = () => { images[key] = im; ok(); }; im.onerror = ok; im.src = src; }); }
Promise.all([load('body_m', '/assets/chars/body_m.png'), load('body_f', '/assets/chars/body_f.png'), load('hair', '/assets/chars/hair.png')]).then(() => {
  refresh();
  requestAnimationFrame(walk);
  window.looks = { get outfits() { return outfits; }, get npcLooks() { return npcLooks; }, get look() { return look; } };
});
