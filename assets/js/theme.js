import { h } from './ui.js';

// Light/dark mode. The choice is remembered on this device; until someone
// chooses, the site follows their phone or computer setting.
const KEY = 'c19-theme';
const root = document.documentElement;
const THEME_COLOR = { light: '#e9f0fa', dark: '#0b1220' };

const current = () => (root.dataset.theme === 'dark' ? 'dark' : 'light');

function apply(theme) {
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  for (const sw of document.querySelectorAll('.theme-switch')) {
    sw.setAttribute('aria-checked', String(theme === 'dark'));
    sw.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
}

export function setTheme(theme) {
  try { localStorage.setItem(KEY, theme); } catch { /* private mode: still switches for this visit */ }
  // Fade colours across the page only while switching, not on every repaint.
  root.classList.add('theme-anim');
  apply(theme);
  setTimeout(() => root.classList.remove('theme-anim'), 450);
}

export function initTheme() {
  apply(current());
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (!saved) apply(e.matches ? 'dark' : 'light');
  });
}

// The switch: a day sky with a sun that rolls across and becomes a cratered
// moon, while clouds drift off and stars appear.
export function themeSwitch() {
  const dark = current() === 'dark';
  return h('button', {
    class: 'theme-switch', type: 'button', role: 'switch', 'aria-checked': String(dark),
    'aria-label': 'Dark mode', title: dark ? 'Switch to light mode' : 'Switch to dark mode',
    onclick: () => setTheme(current() === 'dark' ? 'light' : 'dark'),
  },
  h('span', { class: 'ts-track', 'aria-hidden': 'true' },
    h('span', { class: 'ts-star s1' }), h('span', { class: 'ts-star s2' }), h('span', { class: 'ts-star s3' }),
    h('span', { class: 'ts-cloud' })),
  h('span', { class: 'ts-thumb', 'aria-hidden': 'true' },
    h('span', { class: 'ts-crater c1' }), h('span', { class: 'ts-crater c2' }), h('span', { class: 'ts-crater c3' })));
}
