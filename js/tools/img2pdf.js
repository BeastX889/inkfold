import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, tick, sortable, move, finishSave, baseName, fmtBytes, field, seg, store, storeSet } from '../ui.js';
import { icon } from '../icons.js';
import { embedImageFile, PAGE_SIZES } from '../pdf.js';

const tool = {
  id: 'img2pdf', group: 'convert', icon: 'img2pdf', name: 'Images to PDF',
  desc: 'Turn photos and scans into one PDF',
  long: 'Turn photos, scans and screenshots into a single PDF. Drag to set the page order.',
  accept: 'image/*', multiple: true,
  mount(root, { files }) {
    const items = [];
    const st = store('i2p', { size: 'a4', orient: 'auto', margin: 'small' });
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, multiple: true, title: 'Choose images', hint: 'JPG, PNG, WebP, GIF, BMP · or drag and drop', onFiles: add });
    const grid = h('div', { class: 'pages' });
    const addMore = dropzone({ accept: tool.accept, multiple: true, title: 'Add more images', compact: true, onFiles: add });
    const size = seg([['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'Letter']], st.size, save);
    const orient = seg([['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], st.orient, save);
    const margin = seg([['none', 'None'], ['small', 'Small'], ['large', 'Large']], st.margin, save);
    const opts = h('div', { class: 'panel' }, h('div', { class: 'row' }, field('Page size', size), field('Orientation', orient), field('Margin', margin)));
    const count = h('span', { class: 'hint' });
    const actions = h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Create PDF'),
      h('button', { class: 'btn danger', type: 'button', onclick: reset }, 'Clear'), count);
    const work = h('div', { hidden: true }, grid, h('div', { style: { height: '12px' } }), addMore, opts, actions);
    root.append(zone, work);
    sortable(grid, '.pg', (a, b) => { move(items, a, b); draw(); }, { horizontal: true });
    function save() { storeSet('i2p', { size: size.value, orient: orient.value, margin: margin.value }); }

    function add(fs) {
      for (const f of fs) items.push({ file: f, url: URL.createObjectURL(f) });
      draw();
    }
    function draw() {
      grid.innerHTML = '';
      items.forEach((it, i) => grid.append(h('div', { class: 'pg', draggable: 'true' },
        h('div', { class: 'tools' }, h('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove', html: icon('trash'), onclick: e => { e.stopPropagation(); URL.revokeObjectURL(it.url); items.splice(i, 1); draw(); } })),
        h('div', { class: 'cv' }, h('img', { src: it.url, alt: it.file.name, style: { maxWidth: '100%', maxHeight: '170px', boxShadow: '0 1px 4px rgba(0,0,0,.18)' }, draggable: 'false' })),
        h('div', { class: 'lbl' }, h('span', {}, `${i + 1}. ${it.file.name.length > 16 ? it.file.name.slice(0, 14) + '…' : it.file.name}`), h('span', {}, fmtBytes(it.file.size))))));
      zone.hidden = items.length > 0; work.hidden = !items.length;
      count.textContent = `${items.length} image${items.length === 1 ? '' : 's'}`;
      root.querySelector('.result')?.remove();
    }
    function reset() { items.forEach(i => URL.revokeObjectURL(i.url)); items.length = 0; draw(); }

    async function run() {
      const b = busy('Creating PDF…');
      try {
        const doc = await PDFDocument.create();
        const m = { none: 0, small: 24, large: 56 }[margin.value];
        for (let i = 0; i < items.length; i++) {
          b.update(i / items.length, `Adding image ${i + 1} of ${items.length}…`);
          let img;
          try { img = await embedImageFile(doc, items[i].file); } catch (e) { toast(`Skipped ${items[i].file.name}: ${e.message}`, 'err'); continue; }
          let w, hh;
          if (size.value === 'fit') { w = img.width * 0.75 + 2 * m; hh = img.height * 0.75 + 2 * m; }
          else {
            [w, hh] = PAGE_SIZES[size.value];
            const land = orient.value === 'landscape' || (orient.value === 'auto' && img.width > img.height);
            if (land) [w, hh] = [hh, w];
          }
          const p = doc.addPage([w, hh]);
          const s = Math.min((w - 2 * m) / img.width, (hh - 2 * m) / img.height);
          p.drawImage(img, { x: (w - img.width * s) / 2, y: (hh - img.height * s) / 2, width: img.width * s, height: img.height * s });
          await tick();
        }
        if (!doc.getPageCount()) { b.done(); return toast('None of the images could be read.', 'err'); }
        const out = await doc.save({ useObjectStreams: true });
        b.done();
        await finishSave(root, out, (items.length === 1 ? baseName(items[0].file.name) : 'images') + '.pdf', reset, `${doc.getPageCount()} pages`);
      } catch (e) { b.done(); console.error(e); toast('Couldn’t create PDF: ' + e.message, 'err'); }
    }

    if (files?.length) add(files);
    return { onFiles: add, destroy: () => items.forEach(i => URL.revokeObjectURL(i.url)) };
  },
};
export default tool;
