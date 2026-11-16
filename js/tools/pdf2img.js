import { h, dropzone, pageHead, toast, busy, tick, finishSave, baseName, fmtBytes, field, seg, store, storeSet, makeZip } from '../ui.js';
import { openPdf, renderThumb, renderAtDpi, canvasToBlob, parseRanges } from '../pdf.js';

const tool = {
  id: 'pdf2img', group: 'convert', icon: 'pdf2img', name: 'PDF to images',
  desc: 'Save pages as JPG or PNG',
  long: 'Save each page of a PDF as a JPG or PNG image, at the quality you choose.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    let pdf = null;
    const st = store('p2i', { fmt: 'jpg', dpi: 150 });
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF', onFiles: fs => load(fs[0]) });
    const info = h('div', { class: 'file' });
    const fmt = seg([['jpg', 'JPG'], ['png', 'PNG']], st.fmt, save);
    const dpi = seg([['72', 'Screen (72 DPI)'], ['150', 'Standard (150)'], ['300', 'Print (300)']], String(st.dpi), save);
    const pages = h('input', { type: 'text', placeholder: 'All pages', style: { width: '160px' } });
    const panel = h('div', { class: 'panel', hidden: true }, info,
      h('div', { class: 'row', style: { marginTop: '16px' } }, field('Format', fmt), field('Quality', dpi), field('Pages', pages, 'e.g. 1-3, 7. Leave empty for all.')),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Convert and save'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another PDF')),
      h('p', { class: 'hint' }, 'One page saves as an image; several pages save together in a .zip file.'));
    root.append(zone, panel);
    function save() { storeSet('p2i', { fmt: fmt.value, dpi: +dpi.value }); }

    async function load(file) {
      try { pdf = await openPdf(file, { needLib: false }); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      info.replaceChildren(h('div', { class: 'thumb' }, await renderThumb(pdf.view, 1, 38, 50)), h('div', { class: 'meta' }, h('b', {}, pdf.name), h('span', {}, `${pdf.pageCount} pages · ${fmtBytes(pdf.size)}`)));
      zone.hidden = true; panel.hidden = false;
    }
    function reset() { pdf = null; pages.value = ''; zone.hidden = false; panel.hidden = true; root.querySelector('.result')?.remove(); }

    async function run() {
      let list;
      try { list = pages.value.trim() ? [...new Set(parseRanges(pages.value, pdf.pageCount).flat())] : Array.from({ length: pdf.pageCount }, (_, i) => i + 1); }
      catch (e) { return toast(e.message, 'err'); }
      const b = busy('Converting…');
      try {
        const out = [];
        const ext = fmt.value, type = ext === 'png' ? 'image/png' : 'image/jpeg';
        const pad = String(pdf.pageCount).length;
        for (let i = 0; i < list.length; i++) {
          b.update(i / list.length, `Page ${list[i]} (${i + 1} of ${list.length})…`);
          const c = await renderAtDpi(pdf.view, list[i], +dpi.value);
          out.push({ name: `${baseName(pdf.name)}-${String(list[i]).padStart(pad, '0')}.${ext}`, data: await canvasToBlob(c, type, 0.9) });
          c.width = c.height = 0;
          await tick();
        }
        if (out.length === 1) { b.done(); return finishSave(root, out[0].data, out[0].name, reset); }
        b.update(1, 'Zipping…');
        const zip = await makeZip(out);
        b.done();
        await finishSave(root, zip, `${baseName(pdf.name)}-images.zip`, reset, `${out.length} images`);
      } catch (e) { b.done(); console.error(e); toast('Conversion failed: ' + e.message, 'err'); }
    }
    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
