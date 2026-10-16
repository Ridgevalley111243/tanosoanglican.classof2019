import { sb, state, rpc, run, fetchAll } from '../api.js';
import {
  h, icon, chip, cedis, monthLabel, dateLabel, dateTimeLabel, timeLabel, relative, todayAccra, thisMonth,
  toast, busy, ask, empty, field, mount, copyText, networkTag, NETWORKS, stateText, errorBox,
} from '../ui.js';
import { go } from '../nav.js';
import { duesChart } from '../chart.js';
import { downloadXlsx } from '../xlsx.js';
import { GROUP_SHORT, SCHOOL } from '../config.js';

// ---------------------------------------------------------------- shared
let counts = null;
async function loadCounts() {
  counts = await rpc('finance_summary');
  return counts;
}

function subnav(current) {
  const c = counts || {};
  const items = [
    ['admin', 'Overview'],
    ['admin/review', 'Payments', c.pending_payments],
    ['admin/members', 'Members', c.pending_accounts],
    ['admin/expenses', 'Expenses', c.pending_expenses],
    ['admin/reports', 'Reports'],
    ['admin/settings', 'Settings'],
    ['admin/audit', 'Audit log'],
  ];
  return h('nav', { class: 'subnav', 'aria-label': 'Admin sections' },
    items.map(([path, label, n]) => h('a', { href: `#/${path}`, 'aria-current': current === path ? 'page' : null },
      label, n ? h('span', { class: 'count' }, n) : null)));
}

const page = (current, title, lead, ...body) => [
  subnav(current),
  h('div', { class: 'page-title' }, h('h1', {}, title), lead ? h('p', {}, lead) : null),
  ...body,
];

const stat = (label, value, note, hero) => h('div', { class: `glass stat ${hero ? 'hero-stat' : ''}` },
  h('p', { class: 'label' }, label), h('p', { class: 'value num' }, value), note ? h('p', { class: 'note' }, note) : null);

async function profilesById() {
  const rows = await fetchAll(() => sb.from('profiles').select('id, full_name, email, is_admin, account_status, created_at').order('created_at'));
  return new Map(rows.map((p) => [p.id, p]));
}
const shortName = (p) => p?.full_name?.split(' ')[0] || 'Someone';

// ---------------------------------------------------------------- overview
export async function dashboard() {
  const s = await loadCounts();
  const todo = [
    s.pending_payments && ['admin/review', 'pay', `${s.pending_payments} payment${s.pending_payments > 1 ? 's' : ''} to check`, cedis(s.awaiting_review) + ' waiting'],
    s.pending_accounts && ['admin/members', 'users', `${s.pending_accounts} sign-up${s.pending_accounts > 1 ? 's' : ''} to confirm`, 'New members waiting for approval'],
    s.pending_expenses && ['admin/expenses', 'wallet', `${s.pending_expenses} expense${s.pending_expenses > 1 ? 's' : ''} to review`, 'Needs two admins other than the recorder'],
  ].filter(Boolean);

  return page('admin', 'Overview', `${s.active_members} active members · figures count confirmed payments and approved expenses only.`,
    h('section', { class: 'card hero' },
      h('p', { class: 'label' }, 'In the class fund'),
      h('p', { class: 'figure num' }, h('small', {}, 'GH₵'), Number(s.balance).toLocaleString('en-GH', { minimumFractionDigits: 2 })),
      h('p', { class: 'muted' }, `${cedis(s.collected)} collected − ${cedis(s.spent)} spent`)),
    h('div', { class: 'stats' },
      stat('Overdue dues', cedis(s.overdue), 'past their due date'),
      stat('Being checked', cedis(s.awaiting_review), `${s.pending_payments} payment${s.pending_payments === 1 ? '' : 's'}`),
      stat('Collected', cedis(s.collected), 'all time'),
      stat('Spent', cedis(s.spent), 'approved expenses')),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'To do')),
      todo.length ? h('ul', { class: 'list' }, todo.map(([path, ic, title, note]) => h('li', {},
        h('a', { class: 'notice', href: `#/${path}`, style: null },
          h('span', { class: 'ic' }, icon(ic)),
          h('span', {}, h('span', { class: 'item-title' }, title), h('br'), h('span', { class: 'small muted' }, note))))))
        : empty('Nothing waiting. All caught up.', 'check')),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Dues by month'), h('span', { class: 'muted' }, 'last 12 months')),
      s.monthly.length ? duesChart(s.monthly) : empty('No dues have been generated yet.')));
}

// ---------------------------------------------------------------- payments
const REVIEW_SELECT = '*, members(full_name, member_code, profile_id), payment_allocations(round, amount, dues_months(period)), payment_reviews(round, reviewer_id, decision, note, created_at), receipts(receipt_number)';

export async function review(route) {
  const tab = route.params.get('tab') || 'waiting';
  await loadCounts();
  const statuses = { waiting: ['pending'], sent: ['correction_requested'], done: ['approved', 'rejected'] }[tab] || ['pending'];
  let q = sb.from('payments').select(REVIEW_SELECT).in('status', statuses)
    .order(tab === 'done' ? 'decided_at' : 'submitted_at', { ascending: tab !== 'done' });
  if (tab === 'done') q = q.limit(60);
  const [pays, people] = await Promise.all([run(q), profilesById()]);
  const me = state.session.user.id;

  const tabs = h('div', { class: 'segmented', role: 'tablist' },
    [['waiting', 'Waiting', counts.pending_payments], ['sent', 'Sent back'], ['done', 'Decided']].map(([k, label, n]) =>
      h('label', { onclick: () => go(`admin/review?tab=${k}`) },
        h('input', { type: 'radio', name: 'tab', checked: tab === k }), h('span', {}, label), n != null ? h('small', {}, `${n} open`) : null)));

  const card = (p) => {
    const months = p.payment_allocations.filter((a) => a.round === p.review_round)
      .sort((a, b) => a.dues_months.period.localeCompare(b.dues_months.period));
    const reviews = p.payment_reviews.filter((r) => r.round === p.review_round);
    const mine = reviews.find((r) => r.reviewer_id === me);
    const own = p.members.profile_id === me || p.submitted_by === me;
    const approvals = reviews.filter((r) => r.decision === 'approve').length;

    const act = (decision) => async (e) => {
      const btn = e.currentTarget;
      let note = null;
      if (decision === 'approve') {
        const ok = await ask({ title: `Approve ${cedis(p.amount)}?`, confirm: 'Yes, I found it',
          body: `Only approve if you can see ${NETWORKS[p.network].name} reference ${p.transaction_id} for ${cedis(p.amount)} on the statement.` });
        if (!ok) return;
      } else {
        note = await ask(decision === 'reject'
          ? { title: 'Reject this payment?', confirm: 'Reject', danger: true, body: 'It is rejected only if a second admin also rejects it.',
              note: { label: 'Reason (the member will see this)', required: true, placeholder: 'e.g. No such transaction on the MTN statement' } }
          : { title: 'Send back to the member?', confirm: 'Send back', body: 'They can correct it and resend. Approvals so far are cleared.',
              note: { label: 'What should they fix?', required: true, placeholder: 'e.g. The statement shows GH₵40 — add November too' } });
        if (!note) return;
      }
      await busy(btn, async () => {
        const result = await rpc('review_payment', { p_payment: p.id, p_decision: decision, p_note: note });
        toast({ approved: 'Approved — receipt issued.', rejected: 'Rejected by two admins.', correction_requested: 'Sent back to the member.' }[result]
          || 'Your review is recorded. One more admin needed.');
        go(`admin/review?tab=${tab}`);
      });
    };

    return h('li', { class: 'stack' },
      h('div', { class: 'spread' },
        h('div', {},
          h('p', { class: 'item-title' }, p.members.full_name, ' ', h('span', { class: 'muted small mono nowrap' }, p.members.member_code)),
          h('p', { class: 'small muted' }, months.map((a) => monthLabel(a.dues_months.period)).join(', '))),
        h('div', { class: 'r' }, h('p', { class: 'item-title num' }, cedis(p.amount)), chip(p.status))),
      h('div', { class: 'row wrap' },
        networkTag(p.network),
        h('span', { class: 'txn' }, p.transaction_id,
          h('button', { type: 'button', onclick: () => copyText(p.transaction_id, 'Reference copied') }, 'Copy'))),
      h('dl', { class: 'kv small' },
        h('dt', {}, 'Sent'), h('dd', {}, `${dateLabel(p.paid_on)} at ${timeLabel(p.paid_time)}`),
        p.sender_number ? [h('dt', {}, 'From'), h('dd', { class: 'mono' }, p.sender_number)] : null,
        h('dt', {}, 'Recorded'), h('dd', {}, `${relative(p.submitted_at)}${p.review_round > 1 ? ` · resent (round ${p.review_round})` : ''}`),
        p.status_note ? [h('dt', {}, 'Note'), h('dd', {}, p.status_note)] : null,
        p.receipts ? [h('dt', {}, 'Receipt'), h('dd', {}, h('a', { href: `#/receipt/${p.id}` }, p.receipts.receipt_number))] : null),
      reviews.length ? h('div', { class: 'reviews' }, reviews.map((r) =>
        h('span', { class: `chip ${r.decision === 'approve' ? 'paid' : r.decision === 'reject' ? 'overdue' : 'needs_correction'}`, title: r.note || '' },
          icon(r.decision === 'approve' ? 'check' : r.decision === 'reject' ? 'x' : 'back'),
          `${shortName(people.get(r.reviewer_id))} ${r.decision === 'approve' ? 'approved' : r.decision === 'reject' ? 'rejected' : 'sent back'}`))) : null,
      p.status !== 'pending' ? null
        : own ? h('p', { class: 'small muted' }, 'This is your own payment, so other admins must review it.')
        : mine ? h('p', { class: 'small muted' }, `You ${mine.decision === 'approve' ? 'approved' : 'rejected'} this. ${approvals === 1 ? 'Waiting for a second admin.' : 'Waiting for another admin to decide.'}`)
        : h('div', { class: 'row wrap' },
            h('button', { class: 'btn primary small', type: 'button', onclick: act('approve') }, icon('check'), approvals ? 'Approve (2nd)' : 'Approve'),
            h('button', { class: 'btn small', type: 'button', onclick: act('request_correction') }, 'Send back'),
            h('button', { class: 'btn small danger', type: 'button', onclick: act('reject') }, 'Reject')));
  };

  return page('admin/review', 'Payments',
    'Check each reference against the official MoMo statement before approving. Two approvals confirm a payment; two rejections reject it.',
    tabs,
    h('section', { class: 'card' }, pays.length ? h('ul', { class: 'list' }, pays.map(card))
      : empty(tab === 'waiting' ? 'No payments waiting. Nice.' : 'Nothing here.', 'check')));
}

// ---------------------------------------------------------------- members
export async function members() {
  await loadCounts();
  const [roster, people, owed] = await Promise.all([
    fetchAll(() => sb.from('members').select('*').order('full_name')),
    profilesById(),
    fetchAll(() => sb.from('dues_overview').select('member_id, amount_due, state').in('state', ['overdue', 'open'])),
  ]);
  const me = state.session.user.id;
  const owing = new Map();
  for (const d of owed) {
    const o = owing.get(d.member_id) || { overdue: 0, open: 0 };
    o[d.state] += Number(d.amount_due);
    owing.set(d.member_id, o);
  }
  const linked = new Map(roster.filter((m) => m.profile_id).map((m) => [m.profile_id, m]));
  const pending = [...people.values()].filter((p) => p.account_status === 'pending');

  const refreshMembers = () => go('admin/members');

  // --- add form
  const nameIn = h('input', { class: 'input', maxlength: '120', autocomplete: 'off' });
  const phoneIn = h('input', { class: 'input', inputmode: 'numeric', maxlength: '10', placeholder: '024xxxxxxx' });
  const added = h('div');
  const addForm = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field-row' }, field('Full name', nameIn), field('Phone (optional)', phoneIn)),
    h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Add and get code'),
    added);
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(addForm.querySelector('button'), async () => {
      const m = await rpc('admin_add_member', { p_full_name: nameIn.value, p_phone: phoneIn.value || null });
      const msg = `Hi ${m.full_name.split(' ')[0]}, your ${GROUP_SHORT} dues code is ${m.member_code}. Register at ${location.origin + location.pathname}#/register`;
      mount(added, h('div', { class: 'alert ok stack' },
        h('p', {}, `${m.full_name} added. Their code:`),
        h('p', { class: 'code-big' }, m.member_code),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn small', type: 'button', onclick: () => copyText(msg, 'Message copied') }, icon('copy'), 'Copy message'),
          h('a', { class: 'btn small', href: `https://wa.me/?text=${encodeURIComponent(msg)}`, target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'))));
      nameIn.value = phoneIn.value = '';
      toast('Member added.');
    });
  });

  // --- sign-ups waiting
  const pendingList = pending.length ? h('ul', { class: 'list' }, pending.map((p) => {
    const m = linked.get(p.id);
    const nameMatch = m && m.full_name.toLowerCase().split(' ')[0] === p.full_name.toLowerCase().split(' ')[0];
    return h('li', { class: 'stack' },
      h('div', { class: 'spread' },
        h('div', {}, h('p', { class: 'item-title' }, p.full_name), h('p', { class: 'small muted' }, `${p.email || ''} · signed up ${relative(p.created_at)}`)),
        chip('pending', 'Waiting')),
      m ? h('p', { class: `small ${nameMatch ? '' : 'alert warn'}` }, 'Used code ', h('span', { class: 'mono' }, m.member_code), ` for “${m.full_name}”.`,
            nameMatch ? '' : ' The names differ — make sure this is the right person.')
        : h('p', { class: 'small alert warn' }, 'No member code linked yet — they can’t be approved until they enter one.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary small', type: 'button', disabled: !m, onclick: (e) => busy(e.currentTarget, async () => {
          await rpc('admin_set_account_status', { p_profile: p.id, p_status: 'active' });
          toast(`${p.full_name} approved.`); refreshMembers();
        }) }, icon('check'), 'Approve'),
        m ? h('button', { class: 'btn small', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          if (!await ask({ title: 'Unlink this code?', body: `${m.member_code} becomes free again for the right person to use.`, confirm: 'Unlink' })) return;
          await rpc('admin_release_member_code', { p_member: m.id });
          toast('Code released.'); refreshMembers();
        }) }, 'Wrong person') : null,
        h('button', { class: 'btn small danger', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          if (!await ask({ title: `Block ${p.full_name}?`, body: 'They will not be able to see anything.', confirm: 'Block', danger: true })) return;
          await rpc('admin_set_account_status', { p_profile: p.id, p_status: 'suspended' });
          toast('Account blocked.'); refreshMembers();
        }) }, 'Block')));
  })) : empty('No sign-ups waiting.', 'users');

  // --- roster
  const search = h('input', { class: 'input', type: 'search', placeholder: 'Search name or code' });
  const tbody = h('tbody');
  const drawRoster = () => {
    const q = search.value.trim().toLowerCase();
    mount(tbody, roster.filter((m) => !q || m.full_name.toLowerCase().includes(q) || m.member_code.toLowerCase().includes(q)).map((m) => {
      const p = m.profile_id ? people.get(m.profile_id) : null;
      const o = owing.get(m.id);
      return h('tr', {},
        h('td', {}, h('b', {}, m.full_name), m.is_active ? '' : h('span', { class: 'muted small' }, ' (left)'),
          h('div', { class: 'tiny muted' }, m.phone || '')),
        h('td', { class: 'mono nowrap' }, m.member_code),
        h('td', {}, p ? h('span', { class: 'row wrap' }, chip(p.account_status === 'active' ? 'paid' : p.account_status === 'pending' ? 'pending' : 'rejected',
            p.account_status === 'active' ? 'Active' : p.account_status === 'pending' ? 'Waiting' : 'Blocked'), p.is_admin ? chip('admin', 'Admin') : null)
          : h('span', { class: 'muted small' }, 'Not registered')),
        h('td', { class: 'r num nowrap' }, o?.overdue ? h('span', { class: 'chip overdue' }, cedis(o.overdue)) : o?.open ? cedis(o.open) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'r' }, h('button', { class: 'btn small ghost', type: 'button', onclick: () => editMember(m, p, me, refreshMembers) }, 'Manage')));
    }));
  };
  search.addEventListener('input', drawRoster);
  drawRoster();

  return page('admin/members', 'Members',
    'Add classmates to the list, share their code, and confirm them when they sign up.',
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Sign-ups waiting'), h('span', { class: 'muted' }, `${pending.length}`)), pendingList),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Add a member')), addForm),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Class list'), h('span', { class: 'muted' }, `${roster.filter((m) => m.is_active).length} active`)),
      search,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Code'), h('th', {}, 'Account'), h('th', { class: 'r' }, 'Owes'), h('th'))),
        tbody))));
}

function editMember(m, p, me, done) {
  const name = h('input', { class: 'input', value: m.full_name, maxlength: '120' });
  const phone = h('input', { class: 'input', value: m.phone || '', inputmode: 'numeric', maxlength: '10' });
  const active = h('input', { type: 'checkbox', checked: m.is_active });
  const err = h('div');
  const action = (label, fn, cls = '') => h('button', { class: `btn small ${cls}`, type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
    await fn(); dlg.close(); dlg.remove(); done();
  }) }, label);

  const self = p?.id === me;
  const dlg = h('dialog', { class: 'sheet' },
    h('h2', {}, m.full_name), h('p', { class: 'small muted mono' }, m.member_code),
    h('div', { class: 'stack', style: null },
      field('Full name', name), field('Phone', phone),
      h('label', { class: 'check' }, active, h('span', {}, 'Still in the group (owes monthly dues)')),
      err,
      h('div', { class: 'row wrap' },
        action('Save', async () => {
          await rpc('admin_update_member', { p_member: m.id, p_full_name: name.value, p_phone: phone.value || null, p_is_active: active.checked });
          toast('Saved.');
        }, 'primary'))),
    p && !self ? h('div', { class: 'stack' }, h('hr', { class: 'divider' }), h('h3', {}, 'Account'),
      h('p', { class: 'small muted' }, `${p.email || ''}`),
      h('div', { class: 'row wrap' },
        p.account_status === 'active'
          ? action('Block account', () => rpc('admin_set_account_status', { p_profile: p.id, p_status: 'suspended' }), 'danger')
          : action('Activate account', () => rpc('admin_set_account_status', { p_profile: p.id, p_status: 'active' })),
        p.account_status === 'active'
          ? action(p.is_admin ? 'Remove admin' : 'Make admin', () => rpc('admin_set_admin', { p_profile: p.id, p_is_admin: !p.is_admin }))
          : null,
        action('Unlink code', () => rpc('admin_release_member_code', { p_member: m.id })))) : null,
    self ? h('p', { class: 'small muted' }, 'This is you. Another admin must change your account.') : null,
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => { dlg.close(); dlg.remove(); } }, 'Close')));
  dlg.querySelector('.stack').style.marginTop = '14px';
  document.body.append(dlg);
  dlg.showModal();
}

// ---------------------------------------------------------------- expenses
export async function expenses() {
  await loadCounts();
  const [list, people] = await Promise.all([
    run(sb.from('expenses').select('*, expense_reviews(reviewer_id, decision, note)').order('spent_on', { ascending: false }).limit(200)),
    profilesById(),
  ]);
  const me = state.session.user.id;

  const desc = h('input', { class: 'input', maxlength: '300' });
  const cat = h('input', { class: 'input', maxlength: '40', list: 'expense-cats', placeholder: 'e.g. Welfare' });
  const amt = h('input', { class: 'input', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal' });
  const date = h('input', { class: 'input', type: 'date', max: todayAccra(), value: todayAccra() });
  const ref = h('input', { class: 'input', maxlength: '120', placeholder: 'MoMo reference, receipt no., who received it' });
  const err = h('div');
  const formEl = h('form', { class: 'stack', novalidate: true },
    field('What was it for?', desc),
    h('div', { class: 'field-row' }, field('Category', cat), field('Amount (GH₵)', amt)),
    h('div', { class: 'field-row' }, field('Date spent', date), field('Reference / evidence', ref)),
    h('datalist', { id: 'expense-cats' }, ['Welfare', 'Funeral', 'Wedding', 'Get-together', 'Gift', 'Transport', 'Bank / MoMo charges', 'Other'].map((c) => h('option', { value: c }))),
    err,
    h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Record expense'),
    h('p', { class: 'small muted' }, 'Two other admins must approve it before it comes out of the balance.'));
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    mount(err);
    busy(formEl.querySelector('button[type=submit]'), async () => {
      try {
        await rpc('record_expense', { p_description: desc.value, p_category: cat.value, p_amount: Number(amt.value), p_spent_on: date.value, p_reference: ref.value || null });
      } catch (ex) { mount(err, errorBox(ex.message)); return; }
      toast('Expense recorded.');
      go('admin/expenses');
    });
  });

  const item = (x) => {
    const mine = x.expense_reviews.find((r) => r.reviewer_id === me);
    const recorder = x.recorded_by === me;
    const decide = (decision) => async (e) => {
      const btn = e.currentTarget;
      let note = null;
      if (decision === 'reject') {
        note = await ask({ title: 'Reject this expense?', confirm: 'Reject', danger: true,
          note: { label: 'Reason', required: true } });
        if (!note) return;
      } else if (!await ask({ title: `Approve ${cedis(x.amount)}?`, body: 'Approve only if you’ve seen the evidence for this spending.', confirm: 'Approve' })) return;
      await busy(btn, async () => {
        const st = await rpc('review_expense', { p_expense: x.id, p_decision: decision, p_note: note });
        toast(st === 'pending' ? 'Recorded. One more admin needed.' : `Expense ${st}.`);
        go('admin/expenses');
      });
    };
    return h('li', { class: 'stack' },
      h('div', { class: 'spread' },
        h('div', {}, h('p', { class: 'item-title' }, x.description),
          h('p', { class: 'small muted' }, `${x.category} · ${dateLabel(x.spent_on)} · recorded by ${shortName(people.get(x.recorded_by))}`)),
        h('div', { class: 'r' }, h('p', { class: 'item-title num' }, cedis(x.amount)), chip(x.status === 'pending' ? 'pending' : x.status, x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Rejected'))),
      x.reference ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Ref: '), x.reference) : null,
      x.expense_reviews.length ? h('div', { class: 'reviews' }, x.expense_reviews.map((r) =>
        h('span', { class: `chip ${r.decision === 'approve' ? 'paid' : 'overdue'}`, title: r.note || '' },
          `${shortName(people.get(r.reviewer_id))} ${r.decision === 'approve' ? 'approved' : 'rejected'}`))) : null,
      x.status !== 'pending' ? null
        : recorder ? h('p', { class: 'small muted' }, 'You recorded this, so two other admins review it.')
        : mine ? h('p', { class: 'small muted' }, 'You’ve reviewed this. Waiting for another admin.')
        : h('div', { class: 'row wrap' },
            h('button', { class: 'btn small primary', type: 'button', onclick: decide('approve') }, icon('check'), 'Approve'),
            h('button', { class: 'btn small danger', type: 'button', onclick: decide('reject') }, 'Reject')));
  };

  return page('admin/expenses', 'Expenses', 'Every cedi spent from the fund, with who recorded and who approved it.',
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Record spending')), formEl),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Ledger')),
      list.length ? h('ul', { class: 'list' }, list.map(item)) : empty('No expenses recorded yet.', 'wallet')));
}

// ---------------------------------------------------------------- reports
export async function reports() {
  await loadCounts();
  const year = Number(todayAccra().slice(0, 4));
  const yearSel = h('select', { class: 'input' },
    [year + 1, year, year - 1, year - 2].map((y) => h('option', { value: y, selected: y === year }, y)));

  const btn = (label, note, build) => h('li', { class: 'spread' },
    h('div', {}, h('p', { class: 'item-title' }, label), h('p', { class: 'small muted' }, note)),
    h('button', { class: 'btn small', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
      const sheets = await build(Number(yearSel.value));
      downloadXlsx(`C19-dues-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${yearSel.value}.xlsx`, sheets);
    }) }, icon('download'), 'Excel'));

  return page('admin/reports', 'Reports', 'Excel files built from confirmed records. Amounts in Ghana cedis; times are Ghana time.',
    h('section', { class: 'card stack' },
      field('Year', yearSel, 'Registers and statements cover this calendar year.'),
      h('ul', { class: 'list' },
        btn('Dues register', 'Every member × every month: paid, overdue, due or being checked.', async (y) => [await registerSheet(y)]),
        btn('Outstanding', 'Who owes what, overdue first. Good for reminders.', async () => [await outstandingSheet()]),
        btn('Payments and reviews', 'All payments with the two admins who decided each one.', async (y) => [await paymentsSheet(y)]),
        btn('Expense ledger', 'All spending with its approvals.', async (y) => [await expensesSheet(y)]),
        btn('Financial statement', 'Month by month: collected, spent, running balance.', async (y) => [await statementSheet(y)]),
        btn('Everything', 'All of the above in one workbook.', async (y) => [
          await statementSheet(y), await registerSheet(y), await outstandingSheet(), await paymentsSheet(y), await expensesSheet(y)]))));
}

function preamble(title, period) {
  return [
    [`${GROUP_SHORT} (${SCHOOL}) — ${title}`],
    [`Period: ${period}`],
    ['Currency: Ghana cedi (GHS)'],
    [`Generated: ${dateTimeLabel(new Date())} (Ghana time) by ${state.profile.full_name}`],
  ];
}

async function registerSheet(y) {
  const [roster, dues] = await Promise.all([
    fetchAll(() => sb.from('members').select('id, full_name, member_code, is_active').order('full_name')),
    fetchAll(() => sb.from('dues_overview').select('member_id, period, amount_due, state').gte('period', `${y}-01-01`).lte('period', `${y}-12-01`)),
  ]);
  const by = new Map(dues.map((d) => [`${d.member_id}|${d.period.slice(5, 7)}`, d]));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  const rows = roster.map((m) => {
    let paid = 0, owed = 0;
    const cells = months.map((mm) => {
      const d = by.get(`${m.id}|${mm}`);
      if (!d) return '';
      if (d.state === 'paid') paid += Number(d.amount_due);
      else if (d.state === 'overdue' || d.state === 'open') owed += Number(d.amount_due);
      return stateText(d.state);
    });
    return [m.full_name, m.member_code, ...cells, paid, owed];
  });
  const sum = (i) => rows.reduce((t, r) => t + Number(r[i] || 0), 0);
  return {
    name: `Register ${y}`,
    preamble: preamble('Dues register', String(y)),
    columns: [{ header: 'Member', width: 26 }, { header: 'Code', width: 11 },
      ...months.map((mm) => ({ header: monthLabel(`${y}-${mm}-01`).slice(0, 3), width: 12 })),
      { header: 'Paid', width: 12, type: 'money' }, { header: 'Owed', width: 12, type: 'money' }],
    rows,
    totals: ['Total', '', ...months.map(() => ''), sum(14), sum(15)],
  };
}

async function outstandingSheet() {
  const [roster, dues] = await Promise.all([
    fetchAll(() => sb.from('members').select('id, full_name, member_code, phone')),
    fetchAll(() => sb.from('dues_overview').select('member_id, period, amount_due, state').in('state', ['overdue', 'open']).order('period')),
  ]);
  const byMember = new Map();
  for (const d of dues) {
    const e = byMember.get(d.member_id) || { overdue: [], open: [] };
    e[d.state].push(d);
    byMember.set(d.member_id, e);
  }
  const rows = roster.filter((m) => byMember.has(m.id)).map((m) => {
    const e = byMember.get(m.id);
    const total = [...e.overdue, ...e.open].reduce((t, d) => t + Number(d.amount_due), 0);
    return [m.full_name, m.member_code, m.phone || '', e.overdue.length, e.overdue.map((d) => monthLabel(d.period)).join(', '),
      e.open.map((d) => monthLabel(d.period)).join(', '), total];
  }).sort((a, b) => b[3] - a[3] || b[6] - a[6]);
  return {
    name: 'Outstanding',
    preamble: preamble('Outstanding dues', `as at ${dateLabel(todayAccra())}`),
    columns: [{ header: 'Member', width: 26 }, { header: 'Code', width: 11 }, { header: 'Phone', width: 13 },
      { header: 'Months overdue', width: 15, type: 'int' }, { header: 'Overdue months', width: 40 },
      { header: 'Due, not yet overdue', width: 22 }, { header: 'Total owed', width: 14, type: 'money' }],
    rows,
    totals: ['Total', '', '', rows.reduce((t, r) => t + r[3], 0), '', '', rows.reduce((t, r) => t + r[6], 0)],
  };
}

async function paymentsSheet(y) {
  const [pays, people] = await Promise.all([
    fetchAll(() => sb.from('payments').select(REVIEW_SELECT).gte('paid_on', `${y}-01-01`).lte('paid_on', `${y}-12-31`).order('paid_on')),
    profilesById(),
  ]);
  const rows = pays.map((p) => {
    const reviews = p.payment_reviews.filter((r) => r.round === p.review_round);
    const who = (d) => reviews.filter((r) => r.decision === d).map((r) => people.get(r.reviewer_id)?.full_name || '?').join(', ');
    return [dateLabel(p.paid_on), timeLabel(p.paid_time), p.members.full_name, p.members.member_code, NETWORKS[p.network].name,
      p.transaction_id, p.sender_number || '', p.amount,
      p.payment_allocations.filter((a) => a.round === p.review_round).map((a) => monthLabel(a.dues_months.period)).sort().join(', '),
      stateText(p.status), who('approve'), who('reject'), p.status_note || '', p.receipts?.receipt_number || '',
      p.decided_at ? dateTimeLabel(p.decided_at) : ''];
  });
  const approved = pays.filter((p) => p.status === 'approved').reduce((t, p) => t + Number(p.amount), 0);
  return {
    name: `Payments ${y}`,
    preamble: [...preamble('Payments and reviews', String(y)), ['Only rows with status “Confirmed” count as collections.']],
    columns: [{ header: 'Date sent', width: 13 }, { header: 'Time', width: 7 }, { header: 'Member', width: 24 }, { header: 'Code', width: 11 },
      { header: 'Network', width: 13 }, { header: 'Transaction ID', width: 20 }, { header: 'Sent from', width: 13 },
      { header: 'Amount', width: 12, type: 'money' }, { header: 'Months', width: 30 }, { header: 'Status', width: 13 },
      { header: 'Approved by', width: 26 }, { header: 'Rejected by', width: 20 }, { header: 'Note', width: 30 },
      { header: 'Receipt', width: 16 }, { header: 'Decided', width: 18 }],
    rows,
    totals: ['Confirmed total', '', '', '', '', '', '', approved],
  };
}

async function expensesSheet(y) {
  const [list, people] = await Promise.all([
    fetchAll(() => sb.from('expenses').select('*, expense_reviews(reviewer_id, decision, note)').gte('spent_on', `${y}-01-01`).lte('spent_on', `${y}-12-31`).order('spent_on')),
    profilesById(),
  ]);
  const name = (id) => people.get(id)?.full_name || '?';
  const rows = list.map((x) => [dateLabel(x.spent_on), x.description, x.category, x.amount, x.reference || '', name(x.recorded_by),
    x.status[0].toUpperCase() + x.status.slice(1),
    x.expense_reviews.filter((r) => r.decision === 'approve').map((r) => name(r.reviewer_id)).join(', '),
    x.expense_reviews.filter((r) => r.decision === 'reject').map((r) => `${name(r.reviewer_id)}: ${r.note || ''}`).join('; ')]);
  return {
    name: `Expenses ${y}`,
    preamble: [...preamble('Expense ledger', String(y)), ['Only “Approved” rows reduce the balance.']],
    columns: [{ header: 'Date', width: 13 }, { header: 'Description', width: 36 }, { header: 'Category', width: 14 },
      { header: 'Amount', width: 12, type: 'money' }, { header: 'Reference', width: 24 }, { header: 'Recorded by', width: 20 },
      { header: 'Status', width: 11 }, { header: 'Approved by', width: 26 }, { header: 'Rejections', width: 30 }],
    rows,
    totals: ['Approved total', '', '', list.filter((x) => x.status === 'approved').reduce((t, x) => t + Number(x.amount), 0)],
  };
}

async function statementSheet(y) {
  const [pays, exps] = await Promise.all([
    fetchAll(() => sb.from('payments').select('amount, decided_at').eq('status', 'approved')),
    fetchAll(() => sb.from('expenses').select('amount, spent_on').eq('status', 'approved')),
  ]);
  // Collections count in the month they were confirmed; expenses in the month spent.
  const monthOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra' }).format(new Date(ts)).slice(0, 7);
  const start = `${y}-01`;
  let opening = 0;
  const inn = new Map(), out = new Map();
  for (const p of pays) {
    const m = monthOf(p.decided_at);
    if (m < start) opening += Number(p.amount); else inn.set(m, (inn.get(m) || 0) + Number(p.amount));
  }
  for (const x of exps) {
    const m = x.spent_on.slice(0, 7);
    if (m < start) opening -= Number(x.amount); else out.set(m, (out.get(m) || 0) + Number(x.amount));
  }
  let bal = opening;
  const last = Math.min(12, y < Number(todayAccra().slice(0, 4)) ? 12 : Number(todayAccra().slice(5, 7)));
  const rows = [];
  for (let i = 1; i <= Math.max(last, 0); i++) {
    const m = `${y}-${String(i).padStart(2, '0')}`;
    const a = inn.get(m) || 0, b = out.get(m) || 0;
    bal += a - b;
    rows.push([monthLabel(`${m}-01`), a, b, a - b, bal]);
  }
  const tin = rows.reduce((t, r) => t + r[1], 0), tout = rows.reduce((t, r) => t + r[2], 0);
  return {
    name: `Statement ${y}`,
    preamble: [...preamble('Financial statement', String(y)),
      ['Collections are counted in the month two admins confirmed them; expenses in the month spent. Built from dues records, not the MoMo wallet balance.'],
      [`Brought forward from before ${y}: ${cedis(opening)}`]],
    columns: [{ header: 'Month', width: 18 }, { header: 'Collected', width: 14, type: 'money' }, { header: 'Spent', width: 14, type: 'money' },
      { header: 'Net', width: 14, type: 'money' }, { header: 'Balance', width: 14, type: 'money' }],
    rows,
    totals: ['Total', tin, tout, tin - tout, bal],
  };
}

// ---------------------------------------------------------------- settings
export async function settings() {
  await loadCounts();
  const s = await run(sb.from('group_settings').select('*').eq('id', 1).single());
  const dues = h('input', { class: 'input', type: 'number', min: '1', step: '0.5', value: s.monthly_dues });
  const day = h('input', { class: 'input', type: 'number', min: '1', max: '28', value: s.due_day });
  const start = h('input', { class: 'input', type: 'month', value: s.dues_start.slice(0, 7) });
  const momo = h('textarea', { class: 'input', rows: '4', maxlength: '600', placeholder: 'e.g. Send to 024 123 4567 (MTN) — name shows as KOFI MENSAH. Use your member code as the reference.' }, s.momo_instructions || '');
  const show = h('input', { type: 'checkbox', checked: s.show_balance_to_members });
  const err = h('div');

  const formEl = h('form', { class: 'stack', novalidate: true },
    h('div', { class: 'field-row' },
      field('Monthly dues (GH₵)', dues, 'New amount applies to months created from now on.'),
      field('Due day', day, 'Month M is due on this day of month M+1.')),
    field('Dues start from', start, 'Everyone, including late joiners, owes every month from here.'),
    field('Payment instructions for members', momo, 'Shown on the Pay page. Include the MoMo number(s) and the account name.'),
    h('label', { class: 'check' }, show, h('span', {}, 'Show members the class fund total (collected, spent, balance)')),
    err,
    h('button', { class: 'btn primary', type: 'submit' }, 'Save settings'));
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    mount(err);
    busy(formEl.querySelector('button[type=submit]'), async () => {
      try {
        await rpc('admin_update_settings', {
          p_monthly_dues: Number(dues.value), p_due_day: Number(day.value), p_dues_start: `${start.value}-01`,
          p_momo_instructions: momo.value, p_show_balance: show.checked,
        });
      } catch (ex) { mount(err, errorBox(ex.message)); return; }
      state.settings = await run(sb.from('group_settings').select('*').eq('id', 1).single());
      toast('Settings saved.');
    });
  });

  return page('admin/settings', 'Settings', 'Changes are recorded in the audit log with your name.',
    h('section', { class: 'card' }, formEl),
    h('section', { class: 'card stack' },
      h('h2', {}, 'Monthly dues'),
      h('p', { class: 'small muted' }, `Dues for each month are created automatically every morning at 8:00 for every active member. Use this if you need them now — it never creates duplicates.`),
      h('button', { class: 'btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        const n = await rpc('admin_generate_dues', { p_through: thisMonth() });
        toast(n ? `Created ${n} month${n > 1 ? 's' : ''} of dues.` : 'Everyone is already up to date.');
      }) }, `Create dues up to ${monthLabel(thisMonth())}`)));
}

// ---------------------------------------------------------------- audit
const ACTIONS = {
  'payment.submitted': 'recorded a payment', 'payment.resubmitted': 'resent a corrected payment',
  'payment.review.approve': 'approved a payment', 'payment.review.reject': 'rejected a payment',
  'payment.review.request_correction': 'sent a payment back', 'payment.approved': 'payment confirmed (2 approvals)',
  'payment.rejected': 'payment rejected (2 rejections)', 'expense.recorded': 'recorded an expense',
  'expense.review.approve': 'approved an expense', 'expense.review.reject': 'rejected an expense',
  'member.added': 'added a member', 'member.updated': 'edited a member', 'member_code.claimed': 'linked a member code',
  'member_code.failed': 'entered a wrong member code', 'member_code.released': 'unlinked a member code',
  'account.active': 'activated an account', 'account.suspended': 'blocked an account', 'account.pending': 'set an account to waiting',
  'admin.granted': 'made someone an admin', 'admin.revoked': 'removed an admin', 'settings.updated': 'changed settings',
  'dues.generated': 'created monthly dues',
};

export async function audit() {
  await loadCounts();
  const [logs, people] = await Promise.all([
    run(sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300)),
    profilesById(),
  ]);
  const detail = (l) => {
    const d = l.details || {};
    if (l.target_table === 'profiles' && l.target_id) return people.get(l.target_id)?.full_name;
    if (d.amount != null) return `${cedis(d.amount)}${d.txn ? ` · ${d.txn}` : ''}${d.receipt ? ` · ${d.receipt}` : ''}`;
    if (d.name) return `${d.name}${d.code ? ` (${d.code})` : ''}`;
    if (d.note) return `“${d.note}”`;
    if (d.created != null) return `${d.created} rows`;
    return '';
  };
  return page('admin/audit', 'Audit log', 'The last 300 actions. Nothing here can be edited or deleted.',
    h('section', { class: 'card' },
      logs.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'Who'), h('th', {}, 'What'), h('th', {}, 'Details'))),
        h('tbody', {}, logs.map((l) => h('tr', {},
          h('td', { class: 'nowrap small' }, dateTimeLabel(l.created_at)),
          h('td', {}, l.actor_id ? people.get(l.actor_id)?.full_name || '—' : 'System'),
          h('td', {}, ACTIONS[l.action] || l.action),
          h('td', { class: 'small' }, detail(l)))))))
        : empty('Nothing recorded yet.')));
}
