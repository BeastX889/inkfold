import { h, dropzone, pageHead, toast, busy, tick, finishSave, baseName, fmtBytes, field, seg, store, storeSet, makeZip } from '../ui.js';
import { icon } from '../icons.js';
import { fileToCanvas, canvasToBlob } from '../pdf.js';

const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

const tool = {
  id: 'imgconvert', group: 'image', icon: 'convert', name: 'Convert & resize',
  desc: 'Change format, size and quality of images',
  long: 'Convert images to JPG, PNG or WebP, resize them and shrink file sizes, many at once.',
  accept: 'image/*', multiple: true,
  mount(root, { files }) {
    const items = [];
    const st = store('ic', { fmt: 'jpg', q: 82, mode: 'none', pct: 50, maxw: 1920 });
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, multiple: true, title: 'Choose images', hint: 'JPG, PNG, WebP, GIF, BMP, AVIF · or drag and drop', onFiles: add });
    const list = h('div', { class: 'files' });
    const addMore = dropzone({ accept: tool.accept, multiple: true, title: 'Add more images', compact: true, onFiles: add });
    const fmt = seg([['jpg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']], st.fmt, sync);
    const q = h('input', { type: 'range', min: '30', max: '100', value: String(st.q) });
    const qLbl = h('span', { class: 'hint' });
    const mode = seg([['none', 'Keep size'], ['pct', 'Percent'], ['maxw', 'Max width']], st.mode, sync);
    const pct = h('input', { type: 'number', min: '1', max: '400', value: String(st.pct), style: { width: '90px' } });
    const maxw = h('input', { type: 'number', min: '16', max: '20000', value: String(st.maxw), style: { width: '110px' } });
    const fQ = field('Quality', h('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, q, qLbl));
    const fPct = field('Scale (%)', pct), fMax = field('Max width (px)', maxw, 'Smaller images are left as they are');
    const opts = h('div', { class: 'panel' }, h('div', { class: 'row' }, field('Convert to', fmt), fQ, field('Resize', mode), fPct, fMax));
    const count = h('span', { class: 'hint' });
    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Convert and save'),
      h('button', { class: 'btn danger', type: 'button', onclick: reset }, 'Clear'), count);
    const work = h('div', { hidden: true }, list, h('div', { style: { height: '10px' } }), addMore, opts, actions);
    root.append(zone, work);
    [q, pct, maxw].forEach(e => e.addEventListener('input', sync));

    function sync() {
      fQ.hidden = fmt.value === 'png';
      fPct.hidden = mode.value !== 'pct'; fMax.hidden = mode.value !== 'maxw';
      qLbl.textContent = q.value + '%';
      storeSet('ic', { fmt: fmt.value, q: +q.value, mode: mode.value, pct: +pct.value, maxw: +maxw.value });
    }
    function add(fs) { for (const f of fs) items.push({ file: f, url: URL.createObjectURL(f) }); draw(); }
    function draw() {
      list.innerHTML = '';
      items.forEach((it, i) => list.append(h('div', { class: 'file' },
        h('div', { class: 'thumb' }, h('img', { src: it.url, alt: '' })),
        h('div', { class: 'meta' }, h('b', {}, it.file.name), h('span', {}, fmtBytes(it.file.size) + (it.out ? ` → ${fmtBytes(it.out)}` : ''))),
        h('button', { class: 'btn icon sm danger', type: 'button', title: 'Remove', 'aria-label': 'Remove', html: icon('x'), onclick: () => { URL.revokeObjectURL(it.url); items.splice(i, 1); draw(); } }))));
      zone.hidden = items.length > 0; work.hidden = !items.length;
      const tot = items.reduce((s, i) => s + i.file.size, 0);
      count.textContent = `${items.length} image${items.length === 1 ? '' : 's'} · ${fmtBytes(tot)}`;
    }
    function reset() { items.forEach(i => URL.revokeObjectURL(i.url)); items.length = 0; draw(); root.querySelector('.result')?.remove(); }

    async function run() {
      const b = busy('Converting…');
      const ext = fmt.value, type = TYPES[ext];
      const out = [];
      try {
        for (let i = 0; i < items.length; i++) {
          b.update(i / items.length, `Image ${i + 1} of ${items.length}…`);
          let src;
          try { src = await fileToCanvas(items[i].file); } catch (e) { toast(e.message, 'err'); continue; }
          let k = 1;
          if (mode.value === 'pct') k = Math.max(0.01, (+pct.value || 100) / 100);
          if (mode.value === 'maxw') k = Math.min(1, (+maxw.value || src.width) / src.width);
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
          const ctx = c.getContext('2d');
          if (ext === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(src, 0, 0, c.width, c.height);
          const blob = await canvasToBlob(c, type, +q.value / 100);
          if (ext === 'webp' && blob.type !== 'image/webp') throw new Error('WebP isn’t supported by this browser.');
          items[i].out = blob.size;
          out.push({ name: `${baseName(items[i].file.name)}.${ext}`, data: blob });
          src.width = src.height = c.width = c.height = 0;
          await tick();
        }
        draw();
        if (!out.length) { b.done(); return; }
        if (out.length === 1) { b.done(); return finishSave(root, out[0].data, out[0].name, reset); }
        b.update(1, 'Zipping…');
        const zip = await makeZip(out);
        b.done();
        const before = items.reduce((s, i) => s + i.file.size, 0), after = out.reduce((s, o) => s + o.data.size, 0);
        await finishSave(root, zip, 'converted-images.zip', reset, `${out.length} images · ${fmtBytes(before)} → ${fmtBytes(after)}`);
      } catch (e) { b.done(); console.error(e); toast('Conversion failed: ' + e.message, 'err'); }
    }

    sync();
    if (files?.length) add(files);
    return { onFiles: add, destroy: () => items.forEach(i => URL.revokeObjectURL(i.url)) };
  },
};
export default tool;
