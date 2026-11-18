// Small DOM + UI helpers shared by every tool.
import { icon } from './icons.js';
import { countSave, tipLine } from './support.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
  return (n / 1024 / 1024).toFixed(n < 10485760 ? 2 : 1) + ' MB';
}

export function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

export function toast(msg, type = '') {
  const t = h('div', { class: 'toast ' + type }, msg);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3200);
}

const busyEl = () => document.getElementById('busy');
export function busy(text = 'Working…') {
  busyEl().hidden = false;
  document.getElementById('busyText').textContent = text;
  document.getElementById('busyBar').style.width = '0%';
  return {
    update(frac, t) {
      document.getElementById('busyBar').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
      if (t) document.getElementById('busyText').textContent = t;
    },
    done() { busyEl().hidden = true; },
  };
}
// Let the browser paint between heavy steps.
export const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------- dialog ---------- */
export function dialog({ title, body, ok = 'OK', cancel = 'Cancel', onOpen, validate }) {
  const dlg = document.getElementById('dlg');
  return new Promise(resolve => {
    dlg.innerHTML = '';
    const okBtn = h('button', { class: 'btn primary', type: 'submit' }, ok);
    const form = h('form', { method: 'dialog' },
      h('div', { class: 'dlg-head' }, title),
      h('div', { class: 'dlg-body' }, body),
      h('div', { class: 'dlg-foot' },
        cancel ? h('button', { class: 'btn', type: 'button', onclick: () => { dlg.close(); resolve(null); } }, cancel) : null,
        ok ? okBtn : null));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = validate ? validate() : true;
      if (v === false || v == null) return;
      dlg.close();
      resolve(v);
    });
    dlg.append(form);
    dlg.onclose = () => resolve(null);
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
    onOpen && onOpen(dlg);
  });
}

export async function askPassword(fileName, wrong) {
  const inp = h('input', { type: 'password', autocomplete: 'off', style: { width: '100%' }, 'aria-label': 'Password' });
  const body = h('div', {},
    h('p', { class: 'hint', style: { marginTop: 0 } }, `"${fileName}" is password-protected. Enter its password to open it.`),
    wrong ? h('p', { style: { color: 'var(--err)', margin: '0 0 8px' } }, 'That password didn’t work. Try again.') : null,
    inp);
  return dialog({ title: 'Password needed', body, ok: 'Open', onOpen: () => inp.focus(), validate: () => inp.value });
}

/* ---------- files in / out ---------- */
export function readBytes(file) {
  return file.arrayBuffer().then(b => new Uint8Array(b));
}

export function pickFiles({ accept, multiple }) {
  return new Promise(resolve => {
    const inp = h('input', { type: 'file', accept, multiple: !!multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve([]); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

export function matchesAccept(file, accept) {
  if (!accept) return true;
  const name = file.name.toLowerCase();
  return accept.split(',').map(s => s.trim().toLowerCase()).some(a =>
    a.startsWith('.') ? name.endsWith(a) :
    a.endsWith('/*') ? (file.type || '').startsWith(a.slice(0, -1)) :
    file.type === a);
}

export function dropzone({ accept, multiple = false, title, hint, onFiles, compact = false }) {
  const el = h('div', { class: 'drop' + (compact ? ' compact' : ''), tabindex: '0', role: 'button' },
    h('span', { html: icon('upload') }).firstChild,
    h('b', {}, title || (multiple ? 'Choose files' : 'Choose a file')),
    compact ? null : h('span', {}, hint || 'or drag and drop here'));
  const take = files => {
    const ok = files.filter(f => matchesAccept(f, accept));
    if (files.length && !ok.length) return toast('That file type isn’t supported here.', 'err');
    if (ok.length) onFiles(multiple ? ok : [ok[0]]);
  };
  const open = async () => take(await pickFiles({ accept, multiple }));
  el.addEventListener('click', open);
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
    document.getElementById('dropveil').hidden = true;
    take([...e.dataTransfer.files]);
  });
  return el;
}

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', zip: 'application/zip' };

// Save with the native "Save as" dialog where available (Edge/Chrome on Windows), else download.
export async function saveFile(data, name) {
  const ext = name.split('.').pop().toLowerCase();
  const blob = data instanceof Blob ? data : new Blob([data], { type: MIME[ext] || 'application/octet-stream' });
  if (window.showSaveFilePicker && window.top === window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: [{ description: ext.toUpperCase() + ' file', accept: { [blob.type || MIME[ext]]: ['.' + ext] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      return { saved: true, name: handle.name, size: blob.size };
    } catch (e) {
      if (e && e.name === 'AbortError') return { saved: false };
      // fall through to a normal download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { saved: true, name, size: blob.size };
}

export function resultBox(title, detail, again) {
  return h('div', { class: 'result' },
    h('span', { html: icon('check-circle') }).firstChild,
    h('div', { class: 'grow' }, h('b', {}, title), detail ? h('span', {}, detail) : null),
    again ? h('button', { class: 'btn sm', type: 'button', onclick: again }, 'Start over') : null);
}

export async function finishSave(container, data, name, again, extra = '') {
  const r = await saveFile(data, name);
  if (!r.saved) return false;
  container.querySelector('.result')?.remove();
  container.querySelector('.tip-line')?.remove();
  container.append(resultBox('Saved ' + r.name, fmtBytes(r.size) + (extra ? ' · ' + extra : ''), again));
  if (countSave()) container.append(tipLine());
  toast('Saved ' + r.name);
  return true;
}

/** entries: [{ name, data: Uint8Array|Blob }] → zip Blob. Names are de-duplicated. */
export async function makeZip(entries) {
  if (!window.JSZip) await import('../vendor/jszip.min.js');
  const zip = new window.JSZip();
  const used = new Set();
  for (const e of entries) {
    let n = e.name, k = 2;
    while (used.has(n.toLowerCase())) n = e.name.replace(/(\.[^.]+)?$/, m => ` (${k++})${m}`);
    used.add(n.toLowerCase());
    zip.file(n, e.data);
  }
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

/* ---------- small form helpers ---------- */
export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', {}, hint) : null);
}

export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'group' });
  const btns = options.map(([v, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(v === value) }, label);
    b.addEventListener('click', () => {
      btns.forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', 'true');
      el.value = v; onChange && onChange(v);
    });
    return b;
  });
  el.value = value;
  el.append(...btns);
  return el;
}

export function store(key, fallback) {
  try { const v = localStorage.getItem('inkfold.' + key); return v == null ? fallback : JSON.parse(v); }
  catch { return fallback; }
}
export function storeSet(key, v) { try { localStorage.setItem('inkfold.' + key, JSON.stringify(v)); } catch { /* private mode */ } }

// Drag-to-reorder for a list of elements inside `container`. Calls onMove(from, to).
export function sortable(container, selector, onMove, { horizontal = false } = {}) {
  let from = -1;
  container.addEventListener('dragstart', e => {
    const it = e.target.closest(selector); if (!it) return;
    from = [...container.querySelectorAll(selector)].indexOf(it);
    it.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(from)); } catch { /* */ }
  });
  container.addEventListener('dragend', e => {
    e.target.closest(selector)?.classList.remove('dragging');
    container.querySelectorAll('.over,.over-before,.over-after').forEach(x => x.classList.remove('over', 'over-before', 'over-after'));
  });
  container.addEventListener('dragover', e => {
    if (from < 0) return;
    const it = e.target.closest(selector); if (!it) return;
    e.preventDefault(); e.stopPropagation();
    container.querySelectorAll('.over,.over-before,.over-after').forEach(x => x.classList.remove('over', 'over-before', 'over-after'));
    if (horizontal) {
      const r = it.getBoundingClientRect();
      it.classList.add(e.clientX < r.left + r.width / 2 ? 'over-before' : 'over-after');
    } else it.classList.add('over');
  });
  container.addEventListener('drop', e => {
    if (from < 0) return;
    const it = e.target.closest(selector); if (!it) { from = -1; return; }
    e.preventDefault(); e.stopPropagation();
    const items = [...container.querySelectorAll(selector)];
    let to = items.indexOf(it);
    if (horizontal) {
      const r = it.getBoundingClientRect();
      if (e.clientX >= r.left + r.width / 2) to += 1;
      if (to > from) to -= 1;
    }
    if (to !== from && to >= 0) onMove(from, to);
    from = -1;
  });
}

export function move(arr, from, to) { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); return arr; }

export function pageHead(tool) {
  return h('div', { class: 'page-head' },
    h('div', { class: 'ico', html: icon(tool.icon) }),
    h('div', {}, h('h1', {}, tool.name), h('p', { class: 'sub' }, tool.long || tool.desc)));
}
