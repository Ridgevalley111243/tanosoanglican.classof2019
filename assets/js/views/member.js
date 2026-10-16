import { sb, state, rpc, run, isAdmin, friendlyError, currentAllocations } from '../api.js';
import {
  h, icon, chip, cedis, cedisFigure, monthLabel, monthShortYear, dayLabel, dateLabel, dateTimeLabel, timeLabel, relative,
  greeting, todayAccra, nowTimeAccra, thisMonth, addMonths, toast, busy, empty, field, form, stat,
  plural, firstName, OWING_STATES, NETWORKS, networkTag, stateText,
} from '../ui.js';
import { go, refresh } from '../nav.js';
import { GROUP_SHORT, SCHOOL } from '../config.js';

const OWING = new Set(OWING_STATES);

function notLinked() {
  return h('div', { class: 'card stack' },
    h('h2', {}, 'No member record'),
    h('p', { class: 'muted' }, 'This account isn’t linked to anyone on the class list, so there are no dues to show. ',
      isAdmin() ? 'You can still use the Admin section.' : 'Ask an admin to link you.'),
    isAdmin() ? h('a', { class: 'btn primary', href: '#/admin' }, icon('shield'), 'Go to Admin') : null);
}

const myDues = () => run(sb.from('dues_overview').select('*').eq('member_id', state.member.id).order('period'));

const listMonths = (rows) => {
  const names = rows.map((r) => firstName(monthLabel(r.period)));
  const years = new Set(rows.map((r) => r.period.slice(0, 4)));
  if (names.length === 0) return '';
  const last = rows[rows.length - 1].period.slice(0, 4);
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return years.size === 1 ? `${joined} ${last}` : rows.map((r) => monthLabel(r.period)).join(', ');
};

// ---------------------------------------------------------------- home
export async function home() {
  if (!state.member) return notLinked();
  const [dues, notes, summary, fixes] = await Promise.all([
    myDues(),
    run(sb.from('notifications').select('*').is('read_at', null).order('created_at', { ascending: false }).limit(3)),
    state.settings.show_balance_to_members ? rpc('finance_summary') : null,
    run(sb.from('payments').select('id').eq('member_id', state.member.id).eq('status', 'correction_requested')),
  ]);

  const owing = dues.filter((d) => OWING.has(d.state));
  const overdue = dues.filter((d) => d.state === 'overdue');
  const total = owing.reduce((t, d) => t + Number(d.amount_due), 0);
  const inReview = dues.filter((d) => d.state === 'in_review');
  // Last month of the unbroken run of paid months from the start.
  const firstUnpaid = dues.findIndex((d) => d.state !== 'paid');
  const paidThrough = dues[(firstUnpaid === -1 ? dues.length : firstUnpaid) - 1];

  let sub;
  if (total === 0 && inReview.length) sub = `Nothing to pay. ${listMonths(inReview)} is being checked by the admins.`;
  else if (total === 0) sub = paidThrough ? `You’re paid up to ${monthLabel(paidThrough.period)}. Thank you.` : 'Nothing due right now.';
  else {
    const nextDue = owing.find((d) => d.state === 'open');
    sub = `${listMonths(owing)}${nextDue ? ` · pay by ${dayLabel(nextDue.due_on)}` : ''}`;
  }

  return [
    h('p', { class: 'greeting' }, `${greeting()}, `, h('em', {}, firstName(state.profile.full_name))),

    h('section', { class: 'card hero' },
      h('p', { class: 'label' }, total ? 'You owe' : 'Your dues'),
      h('p', { class: 'figure' }, h('small', {}, 'GH₵'), cedisFigure(total)),
      h('p', { class: 'muted' }, sub),
      overdue.length ? h('p', { class: 'small' }, chip('overdue', `${plural(overdue.length, 'month')} overdue`)) : null,
      h('div', { class: 'row wrap' },
        h('a', { class: 'btn primary', href: '#/pay' }, icon('pay'), total ? 'Record a payment' : 'Pay ahead'),
        h('a', { class: 'btn', href: '#/history' }, 'My payments'))),

    fixes.length ? h('div', { class: 'alert warn' }, 'An admin sent a payment back for you to check. ',
      h('a', { href: '#/history' }, 'See what to fix')) : null,

    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Month by month'),
        h('span', { class: 'muted' }, `${cedis(state.settings.monthly_dues)} a month, due on the ${ordinal(state.settings.due_day)} of the next month`)),
      dues.length ? h('div', { class: 'months' }, dues.map((d) =>
        h('div', { class: `month ${d.state}`, title: `${monthLabel(d.period)}: ${stateText(d.state)}` },
          h('i'), h('b', {}, monthShortYear(d.period)), h('span', {}, stateText(d.state)))))
        : empty('No dues yet.')),

    notes.length ? h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'New notices'), h('a', { class: 'small', href: '#/notices' }, 'All notices')),
      h('ul', { class: 'list' }, notes.map(noticeItem))) : null,

    summary ? h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Class fund'), h('span', { class: 'muted' }, 'confirmed payments only')),
      h('div', { class: 'stats' },
        stat('In the fund', cedis(summary.balance)),
        stat('Collected', cedis(summary.collected)),
        stat('Spent', cedis(summary.spent)))) : null,
  ];
}

const ordinal = (n) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'}`;
};

function noticeItem(n) {
  const ic = { payment_approved: 'check', payment_rejected: 'x', payment_correction: 'alert', overdue: 'alert', account: 'users' }[n.kind] || 'bell';
  return h('li', { class: `notice ${n.read_at ? '' : 'unread'}` },
    h('span', { class: 'ic' }, icon(ic)),
    h('div', {}, h('p', { class: 'item-title' }, n.title), h('p', { class: 'small' }, n.body), h('p', { class: 'tiny muted' }, relative(n.created_at))));
}

// ---------------------------------------------------------------- pay
export async function pay(route) {
  if (!state.member) return notLinked();
  const fixId = route.params.get('fix');
  const [dues, fixing] = await Promise.all([
    myDues(),
    fixId ? run(sb.from('payments').select('*, payment_allocations(round, dues_month_id)').eq('id', fixId).maybeSingle()) : null,
  ]);
  if (fixId && (!fixing || fixing.status !== 'correction_requested')) {
    return h('div', { class: 'card stack' }, h('h2', {}, 'Nothing to fix'),
      h('p', { class: 'muted' }, 'That payment is no longer waiting for a correction.'),
      h('a', { class: 'btn', href: '#/history' }, 'Back to my payments'));
  }

  const s = state.settings;
  const fixMonths = new Set((fixing?.payment_allocations || []).filter((a) => a.round === fixing.review_round).map((a) => a.dues_month_id));

  // Months that can be paid: owed ones, ones this correction already covers,
  // and up to six months ahead.
  const options = dues
    .filter((d) => OWING.has(d.state) || d.state === 'upcoming' || fixMonths.has(d.id))
    .map((d) => ({ period: d.period, amount: Number(d.amount_due), state: d.state, checked: fixMonths.has(d.id) || (!fixId && d.state !== 'upcoming') }));
  const have = new Set(dues.map((d) => d.period));
  for (let i = 1; i <= 6; i++) {
    const p = addMonths(thisMonth(), i);
    if (!have.has(p)) options.push({ period: p, amount: Number(s.monthly_dues), state: 'ahead', checked: false });
  }
  options.sort((a, b) => a.period.localeCompare(b.period));
  const blocked = dues.filter((d) => d.state === 'in_review' || (d.state === 'needs_correction' && !fixMonths.has(d.id)));

  const totalEl = h('span', { class: 'num' });
  const confirmText = h('span');
  const boxes = options.map((o) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', name: 'period', value: o.period, checked: o.checked, onchange: update }),
    h('span', {}, h('b', {}, monthLabel(o.period)), ' ',
      h('span', { class: 'muted small' }, `${cedis(o.amount)} · ${o.state === 'ahead' || o.state === 'upcoming' ? 'in advance' : stateText(o.state).toLowerCase()}`))));

  function selected() {
    return options.filter((o, i) => boxes[i].querySelector('input').checked);
  }
  function update() {
    const sel = selected();
    const total = sel.reduce((t, o) => t + o.amount, 0);
    totalEl.textContent = cedis(total);
    confirmText.textContent = `I sent exactly ${cedis(total)} for ${plural(sel.length, 'month')}.`;
  }
  update();

  const f = fixing || {};
  let detailsCard;
  // Logo tiles. Picking one recolours the whole step 3 card in that network's colours.
  const networkPick = h('div', { class: 'networks', role: 'radiogroup', 'aria-label': 'MoMo network' },
    Object.entries(NETWORKS).map(([k, v]) => h('label', { class: `net-tile net-${k}` },
      h('input', { type: 'radio', name: 'network', value: k, checked: (f.network || 'mtn') === k,
        onchange: () => { detailsCard.dataset.network = k; } }),
      h('img', { src: `assets/networks/${k}.png`, alt: v.name }),
      h('span', { class: 'net-name' }, v.name))));

  const formEl = form(submit,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '1. Which months?'), h('span', { class: 'muted' }, 'Whole months only')),
      h('div', { class: 'stack' }, boxes),
      blocked.length ? h('p', { class: 'small muted' }, `Not shown: ${listMonths(blocked)} — already on a payment being checked.`) : null),

    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '2. Send the money'), h('span', { class: 'figure-inline' }, totalEl)),
      s.momo_instructions
        ? h('p', { class: 'pre' }, s.momo_instructions)
        : h('p', { class: 'muted' }, 'Ask an admin for the MoMo number to send to.')),

    detailsCard = h('section', { class: 'card net-card', dataset: { network: f.network || 'mtn' } },
      h('div', { class: 'card-head' }, h('h2', {}, '3. Details from your MoMo message')),
      h('div', { class: 'stack' },
        field('Network', networkPick),
        field('Transaction ID', h('input', { class: 'input code', name: 'txn', required: true, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '60', value: f.transaction_id || '' }),
          'Copy it exactly from the confirmation SMS. Admins match it against the statement.'),
        field('Number you sent from', h('input', { class: 'input', name: 'sender', inputmode: 'numeric', autocomplete: 'tel', maxlength: '10', placeholder: '024xxxxxxx', value: f.sender_number || '' }), 'Optional, but it helps the admins find your payment.'),
        h('div', { class: 'field-row' },
          field('Date', h('input', { class: 'input', type: 'date', name: 'date', required: true, max: todayAccra(), value: f.paid_on || todayAccra() })),
          field('Time', h('input', { class: 'input', type: 'time', name: 'time', required: true, value: timeLabel(f.paid_time) || nowTimeAccra() }))),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'confirm', required: true }), confirmText))),

    h('button', { class: 'btn primary block', type: 'submit' }, icon('check'), fixId ? 'Send the corrected payment' : 'Submit for checking'),
    h('p', { class: 'small muted' }, 'Two admins will check this against the MoMo statement. You’ll get a receipt once both confirm.'));

  formEl.className = 'stack-lg';

  async function submit(fd) {
    const sel = selected();
    // The database checks the payment details; these are about the form itself
    // (an empty date or time wouldn't even reach the database's checks).
    if (!sel.length) throw new Error('Tick at least one month.');
    if (!fd.get('date') || !fd.get('time')) throw new Error('Enter the date and time of the payment.');
    if (!fd.get('confirm')) throw new Error('Tick the box to confirm the amount you sent.');

    const args = {
      p_network: fd.get('network'),
      p_transaction_id: fd.get('txn').trim(),
      p_sender_number: fd.get('sender').trim() || null,
      p_amount: sel.reduce((t, o) => t + o.amount, 0),
      p_paid_on: fd.get('date'),
      p_paid_time: fd.get('time'),
      p_periods: sel.map((o) => o.period),
    };
    if (fixId) await rpc('resubmit_payment', { p_payment: fixId, ...args });
    else await rpc('submit_payment', args);
    toast('Sent. The admins will check it.');
    go('history');
  }

  return [
    h('div', { class: 'page-title' }, h('h1', {}, fixId ? 'Fix your payment' : 'Record a payment'),
      fixing?.status_note ? h('div', { class: 'alert warn' }, h('b', {}, 'Admin’s note: '), fixing.status_note)
        : h('p', {}, 'Send the money first, then fill this in with the details from your MoMo message.')),
    formEl,
  ];
}

// ---------------------------------------------------------------- history
const PAYMENT_SELECT = '*, receipts(receipt_number, issued_at), payment_allocations(round, amount, dues_months(period))';
const currentMonths = (p) => currentAllocations(p).map((a) => a.dues_months);

export async function history() {
  if (!state.member) return notLinked();
  const pays = await run(sb.from('payments').select(PAYMENT_SELECT).eq('member_id', state.member.id).order('submitted_at', { ascending: false }));
  return [
    h('div', { class: 'page-title' }, h('h1', {}, 'My payments'), h('p', {}, 'Everything you’ve recorded, newest first.')),
    h('section', { class: 'card' },
      pays.length ? h('ul', { class: 'list' }, pays.map((p) => {
        const months = currentMonths(p);
        return h('li', { class: 'stack' },
          h('div', { class: 'spread' },
            h('div', {}, h('p', { class: 'item-title num' }, cedis(p.amount)), h('p', { class: 'small muted' }, listMonths(months))),
            chip(p.status)),
          h('div', { class: 'row wrap small' }, networkTag(p.network), h('span', { class: 'mono' }, p.transaction_id),
            h('span', { class: 'muted' }, `· sent ${dateLabel(p.paid_on)}, ${timeLabel(p.paid_time)}`)),
          p.status === 'correction_requested' ? h('div', { class: 'alert warn stack' },
            h('p', {}, h('b', {}, 'Admin’s note: '), p.status_note),
            h('a', { class: 'btn small primary', href: `#/pay?fix=${p.id}` }, 'Fix and resend')) : null,
          p.status === 'rejected' ? h('div', { class: 'alert error' }, h('b', {}, 'Not accepted: '), p.status_note || 'Two admins could not find this payment.') : null,
          p.status === 'pending' ? h('p', { class: 'small muted' }, `Submitted ${relative(p.submitted_at)}. Waiting for two admins to confirm.`) : null,
          p.receipts ? h('a', { class: 'btn small', href: `#/receipt/${p.id}` }, icon('receipt'), `Receipt ${p.receipts.receipt_number}`) : null);
      })) : empty('No payments yet. When you pay, record it here so the admins can confirm it.', 'pay')),
  ];
}

// ---------------------------------------------------------------- receipt
export async function receipt(route) {
  const id = route.parts[1];
  const p = await run(sb.from('payments').select(`${PAYMENT_SELECT}, members(full_name, member_code)`).eq('id', id).maybeSingle());
  if (!p || !p.receipts) {
    return h('div', { class: 'card stack' }, h('h2', {}, 'No receipt'),
      h('p', { class: 'muted' }, 'Receipts are issued only after two admins confirm a payment.'),
      h('a', { class: 'btn', href: '#/history' }, 'Back'));
  }
  const months = currentAllocations(p);
  const back = isAdmin() && p.member_id !== state.member?.id ? '#/admin/review' : '#/history';

  return [
    h('div', { class: 'row no-print' },
      h('a', { class: 'btn ghost', href: back }, icon('back'), 'Back'),
      h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, icon('print'), 'Print or save as PDF')),
    h('article', { class: 'receipt' },
      h('div', { class: 'receipt-head' },
        h('div', { class: 'row' }, h('img', { class: 'receipt-logo', src: 'assets/logo.png', alt: 'Tanoso Anglican J.H.S crest', width: '52', height: '52' }),
          h('div', {}, h('h1', {}, 'Receipt'), h('p', { class: 'small muted' }, `${GROUP_SHORT} · ${SCHOOL}`))),
        h('div', { class: 'r' }, h('p', { class: 'tiny muted' }, 'Receipt no.'), h('p', { class: 'mono' }, p.receipts.receipt_number))),
      h('div', { class: 'stamp', 'aria-hidden': 'true' }, 'CONFIRMED'),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Received from'), h('dd', {}, h('b', {}, p.members.full_name), ` (${p.members.member_code})`),
        h('dt', {}, 'Paid by'), h('dd', {}, `${NETWORKS[p.network].name}, ref `, h('span', { class: 'mono' }, p.transaction_id)),
        h('dt', {}, 'Sent on'), h('dd', {}, `${dateLabel(p.paid_on)} at ${timeLabel(p.paid_time)}`),
        h('dt', {}, 'Confirmed'), h('dd', {}, `${dateTimeLabel(p.decided_at)} by two admins`),
        h('dt', {}, 'Issued'), h('dd', {}, dateTimeLabel(p.receipts.issued_at))),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Dues for'), h('th', { class: 'r' }, 'Amount'))),
        h('tbody', {},
          months.map((a) => h('tr', {}, h('td', {}, monthLabel(a.dues_months.period)), h('td', { class: 'r num' }, cedis(a.amount)))),
          h('tr', { class: 'total' }, h('td', {}, 'Total received'), h('td', { class: 'r num' }, cedis(p.amount))))),
      h('p', { class: 'tiny muted' }, 'Times are Ghana time (GMT). This receipt was issued automatically after two separate admins confirmed the payment against the Mobile Money statement.')),
  ];
}

// ---------------------------------------------------------------- notices
export async function notices() {
  const list = await run(sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100));
  if (list.some((n) => !n.read_at)) rpc('mark_notifications_read', { p_ids: null }).catch(() => {});
  return [
    h('div', { class: 'page-title' }, h('h1', {}, 'Notices'), h('p', {}, 'Reminders and decisions on your payments.')),
    h('section', { class: 'card' }, list.length ? h('ul', { class: 'list' }, list.map(noticeItem)) : empty('Nothing yet.', 'bell')),
  ];
}

// ---------------------------------------------------------------- account
export async function account() {
  const p = state.profile;
  const nameInput = h('input', { class: 'input', value: p.full_name, maxlength: '120', autocomplete: 'name' });
  const pwInput = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: '8' });
  return [
    h('div', { class: 'page-title' }, h('h1', {}, 'Your account')),
    h('section', { class: 'card stack' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Email'), h('dd', {}, state.session.user.email),
        h('dt', {}, 'Member code'), h('dd', { class: 'mono' }, state.member?.member_code || '—'),
        h('dt', {}, 'Role'), h('dd', {}, isAdmin() ? chip('admin', 'Admin') : 'Member')),
      h('hr', { class: 'divider' }),
      field('Your name', nameInput),
      h('button', { class: 'btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        await rpc('update_my_name', { p_full_name: nameInput.value });
        toast('Name saved.');
        await refresh();
      }) }, 'Save name')),
    h('section', { class: 'card stack' },
      field('New password', pwInput, 'At least 8 characters.'),
      h('button', { class: 'btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        if (pwInput.value.length < 8) throw new Error('Use a password of at least 8 characters.');
        const { error } = await sb.auth.updateUser({ password: pwInput.value });
        if (error) throw new Error(friendlyError(error));
        pwInput.value = '';
        toast('Password changed.');
      }) }, 'Change password')),
    h('button', { class: 'btn danger block', type: 'button', onclick: () => sb.auth.signOut() }, icon('out'), 'Sign out'),
  ];
}
