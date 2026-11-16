import { h, dropzone, pageHead, toast, finishSave, baseName, field, seg } from '../ui.js';
import { icon } from '../icons.js';
import { fileToCanvas, canvasToBlob } from '../pdf.js';

const tool = {
  id: 'crop', group: 'image', icon: 'crop', name: 'Crop & rotate',
  desc: 'Crop, rotate and flip an image',
  long: 'Crop an image to any shape or a fixed ratio, rotate it and flip it.',
  accept: 'image/*', multiple: false,
  mount(root, { files }) {
    let src = null, file = null, view = null; // view = rotated/flipped canvas
    let rot = 0, flip = false;
    let box = null; // in view pixels {x,y,w,h}
    let ratio = 0;
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose an image', onFiles: fs => load(fs[0]) });
    const wrap = h('div', { class: 'crop-wrap' });
    const cbox = h('div', { class: 'crop-box' }, ...['nw', 'ne', 'sw', 'se'].map(k => h('i', { 'data-h': k })));
    const dims = h('span', { class: 'hint' });
    const ratioSeg = seg([['0', 'Free'], ['1', '1:1'], ['1.3333', '4:3'], ['1.7778', '16:9'], ['0.75', '3:4'], ['0.6667', '2:3']], '0', v => { ratio = +v; fitBox(); });
    const bar = h('div', { class: 'toolbar' },
      h('button', { class: 'btn sm', type: 'button', html: icon('rotl') + 'Rotate left', onclick: () => turn(-90) }),
      h('button', { class: 'btn sm', type: 'button', html: icon('rotr') + 'Rotate right', onclick: () => turn(90) }),
      h('button', { class: 'btn sm', type: 'button', html: icon('flip') + 'Flip', onclick: () => { flip = !flip; build(false); } }),
      h('span', { class: 'grow' }), dims);
    const work = h('div', { hidden: true }, field('Aspect ratio', ratioSeg), bar, wrap,
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: save }, 'Save image'),
        h('button', { class: 'btn', type: 'button', onclick: () => { box = null; fitBox(); } }, 'Reset crop'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another image')));
    root.append(zone, work);

    async function load(f) {
      try { src = await fileToCanvas(f); } catch (e) { return toast(e.message, 'err'); }
      file = f; rot = 0; flip = false; box = null;
      zone.hidden = true; work.hidden = false;
      build(true);
    }
    function turn(d) { rot = (rot + d + 360) % 360; build(true); }
    function build(resetBox) {
      const sw = rot % 180 ? src.height : src.width, sh = rot % 180 ? src.width : src.height;
      view = document.createElement('canvas'); view.width = sw; view.height = sh;
      const ctx = view.getContext('2d');
      ctx.translate(sw / 2, sh / 2); ctx.rotate(rot * Math.PI / 180); if (flip) ctx.scale(-1, 1);
      ctx.drawImage(src, -src.width / 2, -src.height / 2);
      wrap.replaceChildren(view, cbox);
      if (resetBox || !box) box = null;
      fitBox();
    }
    function fitBox() {
      if (!view) return;
      const W = view.width, H = view.height;
      if (!box) box = { x: 0, y: 0, w: W, h: H };
      if (ratio) {
        let w = box.w, hh = w / ratio;
        if (hh > H) { hh = H; w = hh * ratio; }
        if (w > W) { w = W; hh = w / ratio; }
        box = { x: Math.min(Math.max(0, box.x + (box.w - w) / 2), W - w), y: Math.min(Math.max(0, box.y + (box.h - hh) / 2), H - hh), w, h: hh };
      }
      paint();
    }
    function paint() {
      const k = view.clientWidth / view.width || 1;
      Object.assign(cbox.style, { left: box.x * k + 'px', top: box.y * k + 'px', width: box.w * k + 'px', height: box.h * k + 'px' });
      dims.textContent = `${Math.round(box.w)} × ${Math.round(box.h)} px`;
    }
    window.addEventListener('resize', onResize);
    function onResize() { if (view && !work.hidden) paint(); }

    cbox.addEventListener('pointerdown', e => {
      e.preventDefault(); try { cbox.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      const handle = e.target.dataset.h;
      const k = view.clientWidth / view.width;
      const s = { x: e.clientX, y: e.clientY, b: { ...box } };
      const W = view.width, H = view.height, MIN = 8;
      const mv = ev => {
        const dx = (ev.clientX - s.x) / k, dy = (ev.clientY - s.y) / k;
        let { x, y, w, h: hh } = s.b;
        if (!handle) { x = Math.min(Math.max(0, x + dx), W - w); y = Math.min(Math.max(0, y + dy), H - hh); }
        else {
          if (handle.includes('e')) w = Math.min(W - x, Math.max(MIN, w + dx));
          if (handle.includes('s')) hh = Math.min(H - y, Math.max(MIN, hh + dy));
          if (handle.includes('w')) { const nx = Math.min(x + w - MIN, Math.max(0, x + dx)); w += x - nx; x = nx; }
          if (handle.includes('n')) { const ny = Math.min(y + hh - MIN, Math.max(0, y + dy)); hh += y - ny; y = ny; }
          if (ratio) {
            const nh = w / ratio;
            if (handle.includes('n')) y = y + hh - nh;
            hh = nh;
            if (y < 0 || y + hh > H) { hh = handle.includes('n') ? s.b.y + s.b.h : H - y; hh = Math.max(MIN, Math.min(hh, H)); w = hh * ratio; if (handle.includes('n')) y = s.b.y + s.b.h - hh; if (handle.includes('w')) x = s.b.x + s.b.w - w; }
          }
        }
        box = { x, y, w, h: hh }; paint();
      };
      const up = () => { cbox.removeEventListener('pointermove', mv); cbox.removeEventListener('pointerup', up); };
      cbox.addEventListener('pointermove', mv); cbox.addEventListener('pointerup', up);
    });

    function reset() { src = view = null; file = null; zone.hidden = false; work.hidden = true; root.querySelector('.result')?.remove(); }
    async function save() {
      if (!box || !isFinite(box.w) || box.w < 1) { box = null; fitBox(); }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(box.w)); c.height = Math.max(1, Math.round(box.h));
      c.getContext('2d').drawImage(view, Math.round(box.x), Math.round(box.y), c.width, c.height, 0, 0, c.width, c.height);
      const isJpg = /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name);
      const isWebp = /webp/i.test(file.type);
      const ext = isJpg ? 'jpg' : isWebp ? 'webp' : 'png';
      const blob = await canvasToBlob(c, isJpg ? 'image/jpeg' : isWebp ? 'image/webp' : 'image/png', 0.92);
      await finishSave(root, blob, `${baseName(file.name)}-cropped.${ext}`, reset, `${c.width} × ${c.height} px`);
    }

    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]), destroy: () => window.removeEventListener('resize', onResize) };
  },
};
export default tool;
