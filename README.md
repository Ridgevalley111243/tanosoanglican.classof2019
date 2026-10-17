# Class of 2019 Dues — Tanoso Anglican J.H.S "A"

A mobile-first website for collecting the class's monthly dues by Mobile Money.
Members record what they sent; two admins confirm it against the MoMo statement;
the member gets a receipt.

- **Site:** plain HTML, CSS and JavaScript, hosted on GitHub Pages. No build step.
- **Backend:** Supabase (Auth + Postgres). Project `ypliibgdetwgbdlxjirg` ("Class of 2019 Dues", London region).

## Rules the system enforces

| Rule | Where |
|---|---|
| GH₵20 a month. Month M is due on the 5th of month M+1 (November dues by 5 December). Dues start from November 2026. | `group_settings` (changeable in Admin → Settings) |
| No part payments. One payment can cover several whole months, up to 12 months ahead. | `submit_payment` |
| A payment is confirmed by **two different admins**, and rejected by **two different admins**. One admin can send it back for correction. A split vote waits for a third admin. | `review_payment` |
| Nobody reviews their own payment, so the group needs **at least three admins**. | `review_payment` |
| Expenses need two approvals from admins **other than the one who recorded it**. | `review_expense` |
| Members register themselves and get a member code (e.g. `C19-7KQ4M`) straight away. Their account waits for an admin's approval and owes nothing until then. Admins can also add classmates and hand out codes. | `handle_new_user`, `admin_set_account_status` |
| Late joiners owe every month since the dues start month. | `ensure_dues` |
| Only confirmed payments count as collections; only approved expenses reduce the balance. | `finance_summary` |
| Giving or removing admin rights takes two admins: one proposes, another confirms within 7 days. | `admin_change_role` |
| Every important action is written to an append-only audit log. | `audit_logs` |

The browser can only **read** tables, and row level security limits members to their
own rows. Every write goes through a database function that checks who is calling.
The site uses only the public (publishable) key — never put the `service_role` key in this repo.

## Layout

```
index.html                 the single page (hash routes: #/pay, #/admin/review, …)
assets/css/app.css         blue-and-white glass styles
assets/js/main.js          routing and page chrome
assets/js/views/           auth.js, member.js, admin.js
assets/js/xlsx.js          Excel export (no formulas are ever written)
assets/js/chart.js         dues-by-month chart
assets/vendor/             supabase-js 2.117.2 (MIT), vendored so there's no CDN dependency
assets/fonts/              Instrument Sans + Serif (OFL), self-hosted
supabase/migrations/       the database, in the order it was applied
supabase/tests/rules_test.sql   end-to-end test of the rules (rolls itself back)
```

## Going live — steps for the project owner

1. **Turn on GitHub Pages:** repo Settings → Pages → *Deploy from a branch* → `main`, folder `/ (root)`.
   The site will be at `https://ridgevalley111243.github.io/tanosoanglican.classof2019/`.
2. **Point Supabase Auth at the site:** Supabase dashboard → Authentication → URL Configuration.
   - Site URL: the GitHub Pages address above.
   - Redirect URLs: add the same address.
3. **Email sending:** Supabase's built-in email sender only allows a few emails per hour —
   not enough to onboard a whole class. Either add your own SMTP (Authentication → Emails → SMTP),
   or turn off "Confirm email" (Authentication → Providers → Email). Turning it off is reasonable here
   because every new account already waits for an admin's approval; password-reset emails still need SMTP to be reliable.
4. **Passkeys:** Supabase dashboard → Authentication → Passkeys → turn on *Enable Passkey authentication*, then set
   - Relying Party Display Name: `Class of 2019 Dues`
   - Relying Party ID: `ridgevalley111243.github.io` (no `https://`, no path)
   - Relying Party Origins: `https://ridgevalley111243.github.io`

   Don't change the Relying Party ID once people have set up passkeys: every existing passkey would stop working.
   Until this is switched on, the "Set up a passkey" button explains that passkeys aren't available yet.
5. **Founding admins (done 16 Oct 2026):** Eunice Achiaa Annor, Kennedy Agyapong and George Danquah
   were set up directly in the database as active admins with member codes. Every later admin change
   is made from Admin → Members → Manage: one admin proposes, another confirms.
6. **Before members join:** set the MoMo instructions in Admin → Settings and check the
   dues start month (November 2026, first due 5 December 2026).
7. **Share the site link** with the class. Each person registers, sees their member code, and waits for an admin to approve them in Admin → Members. Classmates who can't sign up themselves can be added there by an admin (there's a WhatsApp button to send them their code).

Dues rows are created automatically every day at 08:00 Ghana time (a `pg_cron` job), which also
sends in-app reminders 5 days before the due date, on it, and when dues are 3+ days overdue.

## Testing the database

Paste `supabase/tests/rules_test.sql` into the Supabase SQL editor and run it. It creates fictional
admins and members, walks through every rule above, and rolls everything back. The last line should read
`ALL 20 CHECKS PASSED (rolled back)` (it is reported as an error on purpose — that is what undoes the changes).

## Passkeys

Anyone signed in can add a passkey from **Account → Passkeys** (fingerprint, face or screen lock on their phone or
computer), then use **Sign in with a passkey** on the sign-in page. They can rename or remove their passkeys there.
Passwords keep working alongside them. This uses supabase-js's built-in passkey support (marked experimental by Supabase,
opted in in `assets/js/api.js`); the device keeps the private key and Supabase stores only the public key.

## Light and dark mode

A switch in the header (and on the sign-in pages) changes between light and a pure-black dark mode. The choice is saved
on that device; until someone chooses, the site follows the phone or computer setting. Receipts stay
white "paper" in both modes and always print in light colours.

## Fonts

Instrument Sans and Instrument Serif are stored in `assets/fonts` (SIL Open Font License, licence files
included); nothing is loaded from Google. The three files used on the first screen are preloaded. While a
font is still downloading, a device font sized to match is shown, then the real font swaps in without the
text moving (`font-display: swap` plus measured `size-adjust` stand-ins in `app.css`).

## Checking the site

`tools/check.sh` lints the JavaScript, syntax-checks every module, then opens every page in headless
Chromium against fake data (`tools/smoke.mjs`) and fails on any page error. It saves screenshots
to the folder you pass it. Cloud sessions of Claude Code run `.claude/hooks/session-start.sh` first,
which confirms the tools are present.

## Notes

- Times are shown in Ghana time (GMT, no daylight saving).
- Password-reset links must be opened in the same browser that asked for them.
- Receipts print cleanly (or save as PDF) from the browser's print menu.
