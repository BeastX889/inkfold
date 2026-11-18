// Offline cache: every app file is cached on install, then served cache-first.
const VERSION = 'inkfold-v1.1.0';
const FILES = [
  './', 'index.html', 'privacy.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/ui.js', 'js/icons.js', 'js/pdf.js', 'js/sigpad.js', 'js/about.js', 'js/support.js', 'js/gate.js',
  'js/tools/merge.js', 'js/tools/organize.js', 'js/tools/split.js', 'js/tools/sign.js', 'js/tools/compress.js',
  'js/tools/protect.js', 'js/tools/unlock.js', 'js/tools/watermark.js', 'js/tools/numbers.js',
  'js/tools/img2pdf.js', 'js/tools/pdf2img.js', 'js/tools/imgconvert.js', 'js/tools/crop.js', 'js/tools/cutout.js',
  'vendor/pdf-lib.esm.min.js', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/jszip.min.js',
  'fonts/caveat.woff2', 'fonts/dancing.woff2', 'fonts/greatvibes.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate' ? caches.match('index.html') : Response.error()))
  );
});
