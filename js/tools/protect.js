import { PDFDocument } from '../../vendor/pdf-lib.esm.min.js';
import { h, dropzone, pageHead, toast, busy, finishSave, baseName, fmtBytes, field } from '../ui.js';
import { openPdf, renderThumb } from '../pdf.js';

function randomPw() {
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a));
}

const tool = {
  id: 'protect', group: 'pdf', icon: 'lock', name: 'Protect PDF',
  desc: 'Add a password (AES-256)',
  long: 'Lock a PDF with a password using strong AES-256 encryption. Optionally block printing, copying or editing.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    let pdf = null;
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a PDF', onFiles: fs => load(fs[0]) });
    const info = h('div', { class: 'file' });
    const pw = h('input', { type: 'password', autocomplete: 'new-password', style: { width: '240px' } });
    const pw2 = h('input', { type: 'password', autocomplete: 'new-password', style: { width: '240px' } });
    const show = h('label', { class: 'check' }, h('input', { type: 'checkbox' }), 'Show');
    show.firstChild.addEventListener('change', () => { pw.type = pw2.type = show.firstChild.checked ? 'text' : 'password'; });
    const chk = (label, on = true) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on }), label);
    const allowPrint = chk('Allow printing'), allowCopy = chk('Allow copying text'), allowEdit = chk('Allow editing and filling forms');
    const meter = h('small', {});
    const panel = h('div', { class: 'panel', hidden: true }, info,
      h('div', { class: 'row', style: { marginTop: '16px' } }, field('Password', pw), field('Repeat password', pw2), show),
      meter,
      h('h2', { style: { marginTop: '18px' } }, 'Permissions'),
      h('div', { class: 'row', style: { gap: '20px' } }, allowPrint, allowCopy, allowEdit),
      h('div', { class: 'note warn' }, 'Keep your password somewhere safe. If you forget it, nobody can open this PDF, including us.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary big', type: 'button', onclick: run }, 'Protect and save'),
        h('button', { class: 'btn', type: 'button', onclick: reset }, 'Choose another PDF')));
    root.append(zone, panel);
    pw.addEventListener('input', () => {
      const v = pw.value; let s = 0;
      if (v.length >= 8) s++; if (v.length >= 12) s++; if (/[A-Z]/.test(v) && /[a-z]/.test(v)) s++; if (/\d/.test(v)) s++; if (/[^A-Za-z0-9]/.test(v)) s++;
      meter.textContent = v ? 'Strength: ' + ['very weak', 'weak', 'fair', 'good', 'strong', 'very strong'][s] : '';
      meter.style.color = s < 2 ? 'var(--err)' : s < 4 ? 'var(--warn)' : 'var(--ok)';
    });

    async function load(file) {
      try { pdf = await openPdf(file); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      info.replaceChildren(h('div', { class: 'thumb' }, await renderThumb(pdf.view, 1, 38, 50)),
        h('div', { class: 'meta' }, h('b', {}, pdf.name), h('span', {}, `${pdf.pageCount} pages · ${fmtBytes(pdf.size)}${pdf.encrypted ? ' · already protected: the new password replaces the old one' : ''}`)));
      zone.hidden = true; panel.hidden = false; pw.focus();
    }
    function reset() { pdf = null; pw.value = pw2.value = ''; meter.textContent = ''; zone.hidden = false; panel.hidden = true; root.querySelector('.result')?.remove(); }

    async function run() {
      if (!pw.value) return toast('Enter a password.', 'err');
      if (pw.value !== pw2.value) return toast('The two passwords don’t match.', 'err');
      const b = busy('Encrypting…');
      try {
        const doc = await PDFDocument.load(pdf.bytes, { password: pdf.password, updateMetadata: false });
        const restricted = !allowPrint.firstChild.checked || !allowCopy.firstChild.checked || !allowEdit.firstChild.checked;
        const edit = allowEdit.firstChild.checked;
        doc.encrypt({
          userPassword: pw.value,
          ownerPassword: restricted ? randomPw() : pw.value,
          permissions: {
            printing: allowPrint.firstChild.checked ? 'highResolution' : false,
            copying: allowCopy.firstChild.checked, contentAccessibility: true,
            modifying: edit, annotating: edit, fillingForms: edit, documentAssembly: edit,
          },
        });
        const out = await doc.save({ useObjectStreams: true });
        b.done();
        await finishSave(root, out, baseName(pdf.name) + '-protected.pdf', reset, 'AES-256');
      } catch (e) { b.done(); console.error(e); toast('Couldn’t protect: ' + e.message, 'err'); }
    }

    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
