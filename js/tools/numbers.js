import { PDFDocument, StandardFonts, rgb, degrees } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, tick, finishSave, baseName, fmtBytes, field, store, storeSet } from '../ui.js';
import { openPdf, renderThumb, pageGeom } from '../pdf.js';

const POS = [['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']];
const FORMATS = [['n', '1'], ['pn', 'Page 1'], ['nofm', '1 of 12'], ['pnofm', 'Page 1 of 12'], ['dash', '- 1 -']];

function label(fmt, n, total) {
  return { n: `${n}`, pn: `Page ${n}`, nofm: `${n} of ${total}`, pnofm: `Page ${n} of ${total}`, dash: `- ${n} -` }[fmt];
}

const tool = {
  id: 'numbers', group: 'pdf', icon: 'numbers', name: 'Page numbers',
  desc: 'Number the pages of a PDF',
  long: 'Add page numbers in the corner or centre of every page, in the style you choose.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    let pdf = null;
    const st = store('num', { pos: 'bc', fmt: 'n', size: 11, start: 1, skipFirst: false, margin: 28 });
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF', onFiles: fs => load(fs[0]) });
    const info = h('div', { class: 'file' });
    const pos = h('select', {}, ...POS.map(([v, l]) => h('option', { value: v, selected: v === st.pos }, l)));
    const fmt = h('select', {}, ...FORMATS.map(([v, l]) => h('option', { value: v, selected: v === st.fmt }, l)));
    const size = h('input', { type: 'number', min: '6', max: '48', value: String(st.size), style: { width: '90px' } });
    const start = h('input', { type: 'number', min: '0', value: String(st.start), style: { width: '90px' } });
    const margin = h('input', { type: 'number', min: '6', max: '120', value: String(st.margin), style: { width: '90px' } });
    const skip = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: st.skipFirst }), 'Don’t number the first page (cover)');
    const prevBox = h('div', { style: { marginTop: '14px' } });
    const panel = h('div', { class: 'panel', hidden: true }, info,
      h('div', { class: 'row', style: { marginTop: '16px' } }, field('Position', pos), field('Style', fmt), field('Size (pt)', size), field('Start at', start), field('Margin (pt)', margin)),
      h('div', { class: 'row', style: { marginTop: '12px' } }, skip),
      prevBox,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Add numbers and save'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another PDF')));
    root.append(zone, panel);
    [pos, fmt, size, start, margin, skip.firstChild].forEach(el => el.addEventListener('input', drawPreview));
    let baseThumb = null;

    const opts = () => {
      const o = { pos: pos.value, fmt: fmt.value, size: Math.max(6, Math.min(48, +size.value || 11)), start: Math.max(0, Math.floor(+start.value || 0)), margin: Math.max(6, Math.min(120, +margin.value || 28)), skipFirst: skip.firstChild.checked };
      storeSet('num', o); return o;
    };
    // display-space baseline start for a label of width w
    function spot(W, H, o, w) {
      const x = o.pos[1] === 'l' ? o.margin : o.pos[1] === 'r' ? W - o.margin - w : (W - w) / 2;
      const y = o.pos[0] === 't' ? o.margin + o.size * 0.72 : H - o.margin;
      return [x, y];
    }

    async function load(file) {
      try { pdf = await openPdf(file); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      info.replaceChildren(h('div', { class: 'thumb' }, await renderThumb(pdf.view, 1, 38, 50)), h('div', { class: 'meta' }, h('b', {}, pdf.name), h('span', {}, `${pdf.pageCount} pages · ${fmtBytes(pdf.size)}`)));
      const pi = pdf.pageCount > 1 ? 2 : 1;
      baseThumb = { c: await renderThumb(pdf.view, pi, 260, 330), i: pi };
      zone.hidden = true; panel.hidden = false; drawPreview();
    }
    function drawPreview() {
      if (!baseThumb) return;
      const o = opts();
      const g = pageGeom(pdf.lib.getPage(baseThumb.i - 1));
      const src = baseThumb.c;
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      c.style.width = src.style.width; c.style.height = src.style.height; c.style.boxShadow = '0 1px 6px rgba(0,0,0,.2)';
      const ctx = c.getContext('2d'); ctx.drawImage(src, 0, 0);
      const k = c.width / g.W;
      const n = baseThumb.i - (o.skipFirst ? 1 : 0) - 1 + o.start;
      const show = !(o.skipFirst && baseThumb.i === 1);
      if (show) {
        const t = label(o.fmt, n, pdf.pageCount - (o.skipFirst ? 1 : 0) + o.start - 1);
        ctx.font = `${o.size * k}px Helvetica, Arial, sans-serif`;
        const w = ctx.measureText(t).width / k;
        const [x, y] = spot(g.W, g.H, o, w);
        ctx.fillStyle = '#222'; ctx.fillText(t, x * k, y * k);
      }
      prevBox.replaceChildren(c, h('div', { class: 'hint', style: { marginTop: '6px' } }, `Preview of page ${baseThumb.i}`));
    }
    function reset() { pdf = null; baseThumb = null; zone.hidden = false; panel.hidden = true; root.querySelector('.result')?.remove(); }

    async function run() {
      const o = opts();
      const b = busy('Numbering pages…');
      try {
        const doc = await PDFDocument.load(pdf.bytes, { password: pdf.password, updateMetadata: false });
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const pgs = doc.getPages();
        const total = pgs.length - (o.skipFirst ? 1 : 0) + o.start - 1;
        for (let i = 0; i < pgs.length; i++) {
          if (o.skipFirst && i === 0) continue;
          const n = i - (o.skipFirst ? 1 : 0) + o.start;
          const t = label(o.fmt, n, total);
          const page = pgs[i], g = pageGeom(page);
          const w = font.widthOfTextAtSize(t, o.size);
          const [dx, dy] = spot(g.W, g.H, o, w);
          const [x, y] = g.toPdf(dx, dy);
          page.drawText(t, { x, y, size: o.size, font, color: rgb(0.13, 0.13, 0.13), rotate: degrees(g.rot) });
          if (i % 25 === 0) { b.update(i / pgs.length); await tick(); }
        }
        if (pdf.encrypted) doc.encrypt({ userPassword: pdf.password, ownerPassword: pdf.password });
        const out = await doc.save({ useObjectStreams: true });
        b.done();
        await finishSave(root, out, baseName(pdf.name) + '-numbered.pdf', reset);
      } catch (e) { b.done(); console.error(e); toast('Couldn’t number pages: ' + e.message, 'err'); }
    }

    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
