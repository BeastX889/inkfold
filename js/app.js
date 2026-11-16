import { h, $, dialog, toast, store, storeSet } from './ui.js';
import { icon } from './icons.js';
import merge from './tools/merge.js';
import organize from './tools/organize.js';
import split from './tools/split.js';
import sign from './tools/sign.js';
import compress from './tools/compress.js';
import protect from './tools/protect.js';
import unlock from './tools/unlock.js';
import watermark from './tools/watermark.js';
import numbers from './tools/numbers.js';
import img2pdf from './tools/img2pdf.js';
import pdf2img from './tools/pdf2img.js';
import imgconvert from './tools/imgconvert.js';
import crop from './tools/crop.js';
import cutout from './tools/cutout.js';
import { about } from './about.js';

export const APP_NAME = 'Inkfold';
const TOOLS = [sign, merge, organize, split, compress, protect, unlock, watermark, numbers, img2pdf, pdf2img, imgconvert, crop, cutout];
const GROUPS = [['pdf', 'PDF tools'], ['convert', 'Convert'], ['image', 'Image tools']];
const byId = Object.fromEntries(TOOLS.map(t => [t.id, t]));

const main = $('#main');
let pendingFiles = null;   // files handed to the next tool that opens
let current = null;        // { tool, api }

/* ---------- nav ---------- */
function buildRail() {
  const list = $('#railList');
  list.innerHTML = '';
  list.append(h('a', { class: 'rail-item', href: '#', 'data-route': 'home', html: icon('organize') + '<span>All tools</span>' }));
  for (const [g, label] of GROUPS) {
    list.append(h('div', { class: 'rail-group' }, label));
    for (const t of TOOLS.filter(t => t.group === g)) {
      list.append(h('a', { class: 'rail-item', href: '#' + t.id, 'data-route': t.id, html: icon(t.icon) + `<span>${t.name}</span>` }));
    }
  }
}

function markNav(route) {
  document.querySelectorAll('[data-route]').forEach(a => {
    if (a.classList.contains('rail-item')) a.toggleAttribute('aria-current', false);
    if (a.dataset.route === route && a.classList.contains('rail-item')) a.setAttribute('aria-current', 'page');
  });
}

/* ---------- views ---------- */
function home() {
  const page = h('div', { class: 'page' },
    h('div', { class: 'hero' },
      h('h1', {}, 'Your PDF & image toolbox'),
      h('p', {}, 'Sign, merge, split, compress and protect PDFs, and convert or tidy up images. Everything runs on this PC: your files are never uploaded.'),
      h('div', { class: 'badges' },
        h('span', { class: 'badge', html: icon('shield').replace('<svg', '<svg width="14" height="14"') + ' <b>Private</b> files stay on your device' }),
        h('span', { class: 'badge', html: icon('wifi').replace('<svg', '<svg width="14" height="14"') + ' Works offline' }),
        h('span', { class: 'badge' }, 'No sign-up, no watermarks'))));
  for (const [g, label] of GROUPS) {
    page.append(h('div', { class: 'section-title' }, label));
    page.append(h('div', { class: 'grid' }, TOOLS.filter(t => t.group === g).map(t =>
      h('a', { class: 'tool-card', href: '#' + t.id },
        h('div', { class: 'ico', html: icon(t.icon) }),
        h('div', {}, h('b', {}, t.name), h('span', {}, t.desc))))));
  }
  return page;
}

function route() {
  const id = location.hash.slice(1) || 'home';
  if (current?.api?.destroy) try { current.api.destroy(); } catch { /* */ }
  current = null;
  main.innerHTML = '';
  if (id === 'about') { main.append(about(APP_NAME)); markNav('about'); document.title = `About – ${APP_NAME}`; }
  else if (byId[id]) {
    const tool = byId[id];
    const root = h('div', { class: 'page' });
    main.append(root);
    const files = pendingFiles; pendingFiles = null;
    current = { tool, api: tool.mount(root, { files }) || {} };
    document.title = `${tool.name} – ${APP_NAME}`;
    markNav(id);
  } else { main.append(home()); document.title = `${APP_NAME} – PDF & Image Toolbox`; markNav('home'); }
  main.scrollTop = 0;
  main.focus({ preventScroll: true });
}

export function openTool(id, files) {
  pendingFiles = files || null;
  if (location.hash === '#' + id) route(); else location.hash = id;
}

/* ---------- files arriving from outside (drop / Open with) ---------- */
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isImg = f => (f.type || '').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);

async function handleIncoming(files) {
  files = files.filter(f => isPdf(f) || isImg(f));
  if (!files.length) return toast('Inkfold opens PDFs and images.', 'err');
  // A tool that is open and accepts the files takes them directly.
  if (current?.api?.onFiles) {
    const t = current.tool;
    const ok = files.filter(f => t.accept.includes('pdf') ? (isPdf(f) || (t.accept.includes('image') && isImg(f))) : isImg(f));
    if (ok.length) return current.api.onFiles(t.multiple ? ok : [ok[0]]);
  }
  const pdfs = files.filter(isPdf), imgs = files.filter(isImg);
  const kind = pdfs.length ? 'pdf' : 'image';
  const choices = TOOLS.filter(t => kind === 'pdf' ? t.accept.includes('pdf') : t.accept.includes('image'));
  const pick = await dialog({
    title: `What do you want to do with ${files.length === 1 ? '“' + files[0].name + '”' : files.length + ' files'}?`,
    body: h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' } },
      choices.map(t => h('button', { class: 'tool-card', type: 'button', onclick: () => { $('#dlg').close(); openTool(t.id, kind === 'pdf' ? (t.id === 'merge' ? files : pdfs) : imgs); } },
        h('div', { class: 'ico', html: icon(t.icon) }), h('div', {}, h('b', {}, t.name), h('span', {}, t.desc))))),
    ok: null, cancel: 'Cancel',
  });
  void pick;
}

function setupGlobalDrop() {
  const veil = $('#dropveil');
  let depth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { depth++; veil.hidden = false; } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) veil.hidden = true; });
  window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    depth = 0; veil.hidden = true;
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    handleIncoming([...e.dataTransfer.files]);
  });
  // Windows "Open with Inkfold" / double-click on a file (PWA file_handlers).
  if ('launchQueue' in window) {
    window.launchQueue.setConsumer(async params => {
      if (!params.files?.length) return;
      const files = await Promise.all(params.files.map(fh => fh.getFile()));
      handleIncoming(files);
    });
  }
  // Paste an image or PDF from the clipboard.
  window.addEventListener('paste', e => {
    if (e.target.closest?.('input,textarea')) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); handleIncoming(files); }
  });
}

/* ---------- theme ---------- */
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const label = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' }[t];
  const btn = $('#themeBtn');
  btn.innerHTML = '';
  btn.append(label);
}
function setupTheme() {
  let t = store('theme', 'system');
  applyTheme(t);
  $('#themeBtn').addEventListener('click', () => {
    t = { system: 'light', light: 'dark', dark: 'system' }[t];
    storeSet('theme', t); applyTheme(t);
  });
}

/* ---------- boot ---------- */
buildRail();
setupTheme();
setupGlobalDrop();
window.addEventListener('hashchange', route);
route();
window.addEventListener('unhandledrejection', e => {
  console.error(e.reason);
  toast((e.reason && e.reason.message) || 'Something went wrong.', 'err');
});
const devHost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !location.search.includes('sw=1');
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !devHost) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ });
}
