import { h } from './ui.js';
import { supportBox, tips } from './support.js';

export function about(name) {
  return h('div', { class: 'page about' },
    h('h1', {}, `About ${name}`),
    h('p', {}, `${name} is a free PDF and image toolbox for Windows. Version 1.1.0.`),
    h('h2', {}, 'Privacy'),
    h('p', {}, `Your files never leave your device. ${name} does all of its work inside the app on your PC: nothing you open is uploaded, stored on a server, or seen by anyone else.`),
    h('ul', {},
      h('li', {}, 'No account, no sign-in.'),
      h('li', {}, 'No analytics, no ads, no tracking.'),
      h('li', {}, 'Saved signatures and your settings are kept only on this device. You can forget a saved signature by right-clicking it in Sign & fill.'),
      h('li', {}, 'After the first launch the app works with no internet connection.')),
    h('p', {}, h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'Read the full privacy policy')),
    tips.ready ? [
      h('h2', {}, `Support ${name}`),
      h('p', {}, `${name} is free, with no ads and nothing locked. It's made by one developer. If it saves you time, you can say thanks with a small tip. It's completely optional, and payment goes through the Microsoft Store.`),
      supportBox()] : null,
    h('h2', {}, 'Keyboard shortcuts'),
    h('ul', {},
      h('li', {}, h('span', { class: 'kbd' }, 'Ctrl'), ' + ', h('span', { class: 'kbd' }, 'V'), ' paste an image or PDF to open it'),
      h('li', {}, h('span', { class: 'kbd' }, 'Delete'), ' remove the selected page or item'),
      h('li', {}, h('span', { class: 'kbd' }, 'Ctrl'), ' + ', h('span', { class: 'kbd' }, 'A'), ' select all pages (Organize pages)'),
      h('li', {}, 'Arrow keys nudge a selected signature or text; hold ', h('span', { class: 'kbd' }, 'Shift'), ' for bigger steps'),
      h('li', {}, h('span', { class: 'kbd' }, 'Esc'), ' cancel placing or deselect')),
    h('h2', {}, 'Credits'),
    h('p', {}, 'Built with pdf-lib (MIT), PDF.js (Apache 2.0) and JSZip (MIT). Signature fonts: Great Vibes, Dancing Script and Caveat (SIL Open Font License).'),
    h('p', {}, '© 2026 LumioLab'));
}
