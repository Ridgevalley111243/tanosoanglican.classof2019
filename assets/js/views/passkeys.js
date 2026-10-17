import { sb, friendlyError, passkeysSupported } from '../api.js';
import { h, icon, mount, toast, busy, empty, ask, sheet, form, field, dateLabel, relative } from '../ui.js';
import { refresh } from '../nav.js';

// Passkeys let someone sign in with their phone's fingerprint, face or screen
// lock instead of typing a password. The private key never leaves the device;
// Supabase Auth stores only the public half.

const check = ({ data, error }) => {
  if (error) throw new Error(friendlyError(error));
  return data;
};

// Sign-in page button. Hidden on browsers that can't use passkeys.
export function passkeySignIn() {
  if (!passkeysSupported()) return null;
  return h('div', { class: 'stack passkey-signin' },
    h('p', { class: 'or-line', 'aria-hidden': 'true' }, h('span', {}, 'or')),
    h('button', { class: 'btn block', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
      check(await sb.auth.signInWithPasskey());
      await refresh('');
    }) }, icon('key'), 'Sign in with a passkey'));
}

function rename(pk, done) {
  const input = h('input', { class: 'input', value: pk.friendly_name || '', maxlength: '120', required: true, autocomplete: 'off' });
  const { close } = sheet(null,
    h('h2', {}, 'Rename passkey'),
    h('p', { class: 'muted small sheet-body' }, 'Use a name that tells you which phone or computer it is on.'),
    form(async () => {
      const name = input.value.trim();
      if (!name) throw new Error('Type a name for this passkey.');
      check(await sb.auth.passkey.update({ passkeyId: pk.id, friendlyName: name }));
      close();
      toast('Passkey renamed.');
      done();
    },
    field('Name', input),
    h('div', { class: 'sheet-actions' },
      h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Cancel'),
      h('button', { class: 'btn primary', type: 'submit' }, 'Save'))));
  input.focus();
  input.select();
}

async function remove(pk, done) {
  const ok = await ask({
    title: 'Remove this passkey?',
    body: `“${pk.friendly_name || 'Passkey'}” will stop working for this site. You can still sign in with your password. (It may stay listed in your phone’s password manager; you can delete it there too.)`,
    confirm: 'Remove', danger: true,
  });
  if (!ok) return;
  check(await sb.auth.passkey.delete({ passkeyId: pk.id }));
  toast('Passkey removed.');
  done();
}

// Account page card: list, add, rename, remove.
export function passkeyCard() {
  const body = h('div', {}, h('p', { class: 'small muted' }, 'Loading…'));
  const card = h('section', { class: 'card stack' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Passkeys')),
    h('p', { class: 'small muted' }, 'Sign in with your fingerprint, face or phone screen lock instead of your password. Your fingerprint or face never leaves your device — this site only keeps a public key that can’t be used to sign in on its own.'),
    body);

  if (!passkeysSupported()) {
    mount(body, h('p', { class: 'small' }, 'This browser can’t use passkeys. Open the site in an up-to-date Chrome, Safari or Edge to set one up.'));
    return card;
  }

  const load = async () => {
    let keys;
    try { keys = check(await sb.auth.passkey.list()) || []; }
    catch (e) { mount(body, h('p', { class: 'small' }, e.message)); return; }

    const add = h('button', { class: `btn ${keys.length ? '' : 'primary'} block`, type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
      const pk = check(await sb.auth.registerPasskey());
      toast(pk?.friendly_name ? `Passkey saved in ${pk.friendly_name}.` : 'Passkey set up.');
      await load();
    }) }, icon(keys.length ? 'plus' : 'key'), keys.length ? 'Add a passkey on another device' : 'Set up a passkey');

    mount(body,
      keys.length
        ? h('ul', { class: 'list passkeys' }, keys.map((pk) => h('li', { class: 'spread' },
          h('div', { class: 'row' },
            h('span', { class: 'pk-icon' }, icon('key')),
            h('div', {},
              h('p', { class: 'item-title' }, pk.friendly_name || 'Passkey'),
              h('p', { class: 'small muted' }, `Added ${dateLabel(pk.created_at)}`,
                pk.last_used_at ? ` · last used ${relative(pk.last_used_at)}` : ' · not used yet'))),
          h('div', { class: 'row pk-actions' },
            h('button', { class: 'btn small ghost', type: 'button', onclick: () => rename(pk, load) }, 'Rename'),
            h('button', { class: 'btn small ghost danger', type: 'button', onclick: (e) => busy(e.currentTarget, () => remove(pk, load)) }, 'Remove')))))
        : empty('No passkeys yet.', 'key'),
      add);
  };
  load();
  return card;
}
