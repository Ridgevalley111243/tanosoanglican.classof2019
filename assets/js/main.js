import { sb, state, loadIdentity, isAdmin, isActive } from './api.js';
import { h, mount, icon } from './ui.js';
import { setRenderer, go } from './nav.js';
import { GROUP_SHORT, SCHOOL } from './config.js';
import * as auth from './views/auth.js';
import * as member from './views/member.js';
import * as admin from './views/admin.js';

const app = document.getElementById('app');

// Hash routes keep GitHub Pages happy: every URL serves index.html.
const memberRoutes = {
  '': member.home,
  pay: member.pay,
  history: member.history,
  receipt: member.receipt,
  notices: member.notices,
  account: member.account,
};
const adminRoutes = {
  admin: admin.dashboard,
  'admin/review': admin.review,
  'admin/members': admin.members,
  'admin/expenses': admin.expenses,
  'admin/reports': admin.reports,
  'admin/settings': admin.settings,
  'admin/audit': admin.audit,
};

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { path: parts.join('/'), parts, params: new URLSearchParams(query) };
}

function chrome(route, content) {
  const p = state.profile;
  const tabs = [
    ['', 'home', 'Home'],
    ['pay', 'pay', 'Pay'],
    ['history', 'history', 'History'],
  ];
  if (isAdmin()) tabs.push(['admin', 'shield', 'Admin']);
  else tabs.push(['account', 'users', 'Account']);
  const top = route.path.split('/')[0];
  const current = top === 'receipt' ? 'history' : top === 'notices' ? '' : top;

  return [
    h('div', { class: `shell ${route.path.startsWith('admin') ? 'wide' : ''}` },
      h('header', { class: 'topbar' },
        h('a', { class: 'brand', href: '#/' },
          h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '19'),
          h('span', { class: 'brand-text' }, h('b', {}, `${GROUP_SHORT} Dues`), h('span', {}, SCHOOL))),
        h('div', { class: 'row' },
          h('a', { class: 'btn ghost icon-btn', href: '#/notices', title: 'Notices', 'aria-label': 'Notices' }, icon('bell')),
          h('a', { class: 'btn ghost icon-btn', href: '#/account', title: p?.full_name || 'Account', 'aria-label': 'Your account' }, icon('users')))),
      h('main', { id: 'main' }, content),
      h('p', { class: 'footer-note' }, 'Payments count only after two admins confirm them against the MoMo statement.')),
    h('nav', { class: 'tabbar', 'aria-label': 'Main' },
      tabs.map(([path, ic, label]) => h('a', {
        href: `#/${path}`, 'aria-current': current === path ? 'page' : null,
      }, icon(ic), label))),
  ];
}

let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const route = parseHash();
  window.scrollTo(0, 0);

  // Auth screens work without a session.
  if (!state.session) {
    const view = auth.routes[route.path] || auth.login;
    return mount(app, await view(route));
  }
  if (route.path === 'reset') return mount(app, await auth.reset(route));

  if (!isActive()) return mount(app, await auth.waiting(route));

  let view = memberRoutes[route.parts[0] === 'receipt' ? 'receipt' : route.path];
  if (route.path.startsWith('admin')) view = isAdmin() ? adminRoutes[route.path] : null;
  if (!view) view = memberRoutes[''];

  const holder = h('div', { class: 'stack-lg' }, h('div', { class: 'empty' }, 'Loading…'));
  mount(app, chrome(route, holder));
  try {
    const content = await view(route);
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
