import { sb, state, rpc, run, fetchAll, currentAllocations, loadSettings } from '../api.js';
import {
  h, icon, chip, cedis, cedisFigure, monthLabel, monthShort, dateLabel, dateTimeLabel, timeLabel, relative, todayAccra,
  isoDateAccra, thisMonth, toast, busy, ask, sheet, form, stat, empty, field, mount, copyText, networkTag, NETWORKS,
  stateText, plural, firstName, OWING_STATES,
} from '../ui.js';
import { go } from '../nav.js';
import { duesChart } from '../chart.js';
import { downloadXlsx } from '../xlsx.js';
import { GROUP_SHORT, SCHOOL } from '../config.js';

// ---------------------------------------------------------------- shared
// Badge counts and the profile list are shared by every admin page. They are
// cached briefly and dropped after any write, so moving between pages doesn't
// re-download them on a phone's data connection.
const CACHE_MS = 60_000;
const cache = new Map();
function cached(key, load, fresh = false) {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}
let counts = null;
const loadCounts = (fresh) => cached('counts', () => rpc('finance_summary'), fresh).then((c) => (counts = c));

// Every admin write goes through here so cached counts and names are refreshed.
async function write(fn, args) {
  const result = await rpc(fn, args);
  cache.clear();
  return result;
}

function subnav(current) {
  const c = counts || {};
  const items = [
    ['admin', 'Overview'],
    ['admin/review', 'Payments', c.pending_payments],
    ['admin/members', 'Members', (c.pending_accounts || 0) + (c.pending_roles || 0)],
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

const profilesById = () => cached('profiles', async () => {
  const rows = await fetchAll(() => sb.from('profiles').select('id, full_name, email, is_admin, account_status, created_at').order('created_at'));
  return new Map(rows.map((p) => [p.id, p]));
});
const shortName = (p) => firstName(p?.full_name) || 'Someone';

// How each review decision reads on a chip.
const DECISION = {
  approve: { chip: 'paid', icon: 'check', verb: 'approved' },
  reject: { chip: 'overdue', icon: 'x', verb: 'rejected' },
  request_correction: { chip: 'needs_correction', icon: 'back', verb: 'sent back' },
};
const reviewChip = (r, people) => h('span', { class: `chip ${DECISION[r.decision].chip}`, title: r.note || '' },
  icon(DECISION[r.decision].icon), `${shortName(people.get(r.reviewer_id))} ${DECISION[r.decision].verb}`);

const ACCOUNT = { active: ['paid', 'Active'], pending: ['pending', 'Waiting'], suspended: ['rejected', 'Blocked'] };
const EXPENSE = { pending: 'Waiting', approved: 'Approved', rejected: 'Rejected' };

// ---------------------------------------------------------------- overview
export async function dashboard() {
  const s = await loadCounts(true);
  const todo = [
    s.pending_payments && ['admin/review', 'pay', `${plural(s.pending_payments, 'payment')} to check`, `${cedis(s.awaiting_review)} waiting`],
    s.pending_accounts && ['admin/members', 'users', `${plural(s.pending_accounts, 'sign-up')} to confirm`, 'New members waiting for approval'],
    s.pending_expenses && ['admin/expenses', 'wallet', `${plural(s.pending_expenses, 'expense')} to review`, 'Needs two admins other than the recorder'],
    s.pending_roles && ['admin/members', 'shield', `${plural(s.pending_roles, 'admin change')} to confirm`, 'Another admin proposed it; a second admin must agree'],
  ].filter(Boolean);

  return page('admin', 'Overview', `${s.active_members} active members · figures count confirmed payments and approved expenses only.`,
    h('section', { class: 'card hero' },
      h('p', { class: 'label' }, 'In the class fund'),
      h('p', { class: 'figure num' }, h('small', {}, 'GH₵'), cedisFigure(s.balance)),
      h('p', { class: 'muted' }, `${cedis(s.collected)} collected − ${cedis(s.spent)} spent`)),
    h('div', { class: 'stats' },
      stat('Overdue dues', cedis(s.overdue), 'past their due date'),
      stat('Being checked', cedis(s.awaiting_review), plural(s.pending_payments, 'payment')),
      stat('Collected', cedis(s.collected), 'all time'),
      stat('Spent', cedis(s.spent), 'approved expenses')),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'To do')),
      todo.length ? h('ul', { class: 'list' }, todo.map(([path, ic, title, note]) => h('li', {},
        h('a', { class: 'notice', href: `#/${path}` },
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
  const statuses = { waiting: ['pending'], sent: ['correction_requested'], done: ['approved', 'rejected'] }[tab] || ['pending'];
  let q = sb.from('payments').select(REVIEW_SELECT).in('status', statuses)
    .order(tab === 'done' ? 'decided_at' : 'submitted_at', { ascending: tab !== 'done' });
  if (tab === 'done') q = q.limit(60);
  const [pays, people] = await Promise.all([run(q), profilesById(), loadCounts()]);
  const me = state.session.user.id;

  const tabs = h('div', { class: 'segmented', role: 'tablist' },
    [['waiting', 'Waiting', counts.pending_payments], ['sent', 'Sent back'], ['done', 'Decided']].map(([k, label, n]) =>
      h('label', { onclick: () => go(`admin/review?tab=${k}`) },
        h('input', { type: 'radio', name: 'tab', checked: tab === k }), h('span', {}, label), n != null ? h('small', {}, `${n} open`) : null)));

  const card = (p) => {
    const months = currentAllocations(p);
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
        const result = await write('review_payment', { p_payment: p.id, p_decision: decision, p_note: note });
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
      reviews.length ? h('div', { class: 'reviews' }, reviews.map((r) => reviewChip(r, people))) : null,
      p.status !== 'pending' ? null
        : own ? h('p', { class: 'small muted' }, 'This is your own payment, so other admins must review it.')
        : mine ? h('p', { class: 'small muted' }, `You ${DECISION[mine.decision].verb} this. ${approvals === 1 ? 'Waiting for a second admin.' : 'Waiting for another admin to decide.'}`)
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
  const [roster, people, owed, proposals] = await Promise.all([
    fetchAll(() => sb.from('members').select('*').order('full_name')),
    profilesById(),
    fetchAll(() => sb.from('dues_overview').select('member_id, amount_due, state').in('state', OWING_STATES)),
    rpc('admin_open_role_proposals'),
    loadCounts(),
  ]);
  const proposalFor = new Map(proposals.map((x) => [x.profile_id, x]));
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
      const m = await write('admin_add_member', { p_full_name: nameIn.value, p_phone: phoneIn.value || null });
      const msg = `Hi ${firstName(m.full_name)}, your ${GROUP_SHORT} dues code is ${m.member_code}. Register at ${location.origin + location.pathname}#/register`;
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
    const nameMatch = m && firstName(m.full_name).toLowerCase() === firstName(p.full_name).toLowerCase();
    return h('li', { class: 'stack' },
      h('div', { class: 'spread' },
        h('div', {}, h('p', { class: 'item-title' }, p.full_name), h('p', { class: 'small muted' }, `${p.email || ''} · signed up ${relative(p.created_at)}`)),
        chip('pending', 'Waiting')),
      m ? h('p', { class: `small ${nameMatch ? '' : 'alert warn'}` }, 'Used code ', h('span', { class: 'mono' }, m.member_code), ` for “${m.full_name}”.`,
            nameMatch ? '' : ' The names differ — make sure this is the right person.')
        : h('p', { class: 'small alert warn' }, 'No member code linked yet — they can’t be approved until they enter one.'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary small', type: 'button', disabled: !m, onclick: (e) => busy(e.currentTarget, async () => {
          await write('admin_set_account_status', { p_profile: p.id, p_status: 'active' });
          toast(`${p.full_name} approved.`); refreshMembers();
        }) }, icon('check'), 'Approve'),
        m ? h('button', { class: 'btn small', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          if (!await ask({ title: 'Unlink this code?', body: `${m.member_code} becomes free again for the right person to use.`, confirm: 'Unlink' })) return;
          await write('admin_release_member_code', { p_member: m.id });
          toast('Code released.'); refreshMembers();
        }) }, 'Wrong person') : null,
        h('button', { class: 'btn small danger', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
          if (!await ask({ title: `Block ${p.full_name}?`, body: 'They will not be able to see anything.', confirm: 'Block', danger: true })) return;
          await write('admin_set_account_status', { p_profile: p.id, p_status: 'suspended' });
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
        h('td', {}, p ? h('span', { class: 'row wrap' }, chip(...ACCOUNT[p.account_status]), p.is_admin ? chip('admin', 'Admin') : null)
          : h('span', { class: 'muted small' }, 'Not registered')),
        h('td', { class: 'r num nowrap' }, o?.overdue ? h('span', { class: 'chip overdue' }, cedis(o.overdue)) : o?.open ? cedis(o.open) : h('span', { class: 'muted' }, '—')),
        h('td', { class: 'r' }, h('button', { class: 'btn small ghost', type: 'button', onclick: () => editMember(m, p, me, refreshMembers, proposalFor.get(p?.id), people) },
          proposalFor.has(p?.id) ? h('span', { class: 'badge-dot', 'aria-label': 'Admin change waiting' }) : null, 'Manage')));
    }));
  };
  search.addEventListener('input', drawRoster);
  drawRoster();

  return page('admin/members', 'Members',
    'Add classmates to the list, share their code, and confirm them when they sign up.',
    proposals.length ? h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Admin changes to confirm')),
      h('ul', { class: 'list' }, proposals.map((x) => {
        const target = people.get(x.profile_id);
        const mineProp = x.proposed_by === me;
        return h('li', { class: 'spread' },
          h('div', {}, h('p', { class: 'item-title' }, `${x.make_admin ? 'Make' : 'Remove'} ${target?.full_name || 'someone'} ${x.make_admin ? 'an admin' : 'as admin'}`),
            h('p', { class: 'small muted' }, `Proposed by ${people.get(x.proposed_by)?.full_name || 'an admin'} ${relative(x.created_at)}`)),
          mineProp || x.profile_id === me ? h('span', { class: 'small muted' }, mineProp ? 'Waiting for another admin' : 'About you')
            : roleButton(target, x, me, people, refreshMembers));
      }))) : null,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Admins'), h('span', { class: 'muted' }, 'changes need two admins')),
      h('ul', { class: 'list' }, [...people.values()].filter((p) => p.is_admin).map((p) => h('li', { class: 'spread' },
        h('div', {}, h('p', { class: 'item-title' }, p.full_name, p.id === me ? h('span', { class: 'muted small' }, ' (you)') : null),
          h('p', { class: 'small muted' }, p.account_status === 'active' ? p.email || '' : 'Account blocked — remove admin rights to finish')),
        p.id === me ? null : roleButton(p, proposalFor.get(p.id), me, people, refreshMembers))))),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Sign-ups waiting'), h('span', { class: 'muted' }, `${pending.length}`)), pendingList),
    h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Add a member')), addForm),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Class list'), h('span', { class: 'muted' }, `${roster.filter((m) => m.is_active).length} active`)),
      search,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Code'), h('th', {}, 'Account'), h('th', { class: 'r' }, 'Owes'), h('th'))),
        tbody))));
}

// Admin rights change only when a second admin confirms a proposal.
function roleButton(p, proposal, me, people, done) {
  const make = !p.is_admin;
  const open = proposal && proposal.make_admin === make;
  if (open && proposal.proposed_by === me) return h('span', { class: 'small muted' }, 'You proposed this; waiting for another admin.');
  const label = open ? `Confirm ${shortName(people.get(proposal.proposed_by))}’s proposal`
                     : make ? 'Propose as admin' : 'Propose removing admin';
  return h('button', { class: `btn small ${open ? 'primary' : ''}`, type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
    if (open && !await ask({ title: 'Confirm this change?', body: 'Admins approve payments and expenses. Only confirm if the class executives agreed.', confirm: 'Confirm' })) return;
    const r = await write('admin_change_role', { p_profile: p.id, p_make_admin: make });
    toast(r === 'done' ? 'Done — two admins agreed.' : 'Proposed. Another admin must confirm.');
    done();
  }) }, label);
}

function editMember(m, p, me, done, proposal, people) {
  const name = h('input', { class: 'input', value: m.full_name, maxlength: '120' });
  const phone = h('input', { class: 'input', value: m.phone || '', inputmode: 'numeric', maxlength: '10' });
  const active = h('input', { type: 'checkbox', checked: m.is_active });
  const finish = () => { close(); done(); };
  const action = (label, fn, cls = '') => h('button', { class: `btn small ${cls}`, type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
    await fn(); finish();
  }) }, label);

  const self = p?.id === me;
  const { close } = sheet(null,
    h('h2', {}, m.full_name), h('p', { class: 'small muted mono' }, m.member_code),
    h('div', { class: 'stack sheet-body' },
      field('Full name', name), field('Phone', phone),
      h('label', { class: 'check' }, active, h('span', {}, 'Still in the group (owes monthly dues)')),
      h('div', { class: 'row wrap' },
        action('Save', async () => {
          await write('admin_update_member', { p_member: m.id, p_full_name: name.value, p_phone: phone.value || null, p_is_active: active.checked });
          toast('Saved.');
        }, 'primary'))),
    p && !self ? h('div', { class: 'stack' }, h('hr', { class: 'divider' }), h('h3', {}, 'Account'),
      h('p', { class: 'small muted' }, p.is_admin ? `${p.email || ''} · admin — remove admin rights before blocking` : `${p.email || ''}`),
      h('div', { class: 'row wrap' },
        p.is_admin ? null
          : p.account_status === 'active'
            ? action('Block account', () => write('admin_set_account_status', { p_profile: p.id, p_status: 'suspended' }), 'danger')
            : action('Activate account', () => write('admin_set_account_status', { p_profile: p.id, p_status: 'active' })),
        p.account_status === 'active' || p.is_admin ? roleButton(p, proposal, me, people, finish) : null,
        action('Unlink code', () => write('admin_release_member_code', { p_member: m.id })))) : null,
    self ? h('p', { class: 'small muted' }, 'This is you. Another admin must change your account.') : null,
    h('div', { class: 'sheet-actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, 'Close')));
}

// ---------------------------------------------------------------- expenses
export async function expenses() {
  const [list, people] = await Promise.all([
    run(sb.from('expenses').select('*, expense_reviews(reviewer_id, decision, note)').order('spent_on', { ascending: false }).limit(200)),
    profilesById(),
    loadCounts(),
  ]);
  const me = state.session.user.id;

  const desc = h('input', { class: 'input', maxlength: '300' });
  const cat = h('input', { class: 'input', maxlength: '40', list: 'expense-cats', placeholder: 'e.g. Welfare' });
  const amt = h('input', { class: 'input', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal' });
  const date = h('input', { class: 'input', type: 'date', max: todayAccra(), value: todayAccra() });
  const ref = h('input', { class: 'input', maxlength: '120', placeholder: 'MoMo reference, receipt no., who received it' });
  const formEl = form(async () => {
    await write('record_expense', { p_description: desc.value, p_category: cat.value, p_amount: Number(amt.value), p_spent_on: date.value, p_reference: ref.value || null });
    toast('Expense recorded.');
    go('admin/expenses');
  },
    field('What was it for?', desc),
    h('div', { class: 'field-row' }, field('Category', cat), field('Amount (GH₵)', amt)),
    h('div', { class: 'field-row' }, field('Date spent', date), field('Reference / evidence', ref)),
    h('datalist', { id: 'expense-cats' }, ['Welfare', 'Funeral', 'Wedding', 'Get-together', 'Gift', 'Transport', 'Bank / MoMo charges', 'Other'].map((c) => h('option', { value: c }))),
    h('button', { class: 'btn primary', type: 'submit' }, icon('plus'), 'Record expense'),
    h('p', { class: 'small muted' }, 'Two other admins must approve it before it comes out of the balance.'));

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
        const st = await write('review_expense', { p_expense: x.id, p_decision: decision, p_note: note });
        toast(st === 'pending' ? 'Recorded. One more admin needed.' : `Expense ${st}.`);
        go('admin/expenses');
      });
    };
    return h('li', { class: 'stack' },
      h('div', { class: 'spread' },
        h('div', {}, h('p', { class: 'item-title' }, x.description),
          h('p', { class: 'small muted' }, `${x.category} · ${dateLabel(x.spent_on)} · recorded by ${shortName(people.get(x.recorded_by))}`)),
        h('div', { class: 'r' }, h('p', { class: 'item-title num' }, cedis(x.amount)), chip(x.status, EXPENSE[x.status]))),
      x.reference ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Ref: '), x.reference) : null,
      x.expense_reviews.length ? h('div', { class: 'reviews' }, x.expense_reviews.map((r) => reviewChip(r, people))) : null,
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

  // Each sheet takes the year and a loader that fetches each dataset once per download,
  // so the "Everything" workbook shares data between its sheets.
  const btn = (label, note, builders) => h('li', { class: 'spread' },
    h('div', {}, h('p', { class: 'item-title' }, label), h('p', { class: 'small muted' }, note)),
    h('button', { class: 'btn small', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
      const y = Number(yearSel.value);
      const data = reportData(y);
      const sheets = await Promise.all(builders.map((b) => b(y, data)));
      downloadXlsx(`C19-dues-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${y}.xlsx`, sheets);
    }) }, icon('download'), 'Excel'));

  return page('admin/reports', 'Reports', 'Excel files built from confirmed records. Amounts in Ghana cedis; times are Ghana time.',
    h('section', { class: 'card stack' },
      field('Year', yearSel, 'Registers and statements cover this calendar year.'),
      h('ul', { class: 'list' },
        btn('Dues register', 'Every member × every month: paid, overdue, due or being checked.', [registerSheet]),
        btn('Outstanding', 'Who owes what, overdue first. Good for reminders.', [outstandingSheet]),
        btn('Payments and reviews', 'All payments with the two admins who decided each one.', [paymentsSheet]),
        btn('Expense ledger', 'All spending with its approvals.', [expensesSheet]),
        btn('Financial statement', 'Month by month: collected, spent, running balance.', [statementSheet]),
        btn('Everything', 'All of the above in one workbook.',
          [statementSheet, registerSheet, outstandingSheet, paymentsSheet, expensesSheet]))));
}

function reportData(y) {
  const memo = new Map();
  const once = (key, load) => () => { if (!memo.has(key)) memo.set(key, load()); return memo.get(key); };
  return {
    roster: once('roster', () => fetchAll(() => sb.from('members').select('id, full_name, member_code, phone, is_active').order('full_name'))),
    owing: once('owing', () => fetchAll(() => sb.from('dues_overview').select('member_id, period, amount_due, state').in('state', OWING_STATES).order('period'))),
    yearDues: once('yearDues', () => fetchAll(() => sb.from('dues_overview').select('member_id, period, amount_due, state').gte('period', `${y}-01-01`).lte('period', `${y}-12-01`))),
    payments: once('payments', () => fetchAll(() => sb.from('payments').select(REVIEW_SELECT).gte('paid_on', `${y}-01-01`).lte('paid_on', `${y}-12-31`).order('paid_on'))),
    expenses: once('expenses', () => fetchAll(() => sb.from('expenses').select('*, expense_reviews(reviewer_id, decision, note)').gte('spent_on', `${y}-01-01`).lte('spent_on', `${y}-12-31`).order('spent_on'))),
    approvedPayments: once('approvedPayments', () => fetchAll(() => sb.from('payments').select('amount, decided_at').eq('status', 'approved'))),
    approvedExpenses: once('approvedExpenses', () => fetchAll(() => sb.from('expenses').select('amount, spent_on').eq('status', 'approved'))),
    people: profilesById,
  };
}

function preamble(title, period) {
  return [
    [`${GROUP_SHORT} (${SCHOOL}) — ${title}`],
    [`Period: ${period}`],
    ['Currency: Ghana cedi (GHS)'],
    [`Generated: ${dateTimeLabel(new Date())} (Ghana time) by ${state.profile.full_name}`],
  ];
}

async function registerSheet(y, data) {
  const [roster, dues] = await Promise.all([data.roster(), data.yearDues()]);
  const by = new Map(dues.map((d) => [`${d.member_id}|${d.period.slice(5, 7)}`, d]));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
  let totalPaid = 0, totalOwed = 0;
  const rows = roster.map((m) => {
    let paid = 0, owed = 0;
    const cells = months.map((mm) => {
      const d = by.get(`${m.id}|${mm}`);
      if (!d) return '';
      if (d.state === 'paid') paid += Number(d.amount_due);
      else if (OWING_STATES.includes(d.state)) owed += Number(d.amount_due);
      return stateText(d.state);
    });
    totalPaid += paid;
    totalOwed += owed;
    return [m.full_name, m.member_code, ...cells, paid, owed];
  });
  return {
    name: `Register ${y}`,
    preamble: preamble('Dues register', String(y)),
    columns: [{ header: 'Member', width: 26 }, { header: 'Code', width: 11 },
      ...months.map((mm) => ({ header: monthShort(`${y}-${mm}-01`), width: 12 })),
      { header: 'Paid', width: 12, type: 'money' }, { header: 'Owed', width: 12, type: 'money' }],
    rows,
    totals: ['Total', '', ...months.map(() => ''), totalPaid, totalOwed],
  };
}

async function outstandingSheet(y, data) {
  const [roster, dues] = await Promise.all([data.roster(), data.owing()]);
  const byMember = new Map();
  for (const d of dues) {
    const e = byMember.get(d.member_id) || { overdue: [], open: [], total: 0 };
    e[d.state].push(d);
    e.total += Number(d.amount_due);
    byMember.set(d.member_id, e);
  }
  const owing = roster.filter((m) => byMember.has(m.id)).map((m) => ({ m, ...byMember.get(m.id) }))
    .sort((a, b) => b.overdue.length - a.overdue.length || b.total - a.total);
  const labels = (list) => list.map((d) => monthLabel(d.period)).join(', ');
  return {
    name: 'Outstanding',
    preamble: preamble('Outstanding dues', `as at ${dateLabel(todayAccra())}`),
    columns: [{ header: 'Member', width: 26 }, { header: 'Code', width: 11 }, { header: 'Phone', width: 13 },
      { header: 'Months overdue', width: 15, type: 'int' }, { header: 'Overdue months', width: 40 },
      { header: 'Due, not yet overdue', width: 22 }, { header: 'Total owed', width: 14, type: 'money' }],
    rows: owing.map((o) => [o.m.full_name, o.m.member_code, o.m.phone || '', o.overdue.length, labels(o.overdue), labels(o.open), o.total]),
    totals: ['Total', '', '', owing.reduce((t, o) => t + o.overdue.length, 0), '', '', owing.reduce((t, o) => t + o.total, 0)],
  };
}

async function paymentsSheet(y, data) {
  const [pays, people] = await Promise.all([data.payments(), data.people()]);
  const rows = pays.map((p) => {
    const reviews = p.payment_reviews.filter((r) => r.round === p.review_round);
    const who = (d) => reviews.filter((r) => r.decision === d).map((r) => people.get(r.reviewer_id)?.full_name || '?').join(', ');
    return [dateLabel(p.paid_on), timeLabel(p.paid_time), p.members.full_name, p.members.member_code, NETWORKS[p.network].name,
      p.transaction_id, p.sender_number || '', p.amount,
      currentAllocations(p).map((a) => monthLabel(a.dues_months.period)).join(', '),
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

async function expensesSheet(y, data) {
  const [list, people] = await Promise.all([data.expenses(), data.people()]);
  const name = (id) => people.get(id)?.full_name || '?';
  const rows = list.map((x) => [dateLabel(x.spent_on), x.description, x.category, x.amount, x.reference || '', name(x.recorded_by),
    EXPENSE[x.status],
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

async function statementSheet(y, data) {
  const [pays, exps] = await Promise.all([data.approvedPayments(), data.approvedExpenses()]);
  // Collections count in the month they were confirmed; expenses in the month spent.
  const start = `${y}-01`;
  let opening = 0;
  const inn = new Map(), out = new Map();
  for (const p of pays) {
    const m = isoDateAccra(p.decided_at).slice(0, 7);
    if (m < start) opening += Number(p.amount); else inn.set(m, (inn.get(m) || 0) + Number(p.amount));
  }
  for (const x of exps) {
    const m = x.spent_on.slice(0, 7);
    if (m < start) opening -= Number(x.amount); else out.set(m, (out.get(m) || 0) + Number(x.amount));
  }
  const [thisYear, thisMonthNum] = todayAccra().split('-').map(Number);
  const last = y < thisYear ? 12 : y > thisYear ? 0 : thisMonthNum;
  let bal = opening, tin = 0, tout = 0;
  const rows = [];
  for (let i = 1; i <= last; i++) {
    const m = `${y}-${String(i).padStart(2, '0')}`;
    const a = inn.get(m) || 0, b = out.get(m) || 0;
    bal += a - b; tin += a; tout += b;
    rows.push([monthLabel(`${m}-01`), a, b, a - b, bal]);
  }
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
  const s = state.settings;
  const dues = h('input', { class: 'input', type: 'number', min: '1', step: '0.5', value: s.monthly_dues });
  const day = h('input', { class: 'input', type: 'number', min: '1', max: '28', value: s.due_day });
  const start = h('input', { class: 'input', type: 'month', value: s.dues_start.slice(0, 7) });
  const momo = h('textarea', { class: 'input', rows: '4', maxlength: '600', placeholder: 'e.g. Send to 024 123 4567 (MTN) — name shows as KOFI MENSAH. Use your member code as the reference.' }, s.momo_instructions || '');
  const show = h('input', { type: 'checkbox', checked: s.show_balance_to_members });

  const formEl = form(async () => {
    await write('admin_update_settings', {
      p_monthly_dues: Number(dues.value), p_due_day: Number(day.value), p_dues_start: `${start.value}-01`,
      p_momo_instructions: momo.value, p_show_balance: show.checked,
    });
    state.settings = await loadSettings();
    toast('Settings saved.');
  },
    h('div', { class: 'field-row' },
      field('Monthly dues (GH₵)', dues, 'New amount applies to months created from now on.'),
      field('Due day', day, 'Month M is due on this day of month M+1.')),
    field('Dues start from', start, 'Everyone, including late joiners, owes every month from here.'),
    field('Payment instructions for members', momo, 'Shown on the Pay page. Include the MoMo number(s) and the account name.'),
    h('label', { class: 'check' }, show, h('span', {}, 'Show members the class fund total (collected, spent, balance)')),
    h('button', { class: 'btn primary', type: 'submit' }, 'Save settings'));

  return page('admin/settings', 'Settings', 'Changes are recorded in the audit log with your name.',
    h('section', { class: 'card' }, formEl),
    h('section', { class: 'card stack' },
      h('h2', {}, 'Monthly dues'),
      h('p', { class: 'small muted' }, 'Dues for each month are created automatically every morning at 8:00 for every active member. Use this if you need them now — it never creates duplicates.'),
      h('button', { class: 'btn', type: 'button', onclick: (e) => busy(e.currentTarget, async () => {
        const n = await write('admin_generate_dues', { p_through: thisMonth() });
        toast(n ? `Created ${plural(n, 'month')} of dues.` : 'Everyone is already up to date.');
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
  'admin.granted': 'confirmed a new admin', 'admin.revoked': 'confirmed removing an admin',
  'admin.grant_proposed': 'proposed a new admin', 'admin.revoke_proposed': 'proposed removing an admin',
  'settings.updated': 'changed settings',
  'dues.generated': 'created monthly dues',
};

export async function audit() {
  const [logs, people] = await Promise.all([
    run(sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300)),
    profilesById(),
    loadCounts(),
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
