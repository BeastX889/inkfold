import { h, dropzone, pageHead, toast, busy, finishSave, baseName, fmtBytes } from '../ui.js';
import { openPdf } from '../pdf.js';

const tool = {
  id: 'unlock', group: 'pdf', icon: 'unlock', name: 'Remove password',
  desc: 'Save a copy without its password',
  long: 'Remove the password from a PDF you can open, so you don’t have to type it every time. You need the current password.',
  accept: '.pdf,application/pdf', multiple: false,
  mount(root, { files }) {
    root.append(pageHead(tool));
    const zone = dropzone({ accept: tool.accept, title: 'Choose a protected PDF', onFiles: fs => load(fs[0]) });
    root.append(zone, h('p', { class: 'hint', style: { marginTop: '12px' } }, 'This only works when you know the password. It doesn’t crack or guess passwords.'));

    async function load(file) {
      let pdf;
      try { pdf = await openPdf(file, { needView: false }); } catch (e) { return toast(e.message, 'err'); }
      if (!pdf) return;
      if (!pdf.encrypted) return toast(`"${pdf.name}" doesn’t have a password.`, 'err');
      const b = busy('Removing password…');
      try {
        const out = await pdf.lib.save({ useObjectStreams: true });
        b.done();
        await finishSave(root, out, baseName(pdf.name) + '-unlocked.pdf', null, `${pdf.pageCount} pages · was ${fmtBytes(pdf.size)}`);
      } catch (e) { b.done(); console.error(e); toast('Couldn’t unlock: ' + e.message, 'err'); }
    }
    if (files?.length) load(files[0]);
    return { onFiles: fs => load(fs[0]) };
  },
};
export default tool;
