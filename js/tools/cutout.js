import { h, dropzone, pageHead, toast, finishSave, baseName, field, seg } from '../ui.js';
import { fileToCanvas, canvasToBlob } from '../pdf.js';
import { knockOutWhite, trimCanvas, saveSig } from '../sigpad.js';

const tool = {
  id: 'cutout', group: 'image', icon: 'eraser', name: 'Clean up signature',
  desc: 'Remove the paper background from a signature, stamp or logo',
  long: 'Take a photo or scan of a signature, stamp or logo on white paper and remove the background, leaving clean ink on transparency.',
  accept: 'image/*', multiple: false,
  mount(root, { files }) {
    let src = null, file = null, result = null;
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a photo or scan', hint: 'Works best with dark ink on light paper', onFiles: fs => load(fs[0]) });
    const thr = h('input', { type: 'range', min: '110', max: '248', value: '195' });
    const ink = seg([['', 'Original'], ['#111111', 'Black'], ['#1d3fbf', 'Blue']], '', process);
    const trim = h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: true }), 'Trim empty edges');
    const before = h('figure', {}, h('div', {}), h('figcaption', {}, 'Original'));
    const after = h('figure', {}, h('div', { class: 'checker', style: { padding: '8px' } }), h('figcaption', {}, 'Cleaned (transparent background)'));
    const work = h('div', { class: 'panel', hidden: true },
      h('div', { class: 'row' }, field('Background removal', thr, 'Raise it if paper shows; lower it if ink fades'), field('Ink colour', ink), trim),
      h('div', { class: 'compare' }, before, after),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: save }, 'Save PNG'),
        h('button', { class: 'btn', type: 'button', onclick: addToSigs }, 'Add to my signatures'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another image')));
    root.append(zone, work);
    thr.addEventListener('input', process); trim.firstChild.addEventListener('change', process);

    async function load(f) {
      try { src = await fileToCanvas(f); } catch (e) { return toast(e.message, 'err'); }
      file = f;
      // keep work fast: cap at 2400px
      const s = Math.min(1, 2400 / Math.max(src.width, src.height));
      if (s < 1) { const c = document.createElement('canvas'); c.width = Math.round(src.width * s); c.height = Math.round(src.height * s); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); src = c; }
      const show = document.createElement('canvas'); show.width = src.width; show.height = src.height; show.getContext('2d').drawImage(src, 0, 0);
      before.firstChild.replaceChildren(show);
      zone.hidden = true; work.hidden = false; process();
    }
    function process() {
      if (!src) return;
      const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      knockOutWhite(c, +thr.value, ink.value || undefined);
      result = trim.firstChild.checked ? (trimCanvas(c, 6) || c) : c;
      after.firstChild.replaceChildren(result);
    }
    function reset() { src = result = null; zone.hidden = false; work.hidden = true; root.querySelector('.result')?.remove(); }
    async function save() { if (result) await finishSave(root, await canvasToBlob(result, 'image/png'), `${baseName(file.name)}-clean.png`, reset, `${result.width} × ${result.height} px`); }
    function addToSigs() {
      if (!result) return;
      const s = Math.min(1, 900 / result.width);
      const c = document.createElement('canvas'); c.width = Math.round(result.width * s); c.height = Math.round(result.height * s);
      c.getContext('2d').drawImage(result, 0, 0, c.width, c.height);
      saveSig(c.toDataURL('image/png'));
      toast('Added. It’s ready to use in Sign & fill.');
    }
    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
