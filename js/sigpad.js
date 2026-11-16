// Signature creator dialog: draw / type / upload. Resolves to a trimmed transparent PNG data URL.
import { h, dialog, store, storeSet, pickFiles, toast } from './ui.js';
import { fileToCanvas } from './pdf.js';

const FONTS = ['Great Vibes', 'Dancing Script', 'Caveat'];
const INKS = [['#111111', 'Black'], ['#1d3fbf', 'Blue'], ['#b3122e', 'Red']];

export function savedSigs(kind = 'sigs') { return store(kind, []); }
export function saveSig(url, kind = 'sigs') {
  const list = savedSigs(kind).filter(s => s !== url);
  list.unshift(url);
  storeSet(kind, list.slice(0, 6));
}
export function removeSig(url, kind = 'sigs') { storeSet(kind, savedSigs(kind).filter(s => s !== url)); }

/** Crop a canvas to its non-transparent pixels (with padding). Returns null if empty. */
export function trimCanvas(c, pad = 6) {
  const ctx = c.getContext('2d');
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Make light pixels transparent (for photos/scans of a signature on paper). */
export function knockOutWhite(c, threshold = 200, ink) {
  const ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const [ir, ig, ib] = ink ? [parseInt(ink.slice(1, 3), 16), parseInt(ink.slice(3, 5), 16), parseInt(ink.slice(5, 7), 16)] : [];
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum >= threshold) d[i + 3] = 0;
    else {
      // soft edge: fade pixels near the threshold
      const a = Math.min(1, (threshold - lum) / 60);
      d[i + 3] = Math.round(d[i + 3] * a);
      if (ink) { d[i] = ir; d[i + 1] = ig; d[i + 2] = ib; }
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export async function createSignature({ title = 'Create your signature', initials = false } = {}) {
  let tab = 'draw';
  let ink = store('sig.ink', '#111111');
  let font = store('sig.font', FONTS[0]);
  let uploaded = null;

  // --- draw tab
  const pad = h('canvas', { class: 'pad', 'aria-label': 'Signature drawing area' });
  let strokes = [], cur = null;
  const ctxOf = () => pad.getContext('2d');
  function sizePad() {
    const r = pad.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    pad.width = Math.round(r.width * dpr); pad.height = Math.round(r.height * dpr);
    redraw();
  }
  function redraw() {
    const ctx = ctxOf(); const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pad.width, pad.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // baseline guide
    ctx.strokeStyle = '#d6d8e0'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    const r = pad.getBoundingClientRect();
    ctx.beginPath(); ctx.moveTo(20, r.height * 0.72); ctx.lineTo(r.width - 20, r.height * 0.72); ctx.stroke(); ctx.setLineDash([]);
    for (const s of strokes) drawStroke(ctx, s);
  }
  function drawStroke(ctx, s) {
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const pts = s;
    if (pts.length === 1) { ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, 7); ctx.fill(); return; }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const m0 = i > 1 ? { x: (pts[i - 2].x + a.x) / 2, y: (pts[i - 2].y + a.y) / 2 } : a;
      const m1 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ctx.lineWidth = b.w;
      ctx.beginPath(); ctx.moveTo(m0.x, m0.y); ctx.quadraticCurveTo(a.x, a.y, m1.x, m1.y); ctx.stroke();
    }
  }
  const pos = e => { const r = pad.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  pad.addEventListener('pointerdown', e => {
    try { pad.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const p = pos(e); cur = [{ ...p, w: 3, t: performance.now() }]; strokes.push(cur); redraw();
  });
  pad.addEventListener('pointermove', e => {
    if (!cur) return;
    const p = pos(e), last = cur[cur.length - 1];
    const dist = Math.hypot(p.x - last.x, p.y - last.y);
    if (dist < 1.2) return;
    const now = performance.now();
    const v = dist / Math.max(1, now - last.t);
    const pressure = e.pressure && e.pointerType === 'pen' ? e.pressure : null;
    const w = pressure != null ? 1.6 + pressure * 3.6 : Math.max(1.9, Math.min(4.2, 4.2 - v * 0.9));
    cur.push({ ...p, w: last.w * 0.6 + w * 0.4, t: now });
    redraw();
  });
  const end = () => { cur = null; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);

  // --- type tab
  const nameInp = h('input', { type: 'text', placeholder: initials ? 'Your initials' : 'Type your name', value: store(initials ? 'sig.initials' : 'sig.name', ''), style: { width: '100%' }, 'aria-label': 'Name' });
  const typedOpts = h('div', { class: 'typed-opts' });
  function drawTyped() {
    typedOpts.innerHTML = '';
    for (const f of FONTS) {
      const b = h('button', { type: 'button', 'aria-pressed': String(f === font), style: { fontFamily: `"${f}"`, color: ink } }, nameInp.value || (initials ? 'AK' : 'Your Name'));
      b.addEventListener('click', () => { font = f; drawTyped(); });
      typedOpts.append(b);
    }
  }
  nameInp.addEventListener('input', drawTyped);

  // --- upload tab
  const upPrev = h('div', { class: 'checker', style: { minHeight: '120px', width: '100%', display: 'grid', placeItems: 'center' } }, h('span', { class: 'hint' }, 'No image yet'));
  const thr = h('input', { type: 'range', min: '120', max: '245', value: '200', 'aria-label': 'Background removal strength' });
  let upSource = null;
  async function chooseUpload() {
    const [f] = await pickFiles({ accept: 'image/*' });
    if (!f) return;
    try { upSource = await fileToCanvas(f); processUpload(); } catch (e) { toast(e.message, 'err'); }
  }
  function processUpload() {
    if (!upSource) return;
    const maxW = 1200, s = Math.min(1, maxW / upSource.width);
    const c = document.createElement('canvas');
    c.width = Math.round(upSource.width * s); c.height = Math.round(upSource.height * s);
    c.getContext('2d').drawImage(upSource, 0, 0, c.width, c.height);
    knockOutWhite(c, +thr.value);
    uploaded = trimCanvas(c, 4);
    upPrev.innerHTML = '';
    if (uploaded) { uploaded.style.maxWidth = '100%'; uploaded.style.maxHeight = '160px'; upPrev.append(uploaded); }
    else upPrev.append(h('span', { class: 'hint' }, 'Nothing left. Lower the strength.'));
  }
  thr.addEventListener('input', processUpload);

  // --- ink chooser
  const inkRow = h('div', { class: 'row', style: { gap: '8px', alignItems: 'center', marginTop: '10px' } }, h('span', { class: 'hint' }, 'Ink:'));
  INKS.forEach(([c, label]) => {
    const b = h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(c === ink), title: label, style: { gap: '6px' } }, h('i', { style: { width: '12px', height: '12px', borderRadius: '50%', background: c, display: 'inline-block' } }), label);
    b.addEventListener('click', () => { ink = c; inkRow.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); redraw(); drawTyped(); });
    inkRow.append(b);
  });
  const remember = h('label', { class: 'check', style: { marginTop: '10px' } }, h('input', { type: 'checkbox', checked: true }), 'Remember on this device');

  const panes = {
    draw: h('div', {}, pad, h('div', { class: 'row', style: { marginTop: '8px', justifyContent: 'space-between', alignItems: 'center' } },
      h('span', { class: 'hint' }, 'Sign with your mouse, pen or finger.'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => { strokes = []; redraw(); } }, 'Clear'))),
    type: h('div', {}, nameInp, typedOpts),
    upload: h('div', {}, h('div', { class: 'row', style: { marginBottom: '10px', alignItems: 'center' } },
      h('button', { type: 'button', class: 'btn', onclick: chooseUpload }, 'Choose a photo of your signature'),
      h('label', { class: 'field', style: { minWidth: '0' } }, h('span', {}, 'Remove background'), thr)), upPrev),
  };
  const tabBtns = h('div', { class: 'tabs', role: 'tablist' });
  for (const [k, label] of [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']]) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === tab) }, label);
    b.addEventListener('click', () => {
      tab = k; tabBtns.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false')); b.setAttribute('aria-selected', 'true');
      Object.entries(panes).forEach(([n, p]) => p.hidden = n !== k);
      if (k === 'draw') sizePad();
      if (k === 'type') { drawTyped(); nameInp.focus(); }
    });
    tabBtns.append(b);
  }
  Object.entries(panes).forEach(([n, p]) => p.hidden = n !== tab);
  const body = h('div', {}, tabBtns, panes.draw, panes.type, panes.upload, inkRow, remember);

  const result = await dialog({
    title, body, ok: 'Use signature',
    onOpen: () => { sizePad(); drawTyped(); document.fonts?.load(`40px "${FONTS[0]}"`).then(drawTyped); },
    validate: () => {
      let out = null;
      if (tab === 'draw') {
        if (!strokes.length) { toast('Draw your signature first.', 'err'); return false; }
        // re-render strokes at 2x on a clean transparent canvas
        const r = pad.getBoundingClientRect();
        const c = document.createElement('canvas'); c.width = r.width * 3; c.height = r.height * 3;
        const ctx = c.getContext('2d'); ctx.scale(3, 3);
        strokes.forEach(s => drawStroke(ctx, s));
        out = trimCanvas(c, 8);
      } else if (tab === 'type') {
        const text = nameInp.value.trim();
        if (!text) { toast('Type your name first.', 'err'); return false; }
        storeSet(initials ? 'sig.initials' : 'sig.name', text);
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        const px = 140;
        ctx.font = `${font === 'Caveat' ? 600 : font === 'Dancing Script' ? 600 : 400} ${px}px "${font}"`;
        const w = Math.ceil(ctx.measureText(text).width) + px;
        c.width = w; c.height = px * 1.8;
        ctx.font = `${font === 'Great Vibes' ? 400 : 600} ${px}px "${font}"`;
        ctx.fillStyle = ink; ctx.textBaseline = 'middle';
        ctx.fillText(text, px / 2, c.height / 2);
        out = trimCanvas(c, 10);
      } else {
        if (!uploaded) { toast('Choose a photo of your signature first.', 'err'); return false; }
        out = uploaded;
      }
      if (!out) { toast('That signature is empty.', 'err'); return false; }
      storeSet('sig.ink', ink); storeSet('sig.font', font);
      return out.toDataURL('image/png');
    },
  });
  if (result && remember.querySelector('input').checked) saveSig(result, initials ? 'inits' : 'sigs');
  return result;
}
