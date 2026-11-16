import { PDFDocument, degrees } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, tick, sortable, move, finishSave, baseName } from '../ui.js';
import { icon } from '../icons.js';
import { openPdf, renderThumb } from '../pdf.js';

const COLORS = ['#4f46e5', '#0f8a5f', '#c2410c', '#be185d', '#0369a1', '#7c3aed'];

const tool = {
  id: 'organize', group: 'pdf', icon: 'organize', name: 'Organize pages',
  desc: 'Reorder, rotate, delete or extract pages',
  long: 'Drag pages into a new order, rotate or delete them, pull pages out into a new PDF, or add pages from another PDF.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    const sources = [];   // openPdf results
    let pages = [];       // { src, idx, rot, sel, el }
    let lastClicked = -1;
    let gen = 0;          // cancels background thumbnail rendering on reset
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF', onFiles: fs => load(fs[0]) });
    const grid = h('div', { class: 'pages' });
    const count = h('span', { class: 'hint' });
    const selBtns = [];
    const mk = (label, ic, fn, extra = '') => { const b = h('button', { class: 'btn sm ' + extra, type: 'button', onclick: fn, html: icon(ic) + label }); return b; };
    const bar = h('div', { class: 'toolbar', hidden: true },
      mk('Select all', 'select', () => selectAll(true)),
      mk('Rotate left', 'rotl', () => rotateSel(-90)),
      mk('Rotate right', 'rotr', () => rotateSel(90)),
      mk('Delete', 'trash', () => deleteSel(), 'danger'),
      mk('Extract to new PDF', 'pdf2img', () => save(true)),
      h('span', { class: 'grow' }), count);
    selBtns.push(...[...bar.querySelectorAll('button')].slice(1, 5));
    const addPdf = dropzone({ accept: tool.accept, title: 'Add pages from another PDF', compact: true, onFiles: fs => load(fs[0], true) });
    const saveBtn = h('button', { class: 'btn primary big', type: 'button', onclick: () => save(false) }, 'Save PDF');
    const actions = h('div', { class: 'actions', hidden: true }, saveBtn,
      h('button', { class: 'btn', type: 'button', onclick: reset }, 'Start over'),
      h('span', { class: 'hint' }, 'Tip: click to select, Shift+click for a range, Delete key removes selected pages.'));
    addPdf.hidden = true;
    root.append(zone, bar, grid, addPdf, actions);
    sortable(grid, '.pg', (a, b) => { move(pages, a, b); layout(); }, { horizontal: true });

    async function load(file, append = false) {
      let pdf;
      try { pdf = await openPdf(file); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      if (!append) { reset(); }
      const src = sources.push(pdf) - 1;
      for (let i = 0; i < pdf.pageCount; i++) pages.push({ src, idx: i, rot: 0, sel: false, el: null });
      zone.hidden = true; bar.hidden = false; addPdf.hidden = false; actions.hidden = false;
      layout();
      renderAll();
      if (append) toast(`Added ${pdf.pageCount} page${pdf.pageCount > 1 ? 's' : ''} from ${pdf.name}`);
    }

    function card(p) {
      const cv = h('div', { class: 'cv' });
      const el = h('div', { class: 'pg', draggable: 'true', tabindex: '0' },
        h('span', { class: 'tick', html: icon('check') }),
        h('div', { class: 'tools' },
          h('button', { type: 'button', title: 'Rotate left', 'aria-label': 'Rotate left', html: icon('rotl'), onclick: e => { e.stopPropagation(); rotate(p, -90); } }),
          h('button', { type: 'button', title: 'Rotate right', 'aria-label': 'Rotate right', html: icon('rotr'), onclick: e => { e.stopPropagation(); rotate(p, 90); } }),
          h('button', { type: 'button', title: 'Delete page', 'aria-label': 'Delete page', html: icon('trash'), onclick: e => { e.stopPropagation(); pages = pages.filter(x => x !== p); layout(); } })),
        cv,
        sources.length > 1 ? h('span', { class: 'src', style: { background: COLORS[p.src % COLORS.length] } }, String.fromCharCode(65 + p.src)) : null,
        h('div', { class: 'lbl' }, h('span', { class: 'n' }), h('span', {}, p.rot ? `${(p.rot % 360 + 360) % 360}°` : '')));
      el.addEventListener('click', e => toggle(p, e.shiftKey));
      el.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(p, e.shiftKey); } });
      p.el = el; p.cv = cv;
      return el;
    }

    function layout() {
      grid.innerHTML = '';
      pages.forEach((p, i) => {
        const el = p.el && p.el.dataset.multi === String(sources.length > 1) ? p.el : card(p);
        el.dataset.multi = String(sources.length > 1);
        if (p.thumb && !p.cv.firstChild) p.cv.append(p.thumb);
        el.classList.toggle('sel', p.sel);
        el.querySelector('.n').textContent = 'Page ' + (i + 1);
        el.querySelector('.lbl').lastChild.textContent = p.rot % 360 ? `${(p.rot % 360 + 360) % 360}\u00b0` : '';
        el.setAttribute('aria-label', `Page ${i + 1}${p.sel ? ', selected' : ''}`);
        grid.append(el);
      });
      const n = pages.filter(p => p.sel).length;
      count.textContent = `${pages.length} page${pages.length === 1 ? '' : 's'}${n ? ` · ${n} selected` : ''}`;
      selBtns.forEach(b => b.disabled = !n);
      saveBtn.disabled = !pages.length;
      root.querySelector('.result')?.remove();
    }

    async function renderAll() {
      const my = ++gen;
      for (const p of pages) {
        if (my !== gen) return;
        if (p.thumb) continue;
        try {
          p.thumb = await renderThumb(sources[p.src].view, p.idx + 1, 130, 170, ((p.rot % 360) + 360) % 360);
          p.cv?.replaceChildren(p.thumb);
        } catch (e) { console.warn(e); }
        await tick();
      }
    }

    async function rotate(p, d) {
      p.rot += d;
      p.thumb = await renderThumb(sources[p.src].view, p.idx + 1, 130, 170, ((p.rot % 360) + 360) % 360);
      p.cv.replaceChildren(p.thumb);
      layout();
    }
    async function rotateSel(d) { for (const p of pages.filter(p => p.sel)) await rotate(p, d); }
    function deleteSel() {
      const n = pages.filter(p => p.sel).length;
      if (n === pages.length) return toast('You can’t delete every page. Keep at least one.', 'err');
      pages = pages.filter(p => !p.sel); layout();
    }
    function toggle(p, range) {
      const i = pages.indexOf(p);
      if (range && lastClicked >= 0) {
        const [a, b] = [Math.min(i, lastClicked), Math.max(i, lastClicked)];
        for (let k = a; k <= b; k++) pages[k].sel = true;
      } else p.sel = !p.sel;
      lastClicked = i; layout();
    }
    function selectAll(v) { const all = pages.every(p => p.sel); pages.forEach(p => p.sel = all ? false : v); layout(); }

    function onKey(e) {
      if (!pages.length || e.target.closest?.('input,textarea,dialog')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { if (pages.some(p => p.sel)) { e.preventDefault(); deleteSel(); } }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); pages.forEach(p => p.sel = true); layout(); }
      if (e.key === 'Escape') { pages.forEach(p => p.sel = false); layout(); }
    }
    document.addEventListener('keydown', onKey);

    function reset() {
      gen++; sources.length = 0; pages = []; lastClicked = -1;
      grid.innerHTML = ''; zone.hidden = false; bar.hidden = true; addPdf.hidden = true; actions.hidden = true;
      root.querySelector('.result')?.remove();
    }

    async function save(onlySelected) {
      const list = onlySelected ? pages.filter(p => p.sel) : pages;
      if (!list.length) return toast('Select some pages first.', 'err');
      const b = busy('Building PDF…');
      try {
        const out = await PDFDocument.create();
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          const [pg] = await out.copyPages(sources[p.src].lib, [p.idx]);
          const cur = pg.getRotation().angle || 0;
          if (p.rot) pg.setRotation(degrees((((cur + p.rot) % 360) + 360) % 360));
          out.addPage(pg);
          if (i % 20 === 0) { b.update(i / list.length); await tick(); }
        }
        const bytes = await out.save({ useObjectStreams: true });
        b.done();
        const name = baseName(sources[0].name) + (onlySelected ? '-extract' : '-organized') + '.pdf';
        await finishSave(root, bytes, name, null, `${list.length} page${list.length > 1 ? 's' : ''}`);
      } catch (e) { b.done(); console.error(e); toast('Couldn’t save: ' + e.message, 'err'); }
    }

    if (files?.length) load(files[0]);
    return {
      onFiles: fs => load(fs[0], pages.length > 0),
      destroy: () => { gen++; document.removeEventListener('keydown', onKey); },
    };
  },
};
export default tool;
