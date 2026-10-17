import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
    // Passkeys are marked experimental in supabase-js; this opts in.
    experimental: { passkey: true },
  },
});

// Passkeys need WebAuthn and a secure page (https or localhost).
export const passkeysSupported = () =>
  window.isSecureContext && typeof window.PublicKeyCredential === 'function' && !!navigator.credentials?.create;

const PASSKEY_ERRORS = {
  passkey_disabled: 'Passkeys aren’t switched on for this site yet. Use your password for now.',
  too_many_passkeys: 'You already have the most passkeys allowed. Remove one first.',
  webauthn_credential_exists: 'This device already has a passkey for your account.',
  ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED: 'This device already has a passkey for your account.',
  webauthn_credential_not_found: 'That passkey isn’t on any account here any more. Sign in with your password, then set up a new one.',
  webauthn_challenge_not_found: 'That took too long. Please try again.',
  webauthn_challenge_expired: 'That took too long. Please try again.',
  webauthn_verification_failed: 'The passkey couldn’t be checked. Please try again.',
  ERROR_CEREMONY_ABORTED: 'Passkey cancelled.',
  ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY: 'Passkey cancelled or timed out.',
};

// Errors raised by our database functions (code P0001) are written for
// members to read. Anything else gets a generic message; details go to the console.
export function friendlyError(error) {
  if (!error) return '';
  if (error.code === 'P0001' && error.message) return error.message;
  if (PASSKEY_ERRORS[error.code]) return PASSKEY_ERRORS[error.code];
  const msg = String(error.message || error);
  if (/does not support WebAuthn/i.test(msg)) return 'This browser can’t use passkeys. Try Chrome, Safari or Edge, or use your password.';
  if (/NotAllowedError|not allowed|timed out|cancel/i.test(msg)) return 'Passkey cancelled or timed out.';
  if (/Invalid login credentials/i.test(msg)) return 'That email and password don’t match.';
  if (/Email not confirmed/i.test(msg)) return 'Confirm your email first — check your inbox for the link.';
  if (/User already registered/i.test(msg)) return 'An account with that email already exists. Sign in instead.';
  if (/Password should be/i.test(msg)) return 'Use a password of at least 8 characters.';
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/Failed to fetch|NetworkError|network/i.test(msg)) return 'No connection. Check your data or Wi-Fi and try again.';
  console.error(error);
  return 'Something went wrong. Please try again.';
}

function unwrap({ data, error }) {
  if (error) throw new Error(friendlyError(error));
  return data;
}

export const rpc = async (fn, args) => unwrap(await sb.rpc(fn, args));
export const run = async (query) => unwrap(await query);

// PostgREST returns at most 1000 rows per request; page through larger tables.
export async function fetchAll(build, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const page = unwrap(await build().range(from, from + pageSize - 1));
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// ---- session state shared by the views ----
export const state = { session: null, profile: null, member: null, settings: null };

export const loadSettings = () => run(sb.from('group_settings').select('*').eq('id', 1).single());

// A payment's months for its current review round, oldest first.
export const currentAllocations = (p) => p.payment_allocations
  .filter((a) => a.round === p.review_round)
  .sort((a, b) => a.dues_months.period.localeCompare(b.dues_months.period));

export async function loadIdentity() {
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  state.profile = state.member = null;
  if (!session) return state;
  const uid = session.user.id;
  const [profile, member, settings] = await Promise.all([
    run(sb.from('profiles').select('*').eq('id', uid).maybeSingle()),
    run(sb.from('members').select('*').eq('profile_id', uid).maybeSingle()),
    loadSettings(),
  ]);
  Object.assign(state, { profile, member, settings });
  return state;
}

export const isAdmin = () => state.profile?.is_admin && state.profile?.account_status === 'active';
export const isActive = () => state.profile?.account_status === 'active';
