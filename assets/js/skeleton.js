import { h } from './ui.js';

// Placeholder shapes shown while a page's data loads. Each kind roughly
// matches the layout that replaces it, so nothing jumps when the data arrives.

const bar = (w, cls = '') => {
  const el = h('span', { class: `sk ${cls}` });
  el.style.width = w;
  return el;
};
const lines = (...widths) => h('div', { class: 'sk-lines' }, widths.map((w) => bar(w)));
const card = (...children) => h('div', { class: 'card sk-card' }, ...children);
const listRows = (n) => h('div', { class: 'sk-list' }, Array.from({ length: n }, () =>
  h('div', { class: 'sk-row' }, lines('55%', '35%'), bar('64px', 'sk-pill'))));
const title = () => h('div', { class: 'page-title' }, bar('46%', 'sk-title'), lines('80%'));
const subnav = () => h('div', { class: 'subnav sk-subnav' }, ['88px', '104px', '96px', '96px'].map((w) => bar(w, 'sk-chip')));

const KINDS = {
  home: () => [
    bar('58%', 'sk-greeting'),
    card(bar('22%'), bar('46%', 'sk-figure'), lines('70%'), h('div', { class: 'row' }, bar('172px', 'sk-btn'), bar('128px', 'sk-btn'))),
    card(bar('36%', 'sk-title'), h('div', { class: 'months' }, Array.from({ length: 6 }, () => bar('100%', 'sk-month')))),
  ],
  form: () => [title(), card(bar('40%', 'sk-title'), lines('90%', '75%', '82%')), card(bar('48%', 'sk-title'), bar('100%', 'sk-input'), bar('100%', 'sk-input'))],
  list: () => [title(), card(listRows(4))],
  receipt: () => [h('div', { class: 'row' }, bar('88px', 'sk-btn'), bar('190px', 'sk-btn')), card(bar('40%', 'sk-title'), lines('70%', '60%', '75%', '50%'), listRows(3))],
  overview: () => [subnav(), title(), card(bar('30%'), bar('50%', 'sk-figure'), lines('60%')),
    h('div', { class: 'stats' }, Array.from({ length: 4 }, () => h('div', { class: 'glass stat' }, lines('60%'), bar('80%', 'sk-stat'))))],
  adminList: () => [subnav(), title(), card(listRows(4))],
  adminForm: () => [subnav(), title(), card(bar('100%', 'sk-input'), bar('100%', 'sk-input'), bar('100%', 'sk-input'), bar('140px', 'sk-btn'))],
};

export function skeleton(kind = 'list') {
  return h('div', { class: 'stack-lg sk-page', 'aria-busy': 'true', 'aria-label': 'Loading' }, (KINDS[kind] || KINDS.list)());
}
