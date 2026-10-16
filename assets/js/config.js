// Public settings. The publishable key is safe in the browser: every table is
// protected by row level security and every write goes through a checked
// database function. Never put the service_role key (or any secret) here.
export const SUPABASE_URL = 'https://ypliibgdetwgbdlxjirg.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_KA9LlmnLClNFiJQ8AGWJSw_w32oDtm_';

export const GROUP_SHORT = 'Class of 2019';
export const SCHOOL = 'Tanoso Anglican J.H.S “A”';
export const TIME_ZONE = 'Africa/Accra';

// Date of the current terms and privacy policy. Changing it asks every signed-in
// person to agree again, so change it whenever views/legal.js changes in substance.
export const TERMS_VERSION = '2026-10-16';
