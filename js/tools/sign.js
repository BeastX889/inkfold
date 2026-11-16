import { PDFDocument, degrees } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, tick, finishSave, baseName, dialog, field, pickFiles, store, storeSet } from '../ui.js';
import { icon } from '../icons.js';
import { openPdf, fileToCanvas, blobBytes, canvasToBlob, renderParams } from '../pdf.js';
import { createSignature, savedSigs, removeSig } from '../sigpad.js';

const COLORS = [['#111111', 'Black'], ['#1d3fbf', 'Blue'], ['#b3122e', 'Red']];
const PX_PER_PT = 4; // resolution used to rasterize text/marks into the PDF

/* Render a text or mark item to a transparent canvas. Sizes are in PDF points. */
function renderTextCanvas(text, sizePt, color) {
  const px = sizePt * PX_PER_PT;
  const lines = text.split('\n');
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `${px}px Helvetica, Arial, sans-serif`;
  ctx.font = font;
  const w = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
  const lh = px * 1.15;
  c.width = Math.ceil(w + px * 0.1); c.height = Math.ceil(lh * lines.length + px * 0.05);
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, 0, i * lh + px * 0.05));
  return c;
}
function renderMarkCanvas(kind, color) {
  const s = 160, c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.13; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'check') { ctx.moveTo(s * 0.16, s * 0.54); ctx.lineTo(s * 0.4, s * 0.78); ctx.lineTo(s * 0.86, s * 0.24); }
  else if (kind === 'cross') { ctx.moveTo(s * 0.2, s * 0.2); ctx.lineTo(s * 0.8, s * 0.8); ctx.moveTo(s * 0.8, s * 0.2); ctx.lineTo(s * 0.2, s * 0.8); }
  else { ctx.fillStyle = color; ctx.arc(s / 2, s / 2, s * 0.28, 0, Math.PI * 2); ctx.fill(); }
  ctx.stroke();
  return c;
}
function todayStr() {
  const fmt = store('sign.datefmt', 'locale');
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  if (fmt === 'iso') return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  if (fmt === 'dmy') return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (fmt === 'mdy') return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

const tool = {
  id: 'sign', group: 'pdf', icon: 'sign', name: 'Sign & fill',
  desc: 'Add your signature, text, dates and ticks',
  long: 'Sign a PDF and fill it in: add your signature, initials, text, the date, ticks and images, then save.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    let pdf = null;
    let sheets = [];      // { n, el, vp1 (viewport at scale 1 with page rotation), rot, w, h, rendered }
    let items = [];       // { id, page, nx, ny, nw, nh, kind, src, text, sizePt, color, el }
    let armed = null;     // { kind, src? }
    let active = null;
    let color = store('sign.color', '#111111');
    let observer = null;
    let idSeq = 0;

    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF to sign', onFiles: fs => load(fs[0]) });
    const viewer = h('div', { class: 'viewer' });
    const palette = h('div', { class: 'palette' });
    const sigsBox = h('div');
    const status = h('p', { class: 'hint', style: { margin: '8px 0 0' } }, 'Pick something to add, then click on the page.');
    const colorRow = h('div', { class: 'row', style: { gap: '6px' } });
    const side = h('div', { class: 'side' },
      h('div', { class: 'card' }, h('h2', {}, 'Add to page'), palette, status),
      h('div', { class: 'card' }, h('h2', {}, 'Your signatures'), sigsBox),
      h('div', { class: 'card' }, h('h2', {}, 'Ink colour'), colorRow),
      h('div', { class: 'card' },
        h('button', { class: 'btn primary big', type: 'button', style: { width: '100%' }, onclick: save }, 'Save signed PDF'),
        h('button', { class: 'btn', type: 'button', style: { width: '100%', marginTop: '8px' }, onclick: reset }, 'Choose another PDF')));
    const editor = h('div', { class: 'editor', hidden: true }, viewer, side);
    root.append(zone, editor);

    const PAL = [
      ['signature', 'Signature', 'sign'], ['initials', 'Initials', 'sign'],
      ['text', 'Text', 'text'], ['date', 'Date', 'calendar'],
      ['check', 'Tick', 'check'], ['cross', 'Cross', 'x'],
      ['dot', 'Dot', 'select'], ['image', 'Image', 'image'],
    ];
    const palBtns = {};
    for (const [k, label, ic] of PAL) {
      const b = h('button', { type: 'button', 'aria-pressed': 'false', html: icon(ic) + `<span>${label}</span>` });
      if (k === 'initials') b.querySelector('svg').style.transform = 'scale(.8)';
      b.addEventListener('click', () => choose(k));
      palBtns[k] = b; palette.append(b);
    }
    COLORS.forEach(([c, label]) => {
      const b = h('button', { type: 'button', class: 'btn sm', 'aria-pressed': String(c === color), title: label }, h('i', { style: { width: '12px', height: '12px', borderRadius: '50%', background: c, display: 'inline-block' } }), label);
      b.addEventListener('click', () => {
        color = c; storeSet('sign.color', c);
        colorRow.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true');
        if (active && ['text', 'date', 'check', 'cross', 'dot'].includes(active.kind)) { active.color = c; paintItem(active); }
      });
      colorRow.append(b);
    });
    colorRow.querySelectorAll('button').forEach(b => b.style.flex = '1');

    function drawSigs() {
      sigsBox.innerHTML = '';
      for (const [store, kind, label] of [['sigs', 'signature', 'Signatures'], ['inits', 'initials', 'Initials']]) {
        const list = savedSigs(store);
        const row = h('div', { class: 'sigs' });
        for (const url of list) {
          const b = h('button', { type: 'button', title: `Place these ${kind} (right-click to forget)` }, h('img', { src: url, alt: 'Saved ' + kind }));
          b.addEventListener('click', () => arm({ kind, src: url }, `Click on the page where your ${kind} go${kind === 'initials' ? '' : 'es'}.`));
          b.addEventListener('contextmenu', async e => {
            e.preventDefault();
            const ok = await dialog({ title: 'Forget this?', body: h('p', { class: 'hint' }, 'It will be removed from this device. Copies already placed on the page stay.'), ok: 'Forget' });
            if (ok) { removeSig(url, store); drawSigs(); }
          });
          row.append(b);
        }
        row.append(h('button', { type: 'button', title: `Create new ${kind}`, 'aria-label': `Create new ${kind}`, style: { background: 'var(--panel-2)' }, onclick: () => choose(kind, true), html: icon('plus') }));
        sigsBox.append(h('div', { class: 'hint', style: { margin: store === 'inits' ? '10px 0 4px' : '0 0 4px' } }, label), row);
      }
      sigsBox.append(h('div', { class: 'hint', style: { marginTop: '8px', fontSize: '12px' } }, 'Saved only on this device. Right-click one to forget it.'));
    }

    function arm(a, msg) {
      armed = a;
      Object.entries(palBtns).forEach(([k, b]) => b.setAttribute('aria-pressed', String(a && k === a.kind)));
      sheets.forEach(s => s.el.classList.toggle('armed', !!a));
      status.textContent = a ? msg : 'Pick something to add, then click on the page.';
    }

    async function choose(kind, forceNew) {
      if (kind === 'signature' || kind === 'initials') {
        const list = savedSigs(kind === 'initials' ? 'inits' : 'sigs');
        let src = !forceNew && list[0];
        if (!src) {
          src = await createSignature({ title: kind === 'initials' ? 'Create your initials' : 'Create your signature', initials: kind === 'initials' });
          drawSigs();
        }
        if (src) arm({ kind, src }, `Click on the page where your ${kind} go${kind === 'initials' ? '' : 'es'}.`);
        return;
      }
      if (kind === 'image') {
        const [f] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/gif' });
        if (!f) return;
        try {
          const c = await fileToCanvas(f);
          const s = Math.min(1, 1600 / Math.max(c.width, c.height));
          const t = document.createElement('canvas'); t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
          t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
          arm({ kind: 'image', src: t.toDataURL(f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92) }, 'Click on the page where the image goes.');
        } catch (e) { toast(e.message, 'err'); }
        return;
      }
      if (kind === 'text') {
        const t = await editText('', store('sign.size', 12));
        if (t) arm({ kind: 'text', text: t.text, sizePt: t.size }, 'Click on the page where the text goes.');
        return;
      }
      if (kind === 'date') return arm({ kind: 'date', text: todayStr(), sizePt: store('sign.size', 12) }, 'Click on the page where the date goes.');
      arm({ kind }, 'Click on the page to place it. Click again to add more.');
    }

    async function editText(text, size) {
      const ta = h('textarea', { rows: '3', style: { width: '100%' }, 'aria-label': 'Text' }, text);
      const sz = h('input', { type: 'number', min: '5', max: '96', value: String(size), style: { width: '90px' } });
      const fmt = h('select', {}, ...[['locale', 'Long (' + new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }) + ')'], ['dmy', 'DD/MM/YYYY'], ['mdy', 'MM/DD/YYYY'], ['iso', 'YYYY-MM-DD']].map(([v, l]) => h('option', { value: v, selected: store('sign.datefmt', 'locale') === v }, l)));
      const insertDate = h('button', { type: 'button', class: 'btn sm', onclick: () => { storeSet('sign.datefmt', fmt.value); ta.value += (ta.value && !ta.value.endsWith(' ') ? ' ' : '') + todayStr(); ta.focus(); } }, 'Insert date');
      const body = h('div', {}, ta, h('div', { class: 'row', style: { marginTop: '10px', alignItems: 'flex-end' } }, field('Size (pt)', sz), field('Date style', fmt), insertDate));
      return dialog({
        title: text ? 'Edit text' : 'Add text', body, ok: text ? 'Update' : 'Add',
        onOpen: () => ta.focus(),
        validate: () => {
          const v = ta.value.replace(/\s+$/, '');
          if (!v) { toast('Type some text first.', 'err'); return false; }
          storeSet('sign.size', +sz.value || 12); storeSet('sign.datefmt', fmt.value);
          return { text: v, size: Math.max(5, Math.min(96, +sz.value || 12)) };
        },
      });
    }

    async function load(file) {
      let p;
      try { p = await openPdf(file); } catch (e) { return toast(e.message, 'err'); }
      if (!p) return;
      reset(true);
      pdf = p;
      zone.hidden = true; editor.hidden = false;
      drawSigs();
      const avail = Math.min(900, Math.max(320, viewer.clientWidth - 42));
      observer = new IntersectionObserver(ents => ents.forEach(e => { if (e.isIntersecting) renderSheet(sheets.find(s => s.el === e.target)); }), { root: viewer, rootMargin: '800px 0px' });
      for (let n = 1; n <= pdf.pageCount; n++) {
        const page = await pdf.view.getPage(n);
        const vp1 = page.getViewport({ scale: 1, rotation: page.rotate });
        const scale = avail / vp1.width;
        const el = h('div', { class: 'sheet', style: { width: Math.round(vp1.width * scale) + 'px', height: Math.round(vp1.height * scale) + 'px' } });
        const s = { n, el, vp1, rot: page.rotate, scale, rendered: false };
        el.addEventListener('pointerdown', e => {
          if (e.target.closest('.item')) return;
          if (armed) { e.preventDefault(); place(s, e); }
          else select(null);
        });
        sheets.push(s);
        viewer.append(el, h('p', { class: 'pnum' }, `Page ${n} of ${pdf.pageCount}`));
        observer.observe(el);
      }
    }

    async function renderSheet(s) {
      if (!s || s.rendered) return;
      s.rendered = true;
      const page = await pdf.view.getPage(s.n);
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: s.scale * dpr, rotation: page.rotate });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      c.style.width = '100%'; c.style.height = '100%';
      await page.render(await renderParams(c.getContext('2d'), vp, c)).promise;
      s.el.prepend(c);
    }

    function place(s, e) {
      const r = s.el.getBoundingClientRect();
      const W = r.width, H = r.height;
      const cx = (e.clientX - r.left) / W, cy = (e.clientY - r.top) / H;
      const a = armed;
      const it = { id: ++idSeq, page: s.n, kind: a.kind, src: a.src, text: a.text, sizePt: a.sizePt, color };
      const ptW = s.vp1.width, ptH = s.vp1.height;
      if (a.kind === 'signature' || a.kind === 'initials' || a.kind === 'image') {
        const img = new Image();
        img.onload = () => {
          const targetPt = a.kind === 'signature' ? 150 : a.kind === 'initials' ? 60 : Math.min(200, ptW * 0.4);
          let wPt = Math.min(targetPt, img.naturalWidth), hPt = wPt * img.naturalHeight / img.naturalWidth;
          if (a.kind !== 'image' && hPt > 60) { hPt = 60; wPt = hPt * img.naturalWidth / img.naturalHeight; }
          it.ratio = img.naturalWidth / img.naturalHeight;
          finish(wPt / ptW, hPt / ptH);
        };
        img.src = a.src;
      } else if (a.kind === 'text' || a.kind === 'date') {
        const c = renderTextCanvas(it.text, it.sizePt, it.color);
        finish(c.width / PX_PER_PT / ptW, c.height / PX_PER_PT / ptH);
      } else {
        const sz = 16; // pt
        finish(sz / ptW, sz / ptH);
      }
      function finish(nw, nh) {
        it.nw = nw; it.nh = nh;
        it.nx = Math.max(0, Math.min(1 - nw, cx - nw / 2));
        it.ny = Math.max(0, Math.min(1 - nh, cy - nh / 2));
        items.push(it);
        mountItem(it, s);
        select(it);
        // signatures/text are usually placed once; marks are often placed many times
        if (!['check', 'cross', 'dot'].includes(a.kind)) arm(null);
      }
    }

    function mountItem(it, s) {
      const el = h('div', { class: 'item', tabindex: '0', role: 'img', 'aria-label': it.kind },
        h('button', { class: 'del', type: 'button', title: 'Remove', 'aria-label': 'Remove' }, '×'),
        h('span', { class: 'rz', title: 'Drag to resize' }));
      it.el = el; it.sheet = s;
      paintItem(it);
      s.el.append(el);
      el.querySelector('.del').addEventListener('pointerdown', e => { e.stopPropagation(); removeItem(it); });
      el.addEventListener('dblclick', async () => {
        if (it.kind !== 'text' && it.kind !== 'date') return;
        const t = await editText(it.text, it.sizePt);
        if (!t) return;
        it.text = t.text; it.sizePt = t.size;
        const c = renderTextCanvas(it.text, it.sizePt, it.color);
        it.nw = c.width / PX_PER_PT / s.vp1.width; it.nh = c.height / PX_PER_PT / s.vp1.height;
        paintItem(it);
      });
      el.addEventListener('pointerdown', e => {
        if (e.target.classList.contains('del')) return;
        e.preventDefault(); e.stopPropagation();
        select(it);
        try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        const resizing = e.target.classList.contains('rz');
        const r = s.el.getBoundingClientRect();
        const start = { x: e.clientX, y: e.clientY, nx: it.nx, ny: it.ny, nw: it.nw, nh: it.nh, size: it.sizePt };
        const onMove = ev => {
          const dx = (ev.clientX - start.x) / r.width, dy = (ev.clientY - start.y) / r.height;
          if (resizing) {
            const k = Math.max(0.15, (start.nw + dx) / start.nw);
            let nw = start.nw * k, nh = start.nh * k;
            if (start.nx + nw > 1) { nw = 1 - start.nx; nh = start.nh * nw / start.nw; }
            if (start.ny + nh > 1) { nh = 1 - start.ny; nw = start.nw * nh / start.nh; }
            it.nw = nw; it.nh = nh;
            if (it.sizePt) it.sizePt = Math.max(4, start.size * nw / start.nw);
          } else {
            it.nx = Math.max(0, Math.min(1 - it.nw, start.nx + dx));
            it.ny = Math.max(0, Math.min(1 - it.nh, start.ny + dy));
          }
          place2(it);
        };
        const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); if (resizing) paintItem(it); };
        el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
      });
    }
    function place2(it) {
      Object.assign(it.el.style, { left: it.nx * 100 + '%', top: it.ny * 100 + '%', width: it.nw * 100 + '%', height: it.nh * 100 + '%' });
    }
    function paintItem(it) {
      place2(it);
      it.el.querySelector('img')?.remove();
      let src = it.src;
      if (it.kind === 'text' || it.kind === 'date') src = renderTextCanvas(it.text, it.sizePt, it.color).toDataURL();
      else if (['check', 'cross', 'dot'].includes(it.kind)) src = renderMarkCanvas(it.kind, it.color).toDataURL();
      it.el.prepend(h('img', { src, alt: '', draggable: 'false' }));
    }
    function removeItem(it) { it.el.remove(); items = items.filter(x => x !== it); if (active === it) active = null; }
    function select(it) {
      active = it;
      items.forEach(x => x.el.classList.toggle('active', x === it));
      if (it) it.el.focus({ preventScroll: true });
    }
    function onKey(e) {
      if (!active || e.target.closest?.('input,textarea,dialog')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeItem(active); }
      else if (e.key === 'Escape') { select(null); arm(null); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) / active.sheet.el.clientWidth;
        if (e.key === 'ArrowLeft') active.nx = Math.max(0, active.nx - step);
        if (e.key === 'ArrowRight') active.nx = Math.min(1 - active.nw, active.nx + step);
        if (e.key === 'ArrowUp') active.ny = Math.max(0, active.ny - step * active.sheet.el.clientWidth / active.sheet.el.clientHeight);
        if (e.key === 'ArrowDown') active.ny = Math.min(1 - active.nh, active.ny + step * active.sheet.el.clientWidth / active.sheet.el.clientHeight);
        place2(active);
      }
    }
    document.addEventListener('keydown', onKey);
    const onEsc = e => { if (e.key === 'Escape' && armed) arm(null); };
    document.addEventListener('keydown', onEsc);

    function reset(keepZone) {
      observer?.disconnect(); observer = null;
      pdf = null; sheets = []; items = []; active = null; armed = null;
      viewer.innerHTML = '';
      if (keepZone !== true) { zone.hidden = false; editor.hidden = true; }
      root.querySelector('.result')?.remove();
    }

    async function save() {
      if (!items.length) return toast('Add a signature or some text first.', 'err');
      const b = busy('Applying your changes…');
      try {
        const doc = await PDFDocument.load(pdf.bytes, { password: pdf.password, updateMetadata: false });
        const pages = doc.getPages();
        const cache = new Map();
        let i = 0;
        for (const it of items) {
          b.update(i++ / items.length);
          const s = sheets.find(x => x.n === it.page);
          const page = pages[it.page - 1];
          // Build the image bytes for this item.
          let pngBytes, isJpg = false;
          if (it.kind === 'text' || it.kind === 'date') pngBytes = await blobBytes(await canvasToBlob(renderTextCanvas(it.text, it.sizePt, it.color)));
          else if (['check', 'cross', 'dot'].includes(it.kind)) pngBytes = await blobBytes(await canvasToBlob(renderMarkCanvas(it.kind, it.color)));
          else {
            const key = it.src;
            if (!cache.has(key)) {
              isJpg = key.startsWith('data:image/jpeg');
              const bytes = await (await fetch(key)).arrayBuffer();
              cache.set(key, isJpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes));
            }
          }
          const img = it.src && cache.has(it.src) && !['text', 'date', 'check', 'cross', 'dot'].includes(it.kind) ? cache.get(it.src) : await doc.embedPng(pngBytes);
          // Item box in rotated-viewport points -> PDF user space.
          const vp = s.vp1;
          const x = it.nx * vp.width, y = it.ny * vp.height, w = it.nw * vp.width, hh = it.nh * vp.height;
          const [ax, ay] = vp.convertToPdfPoint(x, y + hh); // item's bottom-left as seen on screen
          page.drawImage(img, { x: ax, y: ay, width: w, height: hh, rotate: degrees(s.rot) });
          await tick();
        }
        if (pdf.encrypted) doc.encrypt({ userPassword: pdf.password, ownerPassword: pdf.password });
        b.update(1, 'Saving…');
        const out = await doc.save({ useObjectStreams: true });
        b.done();
        await finishSave(root, out, baseName(pdf.name) + '-signed.pdf', null, pdf.encrypted ? 'same password as the original' : '');
      } catch (e) { b.done(); console.error(e); toast('Couldn’t save: ' + e.message, 'err'); }
    }

    if (files?.length) load(files[0]);
    return {
      onFiles: fs => load(fs[0]),
      destroy: () => { observer?.disconnect(); document.removeEventListener('keydown', onKey); document.removeEventListener('keydown', onEsc); },
    };
  },
};
export default tool;
