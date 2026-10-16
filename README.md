# Class of 2019 Dues — Tanoso Anglican J.H.S "A"

A mobile-first website for collecting the class's monthly dues by Mobile Money.
Members record what they sent; two admins confirm it against the MoMo statement;
the member gets a receipt.

- **Site:** plain HTML, CSS and JavaScript, hosted on GitHub Pages. No build step.
- **Backend:** Supabase (Auth + Postgres). Project `ypliibgdetwgbdlxjirg` ("Class of 2019 Dues", London region).

## Rules the system enforces

| Rule | Where |
|---|---|
| GH₵20 a month. Month M is due on the 5th of month M+1 (October dues by 5 November). | `group_settings` (changeable in Admin → Settings) |
| No part payments. One payment can cover several whole months, up to 12 months ahead. | `submit_payment` |
| A payment is confirmed by **two different admins**, and rejected by **two different admins**. One admin can send it back for correction. A split vote waits for a third admin. | `review_payment` |
| Nobody reviews their own payment, so the group needs **at least three admins**. | `review_payment` |
| Expenses need two approvals from admins **other than the one who recorded it**. | `review_expense` |
| Members are identified by a member code (e.g. `C19-7KQ4M`) that an admin issues. New accounts wait for an admin's approval. | `handle_new_user`, `admin_set_account_status` |
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
4. **Make the first two admins:** both register on the site like everyone else, then run in the SQL editor
   (replace the emails):
   ```sql
   update public.profiles set is_admin = true, account_status = 'active'
   where email in ('first@example.com', 'second@example.com');
   ```
   After that, admin rights are changed from Admin → Members → Manage: one admin proposes, another confirms.
   Make at least three admins, since nobody can review their own payment.
5. **Before members join:** set the MoMo instructions in Admin → Settings and check the
   dues start month (currently October 2026).
6. **Add the class list** in Admin → Members. Each person gets a code to share (there's a WhatsApp button).

Dues rows are created automatically every day at 08:00 Ghana time (a `pg_cron` job), which also
sends in-app reminders 5 days before the due date, on it, and when dues are 3+ days overdue.

## Testing the database

Paste `supabase/tests/rules_test.sql` into the Supabase SQL editor and run it. It creates fictional
admins and members, walks through every rule above, and rolls everything back. The last line should read
`ALL 20 CHECKS PASSED (rolled back)` (it is reported as an error on purpose — that is what undoes the changes).

## Checking the site

`tools/check.sh` lints the JavaScript, syntax-checks every module, then opens every page in headless
Chromium against fake data (`tools/smoke.mjs`) and fails on any page error. It saves screenshots
to the folder you pass it. Cloud sessions of Claude Code run `.claude/hooks/session-start.sh` first,
which confirms the tools are present.

## Notes

- Times are shown in Ghana time (GMT, no daylight saving).
- Password-reset links must be opened in the same browser that asked for them.
- Receipts print cleanly (or save as PDF) from the browser's print menu.
