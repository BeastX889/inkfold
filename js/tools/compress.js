import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, tick, finishSave, baseName, fmtBytes, store, storeSet } from '../ui.js';
import { openPdf, renderThumb, renderAtDpi, canvasToBlob, blobBytes } from '../pdf.js';

const LEVELS = {
  basic: { label: 'Basic', sub: 'Keeps text sharp and selectable. Smaller savings.' },
  strong: { label: 'Strong', sub: 'Pages become 120 DPI images. Good for scans and photos.', dpi: 120, q: 0.68 },
  max: { label: 'Smallest', sub: 'Pages become 80 DPI images. For email limits; text gets soft.', dpi: 80, q: 0.5 },
};

const tool = {
  id: 'compress', group: 'pdf', icon: 'compress', name: 'Compress PDF',
  desc: 'Make a PDF smaller for email and uploads',
  long: 'Shrink a PDF so it fits email and upload limits. Compare sizes before you save.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    let pdf = null, level = store('compress.level', 'strong'), out = null;
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF', onFiles: fs => load(fs[0]) });
    const info = h('div', { class: 'file' });
    const levels = h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', marginTop: '14px' } });
    const outInfo = h('div');
    const runBtn = h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Compress');
    const panel = h('div', { class: 'panel', hidden: true }, info, levels,
      h('div', { class: 'actions' }, runBtn, h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another PDF')), outInfo);
    root.append(zone, panel);

    function drawLevels() {
      levels.innerHTML = '';
      for (const [k, v] of Object.entries(LEVELS)) {
        const b = h('button', { type: 'button', class: 'tool-card', 'aria-pressed': String(k === level), style: k === level ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : {} },
          h('div', {}, h('b', {}, v.label), h('span', {}, v.sub)));
        b.addEventListener('click', () => { level = k; storeSet('compress.level', k); out = null; outInfo.innerHTML = ''; drawLevels(); });
        levels.append(b);
      }
    }

    async function load(file) {
      try { pdf = await openPdf(file); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      info.replaceChildren(h('div', { class: 'thumb' }, await renderThumb(pdf.view, 1, 38, 50)),
        h('div', { class: 'meta' }, h('b', {}, pdf.name), h('span', {}, `${pdf.pageCount} pages · ${fmtBytes(pdf.size)}`)));
      zone.hidden = true; panel.hidden = false; out = null; outInfo.innerHTML = ''; drawLevels();
    }
    function reset() { pdf = null; out = null; zone.hidden = false; panel.hidden = true; outInfo.innerHTML = ''; root.querySelector('.result')?.remove(); }

    async function run() {
      const L = LEVELS[level];
      const b = busy('Compressing…');
      try {
        let bytes;
        if (!L.dpi) {
          const doc = await PDFDocument.load(pdf.bytes, { password: pdf.password, updateMetadata: false });
          doc.setProducer('Inkfold'); doc.setCreator('Inkfold');
          bytes = await doc.save({ useObjectStreams: true });
        } else {
          const doc = await PDFDocument.create();
          for (let n = 1; n <= pdf.pageCount; n++) {
            b.update((n - 1) / pdf.pageCount, `Compressing page ${n} of ${pdf.pageCount}…`);
            const page = await pdf.view.getPage(n);
            const vp = page.getViewport({ scale: 1 });
            const c = await renderAtDpi(pdf.view, n, L.dpi);
            const jpg = await doc.embedJpg(await blobBytes(await canvasToBlob(c, 'image/jpeg', L.q)));
            const p = doc.addPage([vp.width, vp.height]);
            p.drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
            c.width = c.height = 0;
            await tick();
          }
          bytes = await doc.save({ useObjectStreams: true });
        }
        b.done();
        out = bytes;
        const saved = 1 - bytes.length / pdf.size;
        outInfo.innerHTML = '';
        if (saved < 0.01) {
          const bigger = bytes.length >= pdf.size;
          outInfo.append(h('div', { class: 'note warn' }, bigger
            ? `This PDF is already compact (${fmtBytes(pdf.size)}). ${L.label} compression would make it bigger (${fmtBytes(bytes.length)}), so keep the original${level === 'basic' ? '' : ' or try Basic'}.`
            : `This PDF is already well optimised: ${L.label} only gets it from ${fmtBytes(pdf.size)} to ${fmtBytes(bytes.length)}.${level === 'basic' ? ' Try Strong for a bigger reduction.' : ''}`));
          if (bytes.length < pdf.size) outInfo.append(h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: doSave }, 'Save anyway')));
        } else {
          outInfo.append(h('div', { class: 'note' }, h('div', {},
            h('b', {}, `${fmtBytes(pdf.size)} → ${fmtBytes(bytes.length)}`), ` · ${Math.round(saved * 100)}% smaller`,
            L.dpi ? h('div', { class: 'hint' }, 'Text in the compressed file is part of the page image, so it can’t be selected or searched.') : null)),
          h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', onclick: doSave }, 'Save compressed PDF')));
        }
      } catch (e) { b.done(); console.error(e); toast('Compression failed: ' + e.message, 'err'); }
    }
    async function doSave() { if (out) await finishSave(root, out, baseName(pdf.name) + '-compressed.pdf', reset); }

    drawLevels();
    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
