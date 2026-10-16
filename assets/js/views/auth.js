import { sb, state, rpc, friendlyError } from '../api.js';
import { h, icon, field, toast, mount, form, sheet, copyText } from '../ui.js';
import { refresh } from '../nav.js';
import { SCHOOL } from '../config.js';

const siteUrl = () => location.origin + location.pathname;

function frame(title, lead, ...body) {
  return h('div', { class: 'auth' },
    h('div', { class: 'auth-watermark', 'aria-hidden': 'true' }, '2019'),
    h('div', { class: 'auth-card' },
      h('div', { class: 'row' },
        h('img', { class: 'brand-logo auth-logo', src: 'assets/logo.png', alt: 'Tanoso Anglican J.H.S crest', width: '56', height: '56' }),
        h('div', { class: 'brand-text' }, h('b', {}, 'Class of 2019'), h('span', {}, SCHOOL))),
      h('div', { class: 'auth-title' }, h('h1', {}, title), lead ? h('p', {}, lead) : null),
      h('div', { class: 'card' }, ...body),
      h('p', { class: 'footer-note' }, h('a', { href: '#/terms' }, 'Terms'), ' · ', h('a', { href: '#/privacy' }, 'Privacy'))));
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

// Shown once, right after sign-up: the member code the database just created.
export function showMemberCode(code) {
  const { close } = sheet(null,
    h('p', { class: 'small muted' }, 'Welcome to the class dues book'),
    h('h2', {}, 'This is your member code'),
    h('p', { class: 'code-big code-reveal' }, code),
    h('p', { class: 'small' }, 'Keep it — it identifies you on every payment and receipt. You can always find it again under Account.'),
    h('p', { class: 'small muted' }, 'An admin will now confirm that you’re a member of the class. You’ll see your dues as soon as they do.'),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(code, 'Code copied') }, icon('copy'), 'Copy'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => close() }, 'Got it')));
}

// "+233 24 123 4567", "233241234567" or "0241234567" → "0241234567"
const normalizePhone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return /^233\d{9}$/.test(d) ? `0${d.slice(3)}` : d;
};

export function register() {
  const codeField = field('Member code (only if an admin gave you one)',
    h('input', { class: 'input code', name: 'member_code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'C19-', maxlength: '9' }));
  codeField.hidden = true;
  const showCode = h('button', { class: 'btn ghost small', type: 'button', onclick: (e) => {
    codeField.hidden = false; e.currentTarget.remove(); codeField.querySelector('input').focus();
  } }, 'An admin gave me a member code');

  return frame('Join the dues book', 'Create your account. You’ll get your member code as soon as you sign up.',
    form(async (fd, err) => {
      const fullName = fd.get('full_name').trim();
      const phone = normalizePhone(fd.get('phone'));
      const code = (fd.get('member_code') || '').trim().toUpperCase();
      if (fullName.length < 2) throw new Error('Enter your full name.');
      if (!/^0\d{9}$/.test(phone)) throw new Error('Enter your phone number, e.g. 024 123 4567.');
      if (code && !/^C19-[A-HJ-NP-Z2-9]{5}$/.test(code)) throw new Error('Member codes look like C19-7KQ4M. Check the code, or leave it empty.');
      if ((fd.get('password') || '').length < 8) throw new Error('Use a password of at least 8 characters.');
      if (!fd.get('agree')) throw new Error('Please read and accept the terms and privacy policy.');

      const { data, error } = await sb.auth.signUp({
        email: fd.get('email').trim(),
        password: fd.get('password'),
        options: { emailRedirectTo: siteUrl(), data: { full_name: fullName, phone, member_code: code || null, terms_accepted_at: new Date().toISOString() } },
      });
      if (error) throw new Error(friendlyError(error));
      if (!data.session) {
        mount(err, h('div', { class: 'alert ok' },
          'Account created. We’ve sent a confirmation link to your email — open it on this phone, then sign in to see your member code.'));
        return;
      }
      await refresh('');
      if (state.member) showMemberCode(state.member.member_code);
    },
    field('Full name', h('input', { class: 'input', name: 'full_name', autocomplete: 'name', required: true, maxlength: '120' }),
          'As your classmates know you — admins use it to confirm you.'),
    field('Phone number', h('input', { class: 'input', name: 'phone', type: 'tel', inputmode: 'tel', autocomplete: 'tel', required: true, placeholder: '024 123 4567' }),
          'The number you use for Mobile Money.'),
    field('Email', email()),
    field('Password', password('new-password'), 'At least 8 characters.'),
    codeField, showCode,
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'agree', required: true }),
      // New tab, so reading them doesn't lose what's typed in the form.
      h('span', {}, 'I agree to the ', h('a', { href: '#/terms', target: '_blank', rel: 'noopener' }, 'terms and conditions'), ' and ',
        h('a', { href: '#/privacy', target: '_blank', rel: 'noopener' }, 'privacy policy'), '.')),
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
      h('div', { class: 'code-box' }, h('p', { class: 'small muted' }, 'Your member code'),
        h('p', { class: 'code-big' }, state.member.member_code),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => copyText(state.member.member_code, 'Code copied') }, icon('copy'), 'Copy')),
      h('p', {}, 'An admin will confirm that you’re a member of the class — then you’ll see your dues here.'),
      h('button', { class: 'btn primary block', type: 'button', onclick: (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); refresh(''); } }, 'Check again'),
      signOut()));
}

