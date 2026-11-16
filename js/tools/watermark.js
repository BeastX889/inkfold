import { PDFDocument, StandardFonts, rgb, degrees } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, tick, finishSave, baseName, fmtBytes, field, seg, store, storeSet } from '../ui.js';
import { openPdf, renderThumb, pageGeom, hexToRgb01, parseRanges } from '../pdf.js';

const tool = {
  id: 'watermark', group: 'pdf', icon: 'watermark', name: 'Watermark',
  desc: 'Stamp text like CONFIDENTIAL or DRAFT',
  long: 'Stamp text such as CONFIDENTIAL, DRAFT or COPY across your pages.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    let pdf = null;
    const st = store('wm', { text: 'CONFIDENTIAL', size: 64, opacity: 25, color: '#c9324a', layout: 'diagonal', pages: '' });
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF', onFiles: fs => load(fs[0]) });
    const info = h('div', { class: 'file' });
    const text = h('input', { type: 'text', value: st.text, style: { width: '260px' } });
    const size = h('input', { type: 'number', min: '8', max: '200', value: String(st.size), style: { width: '90px' } });
    const op = h('input', { type: 'range', min: '5', max: '100', value: String(st.opacity) });
    const col = h('input', { type: 'color', value: st.color });
    const layout = seg([['diagonal', 'Diagonal'], ['center', 'Centre'], ['tiled', 'Tiled'], ['top', 'Top'], ['bottom', 'Bottom']], st.layout, () => drawPreview());
    const pages = h('input', { type: 'text', value: st.pages, placeholder: 'All pages', style: { width: '160px' } });
    const prevBox = h('div', { style: { position: 'relative', display: 'inline-block', marginTop: '14px' } });
    const panel = h('div', { class: 'panel', hidden: true }, info,
      h('div', { class: 'row', style: { marginTop: '16px' } }, field('Text', text), field('Size (pt)', size), field('Opacity', op), field('Colour', col)),
      h('div', { class: 'row', style: { marginTop: '14px' } }, field('Layout', layout), field('Pages', pages, 'e.g. 1-3, 7. Leave empty for all.')),
      prevBox,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Add watermark and save'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another PDF')));
    root.append(zone, panel);
    [text, size, op, col, pages].forEach(el => el.addEventListener('input', drawPreview));
    let baseThumb = null;

    function opts() {
      const o = { text: text.value || ' ', size: Math.max(8, Math.min(200, +size.value || 48)), opacity: +op.value, color: col.value, layout: layout.value, pages: pages.value.trim() };
      storeSet('wm', o); return o;
    }
    // Shared layout so the preview matches the PDF exactly. Returns stamps in display coords.
    function stamps(W, H, o, measure) {
      const tw = measure(o.text, o.size), th = o.size * 0.72;
      const out = [];
      if (o.layout === 'diagonal') {
        const ang = Math.atan2(H, W) * 180 / Math.PI;
        let s = o.size; let w = tw;
        const diag = Math.hypot(W, H) * 0.8;
        if (w > diag) { s = s * diag / w; w = diag; }
        out.push({ cx: W / 2, cy: H / 2, ang, size: s, w });
      } else if (o.layout === 'center') out.push({ cx: W / 2, cy: H / 2, ang: 0, size: o.size, w: tw });
      else if (o.layout === 'top') out.push({ cx: W / 2, cy: 24 + th / 2, ang: 0, size: o.size, w: tw });
      else if (o.layout === 'bottom') out.push({ cx: W / 2, cy: H - 24 - th / 2, ang: 0, size: o.size, w: tw });
      else {
        const gx = tw + o.size * 2, gy = o.size * 3.2;
        for (let y = gy / 2, r = 0; y < H + gy; y += gy, r++) for (let x = (r % 2 ? gx / 2 : 0); x < W + gx; x += gx) out.push({ cx: x, cy: y, ang: 30, size: o.size, w: tw });
      }
      return out;
    }

    async function load(file) {
      try { pdf = await openPdf(file); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      info.replaceChildren(h('div', { class: 'thumb' }, await renderThumb(pdf.view, 1, 38, 50)), h('div', { class: 'meta' }, h('b', {}, pdf.name), h('span', {}, `${pdf.pageCount} pages · ${fmtBytes(pdf.size)}`)));
      baseThumb = await renderThumb(pdf.view, 1, 300, 380);
      zone.hidden = true; panel.hidden = false; drawPreview();
    }

    function drawPreview() {
      if (!pdf || !baseThumb) return;
      const o = opts();
      const page = pdf.lib.getPage(0);
      const g = pageGeom(page);
      const c = document.createElement('canvas');
      c.width = baseThumb.width; c.height = baseThumb.height;
      c.style.width = baseThumb.style.width; c.style.height = baseThumb.style.height;
      c.style.boxShadow = '0 1px 6px rgba(0,0,0,.2)';
      const ctx = c.getContext('2d');
      ctx.drawImage(baseThumb, 0, 0);
      const k = c.width / g.W;
      const measure = (t, s) => { ctx.font = `bold ${s}px Helvetica, Arial, sans-serif`; return ctx.measureText(t).width; };
      ctx.fillStyle = o.color; ctx.globalAlpha = o.opacity / 100; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const s of stamps(g.W, g.H, o, measure)) {
        ctx.save(); ctx.translate(s.cx * k, s.cy * k); ctx.rotate(-s.ang * Math.PI / 180);
        ctx.font = `bold ${s.size * k}px Helvetica, Arial, sans-serif`;
        ctx.fillText(o.text, 0, 0); ctx.restore();
      }
      prevBox.replaceChildren(c, h('div', { class: 'hint', style: { marginTop: '6px' } }, 'Preview of page 1'));
    }

    function reset() { pdf = null; baseThumb = null; zone.hidden = false; panel.hidden = true; root.querySelector('.result')?.remove(); }

    async function run() {
      const o = opts();
      let which;
      try { which = o.pages ? new Set(parseRanges(o.pages, pdf.pageCount).flat()) : null; } catch (e) { return toast(e.message, 'err'); }
      const b = busy('Adding watermark…');
      try {
        const doc = await PDFDocument.load(pdf.bytes, { password: pdf.password, updateMetadata: false });
        const font = await doc.embedFont(StandardFonts.HelveticaBold);
        let txt = o.text;
        try { font.encodeText(txt); } catch { txt = txt.replace(/[^\x20-\x7E]/g, '?'); toast('Some characters can’t be used in a watermark and were replaced.', 'err'); }
        const [r, gg, bb] = hexToRgb01(o.color);
        const measure = (t, s) => font.widthOfTextAtSize(t, s);
        const pgs = doc.getPages();
        for (let i = 0; i < pgs.length; i++) {
          if (which && !which.has(i + 1)) continue;
          const page = pgs[i], g = pageGeom(page);
          for (const s of stamps(g.W, g.H, { ...o, text: txt }, measure)) {
            // start point of the baseline, centred on (cx, cy), in display coords
            // text runs along u=(cos a, -sin a); "up" is v=(-sin a, -cos a); start = c - u*w/2 - v*cap/2
            const a = s.ang * Math.PI / 180, w = font.widthOfTextAtSize(txt, s.size), cap = s.size * 0.72;
            const dx = s.cx - Math.cos(a) * w / 2 + Math.sin(a) * cap / 2;
            const dy = s.cy + Math.sin(a) * w / 2 + Math.cos(a) * cap / 2;
            const [x, y] = g.toPdf(dx, dy);
            page.drawText(txt, { x, y, size: s.size, font, color: rgb(r, gg, bb), opacity: o.opacity / 100, rotate: degrees(s.ang + g.rot) });
          }
          if (i % 10 === 0) { b.update(i / pgs.length); await tick(); }
        }
        if (pdf.encrypted) doc.encrypt({ userPassword: pdf.password, ownerPassword: pdf.password });
        const out = await doc.save({ useObjectStreams: true });
        b.done();
        await finishSave(root, out, baseName(pdf.name) + '-watermarked.pdf', reset);
      } catch (e) { b.done(); console.error(e); toast('Couldn’t add watermark: ' + e.message, 'err'); }
    }

    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
