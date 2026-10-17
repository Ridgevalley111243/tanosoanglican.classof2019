import { TIME_ZONE } from './config.js';

// ---------- DOM ----------
// Builds elements without innerHTML, so names and notes typed by members are
// always treated as text.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(target, ...children) {
  target.replaceChildren();
  append(target, children);
}

const SVG = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  append(el, children);
  return el;
}

// ---------- icons (24px, 1.75 stroke) ----------
const PATHS = {
  home: 'M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z',
  pay: 'M3.5 7.5h17v11h-17zM3.5 10.5h17M7 15h4',
  history: 'M4 12a8 8 0 1 0 2.4-5.7M4 4.5v3.8h3.8M12 8v4.3l3 1.8',
  shield: 'M12 3.5 5 6.2v5.2c0 4.3 3 7.6 7 9.1 4-1.5 7-4.8 7-9.1V6.2z M9 12l2.2 2.2L15.5 10',
  bell: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5h-14zM10 20.5h4',
  check: 'M5 12.5 10 17.5 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  back: 'M14.5 5.5 8 12l6.5 6.5',
  copy: 'M8.5 8.5h10v11h-10zM5.5 15.5v-11h10',
  print: 'M7 9V4h10v5M7 17H4.5v-7h15v7H17M7 14h10v6H7z',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14',
  plus: 'M12 5v14M5 12h14',
  out: 'M14 4.5h4.5v15H14M10.5 8 6.5 12l4 4M6.5 12h9',
  alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.5',
  clock: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 8v4.5l3 1.5',
  users: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5M16 5a3.2 3.2 0 0 1 0 6.3M18 14.6c1.6.7 2.6 2.2 3 4.9',
  receipt: 'M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.2-1.5 1.2-2-1.5L6 20.5zM9 8h6M9 11.5h6M9 15h3.5',
  wallet: 'M4 7.5h14.5a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5V6a1.5 1.5 0 0 1 1.5-1.5H17M16 13.8h.5',
  key: 'M14.5 13.5a4.5 4.5 0 1 0-4.2-2.9L4 16.9V20h3.1v-2h2v-2h2l1.5-1.5a4.5 4.5 0 0 0 1.9.5zM16 8.5v.01',
  book: 'M5 4.5h10.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3zM5 16.5a3 3 0 0 1 3-3h10.5',
};

export function icon(name, attrs = {}) {
  return s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75',
                    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', ...attrs },
           s('path', { d: PATHS[name] }));
}

// ---------- formatting (always Ghana time) ----------
const cedisFmt = new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const cedis = (n) => `GH₵${cedisFmt.format(Number(n || 0))}`;
// The big hero number: whole cedis without decimals, otherwise two places.
export const cedisFigure = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? v.toLocaleString('en-GH') : cedisFmt.format(v);
};
export const cedisShort = (n) => {
  const v = Number(n || 0);
  return Number.isInteger(v) ? `GH₵${v.toLocaleString('en-GH')}` : cedis(v);
};

// Formatters are built once; making them is the slow part on cheap phones.
// Calendar dates ('YYYY-MM-DD' from Postgres) are formatted in UTC so they never
// shift a day; timestamps are formatted in Ghana time.
const fmt = (opts, timeZone = TIME_ZONE) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone, ...opts });
  return (v) => f.format(new Date(v));
};
const calendar = (opts) => fmt(opts, 'UTC');
export const monthLabel = calendar({ month: 'long', year: 'numeric' });
export const monthShort = calendar({ month: 'short' });
const monthShortYearFmt = calendar({ month: 'short', year: '2-digit' });
export const monthShortYear = (d) => monthShortYearFmt(d).replace(' ', ' ’');
export const dayLabel = calendar({ weekday: 'short', day: 'numeric', month: 'short' });
export const dateLabel = calendar({ day: 'numeric', month: 'short', year: 'numeric' });
export const dateTimeLabel = fmt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const timeLabel = (t) => (t || '').slice(0, 5);

// YYYY-MM-DD in Ghana time (en-CA formats dates that way).
const isoFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
export const isoDateAccra = (ts = new Date()) => isoFmt.format(new Date(ts));
export const todayAccra = () => isoDateAccra();
export function nowTimeAccra() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}
export function addMonths(isoMonth, n) {
  const [y, m] = isoMonth.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}
export const thisMonth = () => `${todayAccra().slice(0, 7)}-01`;

export function relative(ts) {
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  return dateLabel(isoDateAccra(ts));
}

export function greeting() {
  const hr = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hour12: false }).format(new Date()));
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0];

// Dues states that still need paying.
export const OWING_STATES = ['overdue', 'open'];

export const NETWORKS = {
  mtn: { name: 'MTN MoMo', short: 'MTN' },
  telecel: { name: 'Telecel Cash', short: 'Telecel' },
  airteltigo: { name: 'AT Money', short: 'AT' },
};
export const networkTag = (n) => h('span', { class: `network ${n}` }, NETWORKS[n]?.short || n);

const STATE_TEXT = {
  paid: 'Paid', in_review: 'Being checked', needs_correction: 'Needs fixing', overdue: 'Overdue',
  open: 'Due', upcoming: 'Paid ahead', pending: 'Being checked', approved: 'Confirmed',
  rejected: 'Not accepted', correction_requested: 'Sent back',
};
const STATE_ICON = { paid: 'check', approved: 'check', overdue: 'alert', rejected: 'x', in_review: 'clock', pending: 'clock' };
export const stateText = (st) => STATE_TEXT[st] || st;
export const chip = (st, text) => h('span', { class: `chip ${st}` }, STATE_ICON[st] ? icon(STATE_ICON[st]) : null, text || stateText(st));

// ---------- feedback ----------
export function toast(message, kind = 'ok') {
  const el = h('div', { class: `toast ${kind}` }, icon(kind === 'error' ? 'alert' : 'check'), h('span', {}, message));
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

// Runs an async action from a button: disables it, shows errors, re-enables.
export async function busy(button, fn) {
  if (button?.getAttribute('aria-busy') === 'true') return;
  button?.setAttribute('aria-busy', 'true');
  try { return await fn(); }
  catch (e) { toast(e.message || 'Something went wrong.', 'error'); }
  finally { button?.removeAttribute('aria-busy'); }
}

export const stat = (label, value, note) => h('div', { class: 'glass stat' },
  h('p', { class: 'label' }, label), h('p', { class: 'value num' }, value), note ? h('p', { class: 'note' }, note) : null);

export function errorBox(message) {
  return h('div', { class: 'alert error', role: 'alert' }, message);
}

export function empty(text, iconName = 'book') {
  return h('div', { class: 'empty' }, icon(iconName), text);
}

// Opens a modal sheet. close() removes it; Escape closes it too.
export function sheet(onClose, ...children) {
  const dlg = h('dialog', { class: 'sheet' }, ...children);
  const close = (v) => { dlg.close(); dlg.remove(); onClose?.(v); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, close };
}

// A small confirm dialog. Resolves to the note text (or true) when confirmed, null when cancelled.
export function ask({ title, body, confirm = 'Confirm', danger = false, note = null }) {
  return new Promise((resolve) => {
    const textarea = note ? h('textarea', { class: 'input', placeholder: note.placeholder || '', maxlength: '500' }) : null;
    const err = h('div');
    const { dlg, close } = sheet(resolve,
      h('h2', {}, title),
      body ? h('p', { class: 'muted small sheet-body' }, body) : null,
      textarea ? h('label', { class: 'field' }, h('span', {}, note.label), textarea) : null,
      err,
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, 'Cancel'),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => {
          if (textarea && note.required && !textarea.value.trim()) {
            mount(err, errorBox('Please write a short reason.'));
            textarea.focus();
            return;
          }
          close(textarea ? textarea.value.trim() : true);
        } }, confirm)));
    (textarea || dlg.querySelector('.btn.primary, .btn.danger')).focus();
  });
}

// A form whose submit handler may throw: the message shows at the top of the
// form, and the submit button can't be pressed twice.
export function form(onSubmit, ...children) {
  const err = h('div');
  const el = h('form', { class: 'stack', novalidate: true }, err, ...children);
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('button[type=submit]');
    if (btn.getAttribute('aria-busy') === 'true') return;
    mount(err);
    btn.setAttribute('aria-busy', 'true');
    try { await onSubmit(new FormData(el), err); }
    catch (ex) { mount(err, errorBox(ex.message || 'Something went wrong.')); err.scrollIntoView({ block: 'center' }); }
    finally { btn.removeAttribute('aria-busy'); }
  });
  return el;
}

export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast('Couldn’t copy — select and copy it by hand.', 'error'); }
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);
}
