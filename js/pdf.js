// PDF loading/rendering helpers wrapping pdf-lib (edit) and pdf.js (render).
import * as pdfjsLib from '../vendor/pdf.min.mjs';
import { PDFDocument } from '../vendor/pdf-lib.esm.min.js';
import { askPassword, readBytes } from './ui.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
export { pdfjsLib };

/**
 * Load a PDF file for both editing and rendering. Asks for a password if needed.
 * Returns { name, size, bytes, password, lib, view, pageCount } or null if cancelled.
 */
export async function openPdf(file, { needView = true, needLib = true } = {}) {
  const bytes = file instanceof Blob ? await readBytes(file) : file.bytes;
  let password;
  let lib = null;
  // Find out whether it is encrypted, and get the password if so.
  try {
    const probe = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    if (probe.isEncrypted) {
      let wrong = false;
      for (;;) {
        password = await askPassword(file.name, wrong);
        if (password == null) return null;
        try { lib = await PDFDocument.load(bytes, { password, updateMetadata: false }); break; }
        catch { wrong = true; }
      }
    } else lib = needLib ? await PDFDocument.load(bytes, { updateMetadata: false }) : probe;
  } catch (e) {
    console.warn(e);
    throw new Error(`"${file.name}" isn’t a readable PDF.`);
  }
  let view = null;
  if (needView) view = await pdfjsLib.getDocument({ data: bytes.slice(), password, isEvalSupported: false }).promise;
  return { name: file.name, size: bytes.length, bytes, password, lib, view, pageCount: lib.getPageCount(), encrypted: password != null };
}

export async function openView(bytes, password) {
  return pdfjsLib.getDocument({ data: bytes.slice(), password, isEvalSupported: false }).promise;
}

/** pdf.js waits for animation frames when rendering for display. A hidden or minimised window
 *  gets none, which would stall rendering, so check (cached for 1s) and fall back to the
 *  frame-free 'print' intent when frames aren't arriving. */
let rafCheck = { at: 0, ok: true };
async function framesArriving() {
  const now = performance.now();
  if (now - rafCheck.at < 1000) return rafCheck.ok;
  const ok = document.visibilityState === 'visible' &&
    await Promise.race([new Promise(r => requestAnimationFrame(() => r(true))), new Promise(r => setTimeout(() => r(false), 120))]);
  rafCheck = { at: performance.now(), ok };
  return ok;
}
export async function renderParams(ctx, viewport, canvas, forExport = false) {
  const display = !forExport && await framesArriving();
  return { canvasContext: ctx, viewport, canvas, intent: display ? 'display' : 'print' };
}

/** Render page (1-based) to a canvas sized to fit `maxW` x `maxH` CSS px at devicePixelRatio. */
export async function renderThumb(view, n, maxW = 140, maxH = 170, extraRotation = 0) {
  const page = await view.getPage(n);
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + extraRotation) % 360 });
  const scale = Math.min(maxW / base.width, maxH / base.height);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale: scale * dpr, rotation: (page.rotate + extraRotation) % 360 });
  const c = document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  c.style.width = Math.round(vp.width / dpr) + 'px';
  c.style.height = Math.round(vp.height / dpr) + 'px';
  await page.render(await renderParams(c.getContext('2d'), vp, c)).promise;
  page.cleanup();
  return c;
}

/** Render a page at a given DPI to a canvas (white background). */
export async function renderAtDpi(view, n, dpi) {
  const page = await view.getPage(n);
  const vp = page.getViewport({ scale: dpi / 72 });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render(await renderParams(ctx, vp, c, true)).promise;
  page.cleanup();
  return c;
}

/** Parse "1-3, 5, 8-" into arrays of 1-based page numbers. Throws on bad input. */
export function parseRanges(str, max) {
  const groups = [];
  for (const part of str.split(/[,;]+/).map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!m || (!m[1] && !m[3])) throw new Error(`"${part}" isn’t a page or range.`);
    const a = m[1] ? +m[1] : 1;
    const b = m[2] ? (m[3] ? +m[3] : max) : a;
    if (a < 1 || b < 1 || a > max || b > max) throw new Error(`"${part}" is outside 1–${max}.`);
    const g = [];
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) g.push(i);
    groups.push(g);
  }
  if (!groups.length) throw new Error('Enter at least one page.');
  return groups;
}

export function canvasToBlob(c, type = 'image/png', q) {
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Image encoding failed')), type, q));
}

export async function blobBytes(b) { return new Uint8Array(await b.arrayBuffer()); }

/** Decode any browser-supported image file into an <img>/ImageBitmap-like canvas. */
export async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
  let w, hgt, src;
  if (bmp) { w = bmp.width; hgt = bmp.height; src = bmp; }
  else {
    const url = URL.createObjectURL(file);
    try {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`Can’t read "${file.name}" as an image.`)); i.src = url; });
      w = src.naturalWidth; hgt = src.naturalHeight;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = hgt;
  c.getContext('2d').drawImage(src, 0, 0);
  bmp && bmp.close && bmp.close();
  return c;
}

/** Embed an image file into a pdf-lib doc (JPEG kept as-is; others become PNG). */
export async function embedImageFile(doc, file) {
  const bytes = await readBytes(file);
  const isJpg = /jpe?g$/i.test(file.type.split('/')[1] || '') || /\.jpe?g$/i.test(file.name);
  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  try {
    if (isJpg) return await doc.embedJpg(bytes);
    if (isPng) return await doc.embedPng(bytes);
  } catch { /* fall back to re-encoding below (e.g. CMYK/progressive edge cases) */ }
  const c = await fileToCanvas(file);
  return doc.embedPng(await blobBytes(await canvasToBlob(c, 'image/png')));
}

/** pdf-lib page → how it looks on screen: { W, H, rot, toPdf(dx, dy) } (display origin top-left, y down). */
export function pageGeom(page) {
  const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  const { x: x0, y: y0, width: cw, height: ch } = page.getCropBox();
  const W = rot % 180 ? ch : cw, H = rot % 180 ? cw : ch;
  const toPdf = (dx, dy) => {
    if (rot === 90) return [x0 + dy, y0 + dx];
    if (rot === 180) return [x0 + cw - dx, y0 + dy];
    if (rot === 270) return [x0 + cw - dy, y0 + ch - dx];
    return [x0 + dx, y0 + ch - dy];
  };
  return { W, H, rot, toPdf };
}

export function hexToRgb01(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a5: [419.53, 595.28] };
