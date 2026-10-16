import { sb, state, loadIdentity, isAdmin, isActive } from './api.js';
import { h, mount, icon } from './ui.js';
import { skeleton } from './skeleton.js';
import { setRenderer, go } from './nav.js';
import { GROUP_SHORT, SCHOOL } from './config.js';
import * as auth from './views/auth.js';
import * as member from './views/member.js';
import * as admin from './views/admin.js';
import * as legal from './views/legal.js';

const app = document.getElementById('app');

// Hash routes keep GitHub Pages happy: every URL serves index.html.
// Keyed by the first one or two path segments; `tab` is the bottom tab to
// highlight, and admin pages use the wide layout and require an admin.
const routes = {
  '': { view: member.home, tab: '', loading: 'home' },
  pay: { view: member.pay, tab: 'pay', loading: 'form' },
  history: { view: member.history, tab: 'history', loading: 'list' },
  receipt: { view: member.receipt, tab: 'history', loading: 'receipt' }, // receipt/<payment id>
  notices: { view: member.notices, tab: '', loading: 'list' },
  account: { view: member.account, tab: 'account', loading: 'form' },
  admin: { view: admin.dashboard, admin: true, loading: 'overview' },
  'admin/review': { view: admin.review, admin: true, loading: 'adminList' },
  'admin/members': { view: admin.members, admin: true, loading: 'adminList' },
  'admin/expenses': { view: admin.expenses, admin: true, loading: 'adminList' },
  'admin/reports': { view: admin.reports, admin: true, loading: 'adminList' },
  'admin/settings': { view: admin.settings, admin: true, loading: 'adminForm' },
  'admin/audit': { view: admin.audit, admin: true, loading: 'adminList' },
};
const findRoute = (route) => {
  const entry = routes[route.parts.slice(0, 2).join('/')] || routes[route.parts[0] || ''];
  return entry && (!entry.admin || isAdmin()) ? entry : routes[''];
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { path: parts.join('/'), parts, params: new URLSearchParams(query) };
}

function chrome(entry, content) {
  const p = state.profile;
  const tabs = [
    ['', 'home', 'Home'],
    ['pay', 'pay', 'Pay'],
    ['history', 'history', 'History'],
  ];
  if (isAdmin()) tabs.push(['admin', 'shield', 'Admin']);
  else tabs.push(['account', 'users', 'Account']);
  const current = entry.admin ? 'admin' : entry.tab;
  const links = () => tabs.map(([path, ic, label]) => h('a', {
    href: `#/${path}`, 'aria-current': current === path ? 'page' : null,
  }, icon(ic), label));

  return [
    h('div', { class: `shell ${entry.admin ? 'wide' : ''}` },
      h('header', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/' },
          h('img', { class: 'brand-logo', src: 'assets/logo.png', alt: '', width: '40', height: '40' }),
          h('span', { class: 'brand-text' }, h('b', {}, `${GROUP_SHORT} Dues`), h('span', {}, SCHOOL))),
        // On wide screens the main links sit here; on phones they're the bottom tab bar.
        h('nav', { class: 'topnav', 'aria-label': 'Main' }, links()),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost icon-btn', href: '#/notices', title: 'Notices', 'aria-label': 'Notices' }, icon('bell')),
          h('a', { class: 'btn ghost icon-btn', href: '#/account', title: p?.full_name || 'Account', 'aria-label': 'Your account' }, icon('users')))),
      h('main', { id: 'main' }, content),
      h('p', { class: 'footer-note' }, 'Payments count only after two admins confirm them against the MoMo statement.',
        h('br'), h('a', { href: '#/terms' }, 'Terms'), ' · ', h('a', { href: '#/privacy' }, 'Privacy'))),
    h('nav', { class: 'tabbar', 'aria-label': 'Main' }, links()),
  ];
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const route = parseHash();
  window.scrollTo(0, 0);

  // Terms and privacy are readable by anyone, signed in or not.
  if (route.path === 'terms' || route.path === 'privacy') return mount(app, legal[route.path]());

  // Auth screens work without a session.
  if (!state.session) {
    const view = auth.routes[route.path] || auth.login;
    return mount(app, await view(route));
  }
  if (route.path === 'reset') return mount(app, await auth.reset(route));

  if (!isActive()) return mount(app, await auth.waiting(route));

  const entry = findRoute(route);

  const holder = h('div', { class: 'stack-lg' }, skeleton(entry.loading));
  mount(app, chrome(entry, holder));
  try {
    const content = await entry.view(route);
    if (seq === renderSeq) mount(holder, content);
  } catch (e) {
    console.error(e);
    if (seq === renderSeq) mount(holder, h('div', { class: 'alert error' }, e.message || 'Could not load this page.'));
  }
}

async function start() {
  // Arrived from a password-reset email: PKCE code in the query string.
  const params = new URLSearchParams(location.search);
  const next = params.get('next');

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') { state.session = null; state.profile = null; go(''); }
    if (event === 'PASSWORD_RECOVERY') location.hash = '#/reset';
  });

  try { await loadIdentity(); }
  catch (e) {
    mount(app, h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      h('div', { class: 'card stack' }, h('h2', {}, 'Can’t reach the dues book'), h('p', { class: 'muted' }, e.message),
        h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again')))));
    return;
  }

  if (params.has('code') || next) {
    history.replaceState(null, '', location.pathname + (next === 'reset' ? '#/reset' : location.hash));
  }
  setRenderer(render);
  window.addEventListener('hashchange', render);
  render();
}

start();
