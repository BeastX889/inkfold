import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, tick, finishSave, baseName, field, seg, store, storeSet, fmtBytes, makeZip } from '../ui.js';
import { openPdf, parseRanges, renderThumb } from '../pdf.js';

const tool = {
  id: 'split', group: 'pdf', icon: 'split', name: 'Split PDF',
  desc: 'Pull out page ranges or split into files',
  long: 'Split a PDF into several files: by page ranges, every N pages, or one file per page.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    let pdf = null;
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF', onFiles: fs => load(fs[0]) });
    const info = h('div', { class: 'file' });
    const mode = seg([['ranges', 'Page ranges'], ['every', 'Every N pages'], ['single', 'One file per page']], store('split.mode', 'ranges'), v => { storeSet('split.mode', v); sync(); });
    const ranges = h('input', { type: 'text', placeholder: 'e.g. 1-3, 5, 8-10', style: { width: '260px' } });
    const nInp = h('input', { type: 'number', min: '1', value: '2', style: { width: '100px' } });
    const fRanges = field('Ranges (each becomes its own file)', ranges, 'Use commas between ranges. "8-" means page 8 to the end.');
    const fEvery = field('Pages per file', nInp);
    const merged = h('label', { class: 'check' }, h('input', { type: 'checkbox' }), 'Put all ranges into one PDF instead');
    const preview = h('p', { class: 'hint', style: { marginBottom: 0 } });
    const panel = h('div', { class: 'panel', hidden: true },
      info, h('div', { style: { height: '14px' } }),
      h('div', { class: 'row' }, field('Split by', mode)),
      h('div', { class: 'row', style: { marginTop: '14px' } }, fRanges, fEvery, merged),
      preview,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Split and save'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another PDF')));
    root.append(zone, panel);
    [ranges, nInp, merged.firstChild].forEach(el => el.addEventListener('input', sync));

    function plan() {
      const max = pdf.pageCount;
      if (mode.value === 'ranges') {
        const g = parseRanges(ranges.value, max);
        return merged.firstChild.checked ? [g.flat()] : g;
      }
      const n = mode.value === 'single' ? 1 : Math.max(1, Math.floor(+nInp.value || 1));
      const out = [];
      for (let i = 1; i <= max; i += n) out.push(Array.from({ length: Math.min(n, max - i + 1) }, (_, k) => i + k));
      return out;
    }
    function sync() {
      fRanges.hidden = mode.value !== 'ranges'; merged.hidden = mode.value !== 'ranges';
      fEvery.hidden = mode.value !== 'every';
      if (!pdf) return;
      try {
        const p = plan();
        preview.style.color = '';
        preview.textContent = p.length === 1 ? `You’ll get 1 PDF with ${p[0].length} page${p[0].length > 1 ? 's' : ''}.` : `You’ll get ${p.length} PDFs, saved together in a .zip file.`;
      } catch (e) { preview.textContent = e.message; preview.style.color = 'var(--err)'; }
      root.querySelector('.result')?.remove();
    }

    async function load(file) {
      try { pdf = await openPdf(file); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      const thumb = await renderThumb(pdf.view, 1, 38, 50);
      info.replaceChildren(h('div', { class: 'thumb' }, thumb), h('div', { class: 'meta' }, h('b', {}, pdf.name), h('span', {}, `${pdf.pageCount} pages · ${fmtBytes(pdf.size)}`)));
      ranges.value = pdf.pageCount > 1 ? `1-${Math.ceil(pdf.pageCount / 2)}, ${Math.ceil(pdf.pageCount / 2) + 1}-${pdf.pageCount}` : '1';
      if (pdf.pageCount === 1) ranges.value = '1';
      zone.hidden = true; panel.hidden = false; sync();
    }
    function reset() { pdf = null; zone.hidden = false; panel.hidden = true; root.querySelector('.result')?.remove(); }

    async function run() {
      let groups;
      try { groups = plan(); } catch (e) { return toast(e.message, 'err'); }
      const b = busy('Splitting…');
      try {
        const outs = [];
        for (let i = 0; i < groups.length; i++) {
          b.update(i / groups.length);
          const doc = await PDFDocument.create();
          const pages = await doc.copyPages(pdf.lib, groups[i].map(n => n - 1));
          pages.forEach(p => doc.addPage(p));
          const g = groups[i];
          const label = g.length === 1 ? `p${g[0]}` : (g.every((v, k) => k === 0 || v === g[k - 1] + 1) ? `p${g[0]}-${g[g.length - 1]}` : `part${i + 1}`);
          outs.push({ name: `${baseName(pdf.name)}-${label}.pdf`, bytes: await doc.save({ useObjectStreams: true }) });
          await tick();
        }
        if (outs.length === 1) { b.done(); return finishSave(root, outs[0].bytes, outs[0].name, reset); }
        b.update(1, 'Zipping…');
        const blob = await makeZip(outs.map(o => ({ name: o.name, data: o.bytes })));
        b.done();
        await finishSave(root, blob, `${baseName(pdf.name)}-split.zip`, reset, `${outs.length} PDFs`);
      } catch (e) { b.done(); console.error(e); toast('Split failed: ' + e.message, 'err'); }
    }

    sync();
    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
