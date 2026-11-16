import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, fmtBytes, toast, busy, tick, sortable, move, finishSave, store, storeSet, field, seg } from '../ui.js';
import { icon } from '../icons.js';
import { openPdf, renderThumb, embedImageFile, fileToCanvas, PAGE_SIZES } from '../pdf.js';

const tool = {
  id: 'merge', group: 'pdf', icon: 'merge', name: 'Merge PDFs',
  desc: 'Combine PDFs and images into one file',
  long: 'Combine several PDFs (and images) into a single PDF. Drag to set the order.',
  accept: '.pdf,application/pdf,image/*', multiple: true,
  mount(root, { files }) {
    const items = []; // { file, kind, pdf?, pages, thumb }
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, multiple: true, title: 'Choose PDFs or images', hint: 'or drag and drop them here · add as many as you like', onFiles: add });
    const list = h('div', { class: 'files' });
    const sizeSel = seg([['fit', 'Image size'], ['a4', 'A4'], ['letter', 'Letter']], store('merge.imgsize', 'fit'), v => storeSet('merge.imgsize', v));
    const opts = h('div', { class: 'panel', hidden: true }, h('div', { class: 'row' },
      field('Page size for images', sizeSel, 'Applies only to images you add')));
    const mergeBtn = h('button', { class: 'btn primary big', type: 'button', onclick: run, disabled: true }, 'Merge and save');
    const total = h('span', { class: 'hint' });
    const actions = h('div', { class: 'actions', hidden: true },
      mergeBtn, h('button', { class: 'btn', type: 'button', onclick: () => sortBy() }, 'Sort A–Z'),
      h('button', { class: 'btn danger', type: 'button', onclick: reset }, 'Clear'), total);
    const addMore = dropzone({ accept: tool.accept, multiple: true, title: 'Add more files', compact: true, onFiles: add });
    addMore.hidden = true;
    root.append(zone, list, addMore, opts, actions);
    sortable(list, '.file', (a, b) => { move(items, a, b); draw(); });

    async function add(fs) {
      const b = fs.length > 2 ? busy('Reading files…') : null;
      let i = 0;
      for (const file of fs) {
        b?.update(i++ / fs.length);
        const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
        try {
          if (isPdf) {
            const pdf = await openPdf(file);
            if (!pdf) continue;
            const thumb = await renderThumb(pdf.view, 1, 38, 50);
            items.push({ file, kind: 'pdf', pdf, pages: pdf.pageCount, thumb });
          } else {
            const c = await fileToCanvas(file);
            const t = document.createElement('canvas');
            const s = Math.min(38 / c.width, 50 / c.height);
            t.width = Math.max(1, c.width * s * 2); t.height = Math.max(1, c.height * s * 2);
            t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
            t.style.width = (t.width / 2) + 'px';
            items.push({ file, kind: 'img', pages: 1, thumb: t });
          }
        } catch (e) { toast(e.message, 'err'); }
        await tick();
      }
      b?.done();
      draw();
    }

    function draw() {
      list.innerHTML = '';
      items.forEach((it, i) => {
        list.append(h('div', { class: 'file', draggable: 'true' },
          h('span', { class: 'grip', html: icon('grip'), title: 'Drag to reorder' }),
          h('div', { class: 'thumb' }, it.thumb),
          h('div', { class: 'meta' }, h('b', {}, it.file.name),
            h('span', {}, `${it.kind === 'pdf' ? it.pages + (it.pages === 1 ? ' page' : ' pages') : 'Image'} · ${fmtBytes(it.file.size)}${it.pdf?.encrypted ? ' · unlocked' : ''}`)),
          h('button', { class: 'btn icon sm', type: 'button', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0, html: icon('up'), onclick: () => { move(items, i, i - 1); draw(); } }),
          h('button', { class: 'btn icon sm', type: 'button', title: 'Move down', 'aria-label': 'Move down', disabled: i === items.length - 1, html: icon('down'), onclick: () => { move(items, i, i + 1); draw(); } }),
          h('button', { class: 'btn icon sm danger', type: 'button', title: 'Remove', 'aria-label': 'Remove', html: icon('x'), onclick: () => { items.splice(i, 1); draw(); } })));
      });
      const has = items.length > 0;
      zone.hidden = has; addMore.hidden = !has; actions.hidden = !has;
      opts.hidden = !items.some(i => i.kind === 'img');
      mergeBtn.disabled = items.length < 1 || (items.length < 2 && items[0]?.kind === 'pdf');
      const pages = items.reduce((s, i) => s + i.pages, 0);
      total.textContent = has ? `${items.length} file${items.length > 1 ? 's' : ''} · ${pages} page${pages > 1 ? 's' : ''}${items.length === 1 && items[0].kind === 'pdf' ? ' · add another file to merge' : ''}` : '';
      root.querySelector('.result')?.remove();
    }

    function sortBy() { items.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true })); draw(); }
    function reset() { items.length = 0; draw(); }

    async function run() {
      const b = busy('Merging…');
      try {
        const out = await PDFDocument.create();
        let i = 0;
        for (const it of items) {
          b.update(i++ / items.length, `Adding ${it.file.name}…`);
          if (it.kind === 'pdf') {
            const pages = await out.copyPages(it.pdf.lib, it.pdf.lib.getPageIndices());
            pages.forEach(p => out.addPage(p));
          } else {
            const img = await embedImageFile(out, it.file);
            const mode = sizeSel.value;
            if (mode === 'fit') {
              const p = out.addPage([img.width * 0.75, img.height * 0.75]);
              p.drawImage(img, { x: 0, y: 0, width: p.getWidth(), height: p.getHeight() });
            } else {
              let [w, hh] = PAGE_SIZES[mode];
              if (img.width > img.height) [w, hh] = [hh, w];
              const p = out.addPage([w, hh]);
              const m = 28, s = Math.min((w - 2 * m) / img.width, (hh - 2 * m) / img.height);
              p.drawImage(img, { x: (w - img.width * s) / 2, y: (hh - img.height * s) / 2, width: img.width * s, height: img.height * s });
            }
          }
          await tick();
        }
        b.update(1, 'Saving…');
        const bytes = await out.save({ useObjectStreams: true });
        b.done();
        const first = items[0].file.name.replace(/\.[^.]+$/, '');
        await finishSave(root, bytes, `${first}-merged.pdf`, reset, `${out.getPageCount()} pages`);
      } catch (e) { b.done(); console.error(e); toast('Merge failed: ' + e.message, 'err'); }
    }

    if (files?.length) add(files);
    return { onFiles: add };
  },
};
export default tool;
