// Optional tips through Microsoft Store add-ons (consumables). Payment happens in the Store's own
// sheet, so people only ever see "Microsoft Store" and the publisher name. No links, no QR codes.
// Tips exist only in the Store install; anywhere else the support UI simply stays hidden.
import { h, toast, dialog, store, storeSet } from './ui.js';

const BILLING = 'https://store.microsoft.com/billing';
// Product IDs of the three consumable add-ons in Partner Center (same IDs in every LumioLab app).
const TIPS = [
  { id: 'tip_coffee', emoji: '☕', label: 'Coffee', fallback: '$1.99' },
  { id: 'tip_lunch', emoji: '🍕', label: 'Lunch', fallback: '$4.99' },
  { id: 'tip_big', emoji: '🎁', label: 'Big thanks', fallback: '$9.99' },
];
const TIP_AT = [3, 10, 25, 50, 100];   // saves after which the quiet thank-you line may appear

let APP = 'this app';
let service = null;
export const tips = { ready: false, prices: {} };
const listeners = new Set();
export const onTipsReady = fn => { listeners.add(fn); if (tips.ready) fn(); };

// Local test double: ?tips=store (works), ?tips=cancel (user closes the sheet).
const mock = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('tips');

async function getService() {
  if (service) return service;
  if (mock) return (service = mockService(mock));
  if (typeof window.getDigitalGoodsService !== 'function') return null;
  try { service = await window.getDigitalGoodsService(BILLING); } catch { service = null; }
  return service;
}

const fmtPrice = p => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency }).format(+p.value); } catch { return null; } };

export async function initTips(appName) {
  APP = appName;
  const s = await getService();
  if (!s) return;
  try {
    const details = await s.getDetails(TIPS.map(t => t.id));
    for (const d of details || []) tips.prices[d.itemId] = d.price ? fmtPrice(d.price) : null;
    tips.ready = (details || []).length > 0;   // false until the add-ons are live in the Store
  } catch { tips.ready = false; }
  // A tip bought while the app closed mid-purchase is still "owned": use it up so it can be bought again.
  try { for (const p of await s.listPurchases()) if (TIPS.some(t => t.id === p.itemId)) await s.consume(p.purchaseToken); } catch { /* */ }
  if (tips.ready) listeners.forEach(fn => { try { fn(); } catch { /* */ } });
}

async function buy(tip) {
  const s = await getService();
  if (!s) return;
  try {
    const req = mock ? s.paymentRequest(tip.id) : new PaymentRequest([{ supportedMethods: BILLING, data: { itemId: tip.id } }], { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } });
    const res = await req.show();
    try { await res.complete('success'); } catch { /* some hosts complete for us */ }
    const token = res.details?.purchaseToken;
    try {
      if (token) await s.consume(token);
      else for (const p of await s.listPurchases()) if (p.itemId === tip.id) await s.consume(p.purchaseToken);
    } catch { /* consumed on next launch instead */ }
    storeSet('tipped', true);
    document.getElementById('dlg')?.close();
    document.querySelectorAll('.tip-line').forEach(el => el.remove());
    toast(`Thank you so much! ${tip.emoji} Your support keeps ${APP} free.`);
  } catch (e) {
    if (!(e && (e.name === 'AbortError' || /cancel/i.test(e.message || '')))) toast('The Store couldn’t complete that. Nothing was charged.', 'err');
  }
}

/** The three tip buttons. */
export function supportBox() {
  return h('div', { class: 'tip-grid' }, TIPS.map(t =>
    h('button', { class: 'tip-btn', type: 'button', onclick: () => buy(t) },
      h('span', { class: 'tip-emoji', 'aria-hidden': 'true' }, t.emoji),
      h('b', {}, t.label),
      h('span', {}, tips.prices[t.id] || t.fallback))));
}

export function openSupport() {
  if (!tips.ready) return;
  dialog({
    title: `Support ${APP}`,
    body: h('div', {},
      h('p', { class: 'hint', style: { marginTop: 0 } }, `${APP} is free, with no ads and nothing locked. If it saves you time, you can say thanks with a small tip. It's completely optional, and payment goes through the Microsoft Store.`),
      supportBox()),
    ok: null, cancel: 'Close',
  });
}

/** Call after every successful save; true when this save hits a thank-you milestone. */
export function countSave() {
  const n = (store('saves', 0) || 0) + 1;
  storeSet('saves', n);
  return tips.ready && TIP_AT.includes(n) && !store('tipOff', false) && !store('tipped', false);
}

/** One quiet line under the "Saved" box, with a way to hide it for good. */
export function tipLine() {
  const line = h('div', { class: 'tip-line' },
    h('span', {}, `${APP} is free, with no ads. If it saved you time, you can `),
    h('button', { class: 'linkish', type: 'button', onclick: openSupport }, 'leave a small tip'),
    h('span', {}, '.'),
    h('button', { class: 'tip-off', type: 'button', onclick: () => { storeSet('tipOff', true); line.remove(); } }, "Don't show again"));
  return line;
}

function mockService(kind) {
  return {
    async getDetails(ids) { return ids.map((id, i) => ({ itemId: id, title: id, price: { currency: 'USD', value: ['1.99', '4.99', '9.99'][i] } })); },
    async listPurchases() { return []; },
    async consume() {},
    paymentRequest() {
      return { async show() { if (kind === 'cancel') { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; } return { details: { purchaseToken: 'mock' }, complete: async () => {} }; } };
    },
  };
}
