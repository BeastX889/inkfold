// The tools run only inside the installed app window (the Microsoft Store install).
// Opened in an ordinary browser tab, the site shows a small "Get it from the Microsoft Store" page.
// The check is local (display mode), so it works offline and can never lock out the Store app.
import { h } from './ui.js';

export function isAppWindow() {
  const q = new URLSearchParams(location.search);
  if (q.has('web')) return false;                                  // preview the landing page locally
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return true;
  return ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen']
    .some(m => matchMedia(`(display-mode: ${m})`).matches);
}

/** Replaces the page with the Store landing. features: [[title, text], ...] */
export function showLanding({ name, tagline, blurb, features, storeUrl, icon }) {
  document.title = `${name} – ${tagline}`;
  const cta = storeUrl
    ? h('a', { class: 'btn primary big store-cta', href: storeUrl, target: '_blank', rel: 'noopener' }, 'Get it from the Microsoft Store')
    : h('span', { class: 'btn big store-cta', 'aria-disabled': 'true' }, 'Coming soon to the Microsoft Store');
  const page = h('main', { class: 'landing' },
    h('div', { class: 'landing-card' },
      h('img', { src: icon, alt: '', width: 72, height: 72, class: 'landing-icon' }),
      h('h1', {}, name),
      h('p', { class: 'landing-tag' }, tagline),
      h('p', {}, blurb),
      cta,
      h('p', { class: 'hint' }, 'Free for Windows 10 and 11. No account, no ads, works offline.'),
      h('div', { class: 'landing-feats' }, features.map(([t, d]) => h('div', {}, h('b', {}, t), h('span', {}, d)))),
      h('p', { class: 'hint' }, h('a', { href: 'privacy.html' }, 'Privacy policy'), ' · © 2026 LumioLab')));
  document.body.replaceChildren(page);
}
