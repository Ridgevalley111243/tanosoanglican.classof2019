import { sb, state, rpc, friendlyError } from '../api.js';
import { h, icon, field, errorBox, toast, mount } from '../ui.js';
import { refresh } from '../nav.js';
import { SCHOOL } from '../config.js';

const siteUrl = () => location.origin + location.pathname;

function frame(title, lead, ...body) {
  return h('div', { class: 'auth' },
    h('div', { class: 'auth-watermark', 'aria-hidden': 'true' }, '2019'),
    h('div', { class: 'auth-card' },
      h('div', { class: 'row' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '19'),
        h('div', { class: 'brand-text' }, h('b', {}, 'Class of 2019'), h('span', {}, SCHOOL))),
      h('div', { class: 'auth-title' }, h('h1', {}, title), lead ? h('p', {}, lead) : null),
      h('div', { class: 'card' }, ...body)));
}

// Wraps a form so errors show inline and the button can't double-submit.
function form(onSubmit, ...children) {
  const err = h('div');
  const el = h('form', { class: 'stack', novalidate: true }, err, ...children);
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = el.querySelector('button[type=submit]');
    if (btn.getAttribute('aria-busy') === 'true') return;
    mount(err);
    btn.setAttribute('aria-busy', 'true');
    try { await onSubmit(new FormData(el), err); }
    catch (ex) { mount(err, errorBox(ex.message || friendlyError(ex))); }
    finally { btn.removeAttribute('aria-busy'); }
  });
  return el;
}

const email = () => h('input', { class: 'input', type: 'email', name: 'email', autocomplete: 'email', required: true, inputmode: 'email' });
const password = (auto = 'current-password') =>
  h('input', { class: 'input', type: 'password', name: 'password', autocomplete: auto, minlength: '8', required: true });

export function login() {
  return frame('Monthly dues', 'Sign in to see what you owe, record a MoMo payment and download receipts.',
    form(async (fd) => {
      const { error } = await sb.auth.signInWithPassword({ email: fd.get('email').trim(), password: fd.get('password') });
      if (error) throw new Error(friendlyError(error));
      await refresh('');
    },
    field('Email', email()),
    field('Password', password()),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Sign in'),
    h('p', { class: 'small' }, h('a', { href: '#/forgot' }, 'Forgot your password?'))),
    h('p', { class: 'auth-switch' }, 'New here? ', h('a', { href: '#/register' }, 'Create your account')));
}

export function register() {
  return frame('Join the dues book', 'You need the member code an admin gave you. It looks like C19-7KQ4M.',
    form(async (fd, err) => {
      const fullName = fd.get('full_name').trim();
      const code = fd.get('member_code').trim().toUpperCase();
      if (fullName.length < 2) throw new Error('Enter your full name.');
      if (!/^C19-[A-Z0-9]{5}$/.test(code)) throw new Error('Member codes look like C19-7KQ4M. Check the code and try again.');
      if ((fd.get('password') || '').length < 8) throw new Error('Use a password of at least 8 characters.');

      const { data, error } = await sb.auth.signUp({
        email: fd.get('email').trim(),
        password: fd.get('password'),
        options: { emailRedirectTo: siteUrl(), data: { full_name: fullName, member_code: code } },
      });
      if (error) throw new Error(friendlyError(error));
      if (!data.session) {
        mount(err, h('div', { class: 'alert ok' },
          'Account created. We’ve sent a confirmation link to your email — open it on this phone, then sign in.'));
        return;
      }
      await refresh('');
    },
    field('Full name', h('input', { class: 'input', name: 'full_name', autocomplete: 'name', required: true, maxlength: '120' }),
          'As your classmates know you.'),
    field('Member code', h('input', { class: 'input code', name: 'member_code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'C19-', maxlength: '9', required: true })),
    field('Email', email()),
    field('Password', password('new-password'), 'At least 8 characters.'),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Create account')),
    h('p', { class: 'auth-switch' }, 'Already registered? ', h('a', { href: '#/' }, 'Sign in')));
}

export function forgot() {
  return frame('Reset password', 'We’ll email you a link. Open it on this same phone or browser.',
    form(async (fd, err) => {
      const { error } = await sb.auth.resetPasswordForEmail(fd.get('email').trim(), { redirectTo: `${siteUrl()}?next=reset` });
      if (error) throw new Error(friendlyError(error));
      mount(err, h('div', { class: 'alert ok' }, 'If that email is registered, a reset link is on its way.'));
    },
    field('Email', email()),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Send reset link')),
    h('p', { class: 'auth-switch' }, h('a', { href: '#/' }, 'Back to sign in')));
}

export function reset() {
  if (!state.session) return forgot();
  return frame('Choose a new password', null,
    form(async (fd) => {
      if ((fd.get('password') || '').length < 8) throw new Error('Use a password of at least 8 characters.');
      const { error } = await sb.auth.updateUser({ password: fd.get('password') });
      if (error) throw new Error(friendlyError(error));
      toast('Password changed.');
      await refresh('');
    },
    field('New password', password('new-password'), 'At least 8 characters.'),
    h('button', { class: 'btn primary block', type: 'submit' }, 'Save password')));
}

export const routes = { '': login, register, forgot, reset };

const signOut = () => h('button', { class: 'btn ghost block', type: 'button', onclick: () => sb.auth.signOut() }, icon('out'), 'Sign out');

// Signed in, but not (yet) an active member.
export function waiting() {
  const p = state.profile;
  if (!p) {
    return frame('Almost there', null,
      h('p', {}, 'We couldn’t find your profile. Sign out and in again, or ask an admin for help.'), signOut());
  }
  if (p.account_status === 'suspended') {
    return frame('Account on hold', `Hi ${p.full_name}.`,
      h('div', { class: 'stack' },
        h('p', {}, 'An admin has paused this account, so dues and payments are hidden for now. Speak to one of the class executives.'),
        signOut()));
  }
  if (!state.member) {
    return frame('Add your member code', `Hi ${p.full_name}. Your account is ready, but it isn’t linked to the class list yet.`,
      form(async (fd) => {
        const ok = await rpc('link_member_code', { p_code: fd.get('code').trim() });
        if (!ok) throw new Error('That code is not valid or has already been used. Check it with an admin.');
        toast('Code accepted.');
        await refresh('');
      },
      field('Member code', h('input', { class: 'input code', name: 'code', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'C19-', maxlength: '9', required: true })),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Link my account')),
      h('hr', { class: 'divider' }), signOut());
  }
  return frame('Waiting for approval', `Hi ${p.full_name}.`,
    h('div', { class: 'stack' },
      h('p', {}, 'You’re linked to ', h('b', {}, state.member.full_name), ' (', h('span', { class: 'mono' }, state.member.member_code),
        '). An admin will confirm you shortly — then you’ll see your dues here.'),
      h('button', { class: 'btn primary block', type: 'button', onclick: (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); refresh(''); } }, 'Check again'),
      signOut()));
}

