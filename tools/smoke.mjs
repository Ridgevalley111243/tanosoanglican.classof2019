// Smoke test: drives the real site in headless Chromium with a fake Supabase
// backend (fixture data below), screenshots each page and fails on any page error.
//
//   node tools/smoke.mjs <out-dir> <member|admin|anon> <route,route,...>
//   e.g. node tools/smoke.mjs /tmp/shots admin admin,admin/review
//
// Uses the globally installed Playwright and the preinstalled Chromium.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  try {
    const body = await readFile(join(ROOT, path || 'index.html'));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;
const OUT = process.argv[2] || '/tmp/shots';
const who = process.argv[3] || 'member';

const YAW = 'aaaaaaaa-0000-4000-8000-000000000001';
const AMA = 'aaaaaaaa-0000-4000-8000-000000000002';
const KOFI = 'aaaaaaaa-0000-4000-8000-000000000003';
const uid = who === 'admin' ? AMA : YAW;

const profiles = [
  { id: YAW, full_name: 'Yaw Mensah', email: 'yaw.mensah@gmail.com', is_admin: false, account_status: 'active', created_at: '2026-02-02T10:00:00Z' },
  { id: AMA, full_name: 'Ama Boateng', email: 'ama.b@gmail.com', is_admin: true, account_status: 'active', created_at: '2026-01-05T10:00:00Z' },
  { id: KOFI, full_name: 'Kofi Asante', email: 'kofi@yahoo.com', is_admin: true, account_status: 'active', created_at: '2026-01-05T10:00:00Z' },
  { id: 'p4', full_name: 'Abena Owusu', email: 'abena.owusu@gmail.com', is_admin: false, account_status: 'pending', created_at: '2026-10-16T09:12:00Z' },
];
const members = [
  { id: 'm1', member_code: 'C19-7KQ4M', full_name: 'Yaw Mensah', phone: '0241234567', profile_id: YAW, is_active: true },
  { id: 'm2', member_code: 'C19-H3XPA', full_name: 'Ama Boateng', phone: '0209876543', profile_id: AMA, is_active: true },
  { id: 'm3', member_code: 'C19-R8DNE', full_name: 'Kofi Asante', phone: null, profile_id: KOFI, is_active: true },
  { id: 'm4', member_code: 'C19-W2TLC', full_name: 'Abena Owusu', phone: '0551112223', profile_id: 'p4', is_active: true },
  { id: 'm5', member_code: 'C19-QZ9VF', full_name: 'Kwabena Darko', phone: null, profile_id: null, is_active: true },
];
const settings = { id: 1, group_name: 'Class of 2019', monthly_dues: 20, due_day: 5, dues_start: '2026-01-01',
  momo_instructions: 'Send to 024 555 0192 (MTN MoMo) — name shows as KOFI ASANTE.\nUse your member code as the reference.', show_balance_to_members: true };

const months = Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`);
const due = (p) => { const [y, m] = p.split('-').map(Number); return new Date(Date.UTC(y, m, 5)).toISOString().slice(0, 10); };
const dues = [];
members.forEach((m, mi) => months.forEach((p, i) => {
  let st = i < 8 - (mi % 3) * 2 ? 'paid' : p === '2026-10-01' ? 'open' : 'overdue';
  if (m.id === 'm1' && p === '2026-09-01') st = 'overdue';
  dues.push({ id: `${m.id}-${i}`, member_id: m.id, period: p, amount_due: 20, paid_at: st === 'paid' ? '2026-05-01T00:00:00Z' : null, due_on: due(p), state: st });
}));

const pay = (id, mid, name, code, profile, amt, ms, status, txn, net, reviews = [], round = 1, note = null) => ({
  id, member_id: mid, network: net, transaction_id: txn, sender_number: '0241234567', amount: amt, paid_on: '2026-10-15', paid_time: '18:42:00',
  status, review_round: round, status_note: note, submitted_by: profile, submitted_at: '2026-10-16T08:10:00Z', decided_at: status === 'approved' ? '2026-08-12T10:00:00Z' : null,
  members: { full_name: name, member_code: code, profile_id: profile },
  payment_allocations: ms.map((p) => ({ round, amount: 20, dues_month_id: `${mid}-x`, dues_months: { period: p } })),
  payment_reviews: reviews, receipts: status === 'approved' ? { receipt_number: 'C19-2026-00031', issued_at: '2026-08-12T10:00:00Z' } : null,
});
const payments = [
  pay('pay1', 'm4', 'Abena Owusu', 'C19-W2TLC', 'p4', 40, ['2026-07-01', '2026-08-01'], 'pending', '81234567890', 'mtn',
    [{ round: 1, reviewer_id: KOFI, decision: 'approve', note: null, created_at: '2026-10-16T09:00:00Z' }]),
  pay('pay2', 'm3', 'Kofi Asante', 'C19-R8DNE', KOFI, 20, ['2026-09-01'], 'pending', 'TC2610151842', 'telecel'),
  pay('pay3', 'm1', 'Yaw Mensah', 'C19-7KQ4M', YAW, 160, months.slice(0, 8), 'approved', '80091233412', 'mtn'),
];
const notifications = [
  { id: 2, profile_id: YAW, kind: 'overdue', title: 'Overdue dues', body: 'You have 1 overdue month (GH₵20.00).', read_at: null, created_at: '2026-10-08T08:00:00Z' },
  { id: 1, profile_id: YAW, kind: 'payment_approved', title: 'Payment confirmed', body: 'GH₵160.00 for January–August 2026. Receipt C19-2026-00031.', read_at: null, created_at: '2026-08-12T10:00:00Z' },
];
const summary = who === 'admin' ? {
  collected: 1260, spent: 350, balance: 910, overdue: 140, awaiting_review: 60, pending_payments: 2, pending_expenses: 1,
  pending_accounts: 1, pending_roles: 1, active_members: 5,
  monthly: months.map((p, i) => ({ period: p, paid: [100, 100, 100, 100, 100, 80, 80, 60, 40, 20][i], unpaid: [0, 0, 0, 0, 0, 20, 20, 40, 60, 80][i] })),
} : { collected: 1260, spent: 350, balance: 910 };
const expenses = [
  { id: 'e1', description: 'Wreath and donation — funeral of Esi’s father', category: 'Welfare', amount: 350, spent_on: '2026-09-20', reference: 'MoMo 55012, received by Esi', recorded_by: KOFI, status: 'approved', expense_reviews: [{ reviewer_id: AMA, decision: 'approve' }, { reviewer_id: 'x', decision: 'approve' }] },
  { id: 'e2', description: 'Hall deposit for December get-together', category: 'Get-together', amount: 200, spent_on: '2026-10-14', reference: 'Receipt 0042', recorded_by: KOFI, status: 'pending', expense_reviews: [] },
];
const audit = [
  { id: 3, actor_id: KOFI, action: 'payment.review.approve', target_table: 'payments', target_id: 'pay1', details: { round: 1 }, created_at: '2026-10-16T09:00:00Z' },
  { id: 2, actor_id: 'p4', action: 'payment.submitted', target_table: 'payments', target_id: 'pay1', details: { amount: 40, txn: '81234567890' }, created_at: '2026-10-16T08:10:00Z' },
  { id: 1, actor_id: AMA, action: 'member.added', target_table: 'members', target_id: 'm5', details: { name: 'Kwabena Darko', code: 'C19-QZ9VF' }, created_at: '2026-10-15T08:10:00Z' },
];
const tables = { profiles, members, group_settings: [settings], dues_overview: dues, payments, notifications: notifications.filter((n) => n.profile_id === uid), expenses, audit_logs: audit, receipts: [] };

function filter(rows, params) {
  let out = rows;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const val = rest.join('.');
    if (op === 'eq') out = out.filter((r) => String(r[k]) === val);
    else if (op === 'in') { const set = val.replace(/[()]/g, '').split(','); out = out.filter((r) => set.includes(String(r[k]))); }
    else if (op === 'is' && val === 'null') out = out.filter((r) => r[k] == null);
    else if (op === 'gte') out = out.filter((r) => String(r[k]) >= val);
    else if (op === 'lte') out = out.filter((r) => String(r[k]) <= val);
  }
  return out;
}

const fakeJwt = (sub) => ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify({ sub, role: 'authenticated', exp: 4102444800, aud: 'authenticated' })).toString('base64url'), 'sig'].join('.');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: Number(process.env.WIDTH) || 390, height: 844 }, deviceScaleFactor: 2, timezoneId: 'Africa/Accra' });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
// SLOW=1 holds every backend reply for 3 s so the loading skeletons can be screenshotted.
const SLOW = process.env.SLOW === '1';
await ctx.route(/supabase\.co/, async (route) => {
  const req = route.request();
  // Identity lookups stay fast so the page-specific skeleton is what gets captured.
  if (SLOW && !/\/(profiles|members|group_settings)\?/.test(req.url())) await new Promise((r) => setTimeout(r, 3000));
  const url = new URL(req.url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = url.pathname.split('/').pop();
    if (fn === 'finance_summary') return json(summary);
    if (fn === 'admin_open_role_proposals') return json([{ id: 1, profile_id: YAW, make_admin: true, proposed_by: KOFI, created_at: '2026-10-16T07:00:00Z', closed_at: null }]);
    return json(null);
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const t = url.pathname.split('/').pop();
    let rows = filter(tables[t] || [], url.searchParams);
    if (t === 'members' && who !== 'admin') rows = rows.filter((m) => m.profile_id === uid);
    if ((req.headers()['accept'] || '').includes('vnd.pgrst.object')) {
      return rows.length ? json(rows[0]) : json({ code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' }, 406);
    }
    return json(rows);
  }
  if (url.pathname.startsWith('/auth/v1/user')) return json({ id: uid, email: 'x@y.z', aud: 'authenticated', role: 'authenticated' });
  return json({});
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', async (m) => { if (m.type() === 'error') errors.push(m.text() + ' ' + JSON.stringify(m.location())); });

if (who !== 'anon') {
  await page.addInitScript(([key, sess]) => localStorage.setItem(key, sess), ['sb-ypliibgdetwgbdlxjirg-auth-token', JSON.stringify({
    access_token: fakeJwt(uid), token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, refresh_token: 'r',
    user: { id: uid, aud: 'authenticated', role: 'authenticated', email: who === 'admin' ? 'ama.b@gmail.com' : 'yaw.mensah@gmail.com' },
  })]);
}

const routes = (process.argv[4] || 'home').split(',').filter(Boolean);
for (const r of routes) {
  await page.goto(`${BASE}#/${r === "home" ? "" : r}`);
  await page.waitForTimeout(SLOW ? 500 : 900);
  const name = `${process.env.WIDTH ? `w${process.env.WIDTH}-` : ''}${who}-${(r || 'home').replace(/[/?=]/g, '_')}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('shot', name);
}
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
server.close();
process.exitCode = errors.length ? 1 : 0;
