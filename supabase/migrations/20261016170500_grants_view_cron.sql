-- Migration 4: who may call what, the dues status view, and scheduled jobs.

-- A month's state as the app shows it. security_invoker makes the view obey
-- the caller's row level security, so members only ever see their own rows.
create view public.dues_overview with (security_invoker = true) as
select d.id,
       d.member_id,
       d.period,
       d.amount_due,
       d.paid_at,
       d.payment_id,
       public.due_date(d.period) as due_on,
       case
         when d.paid_at is not null then 'paid'
         when private.month_in_review(d.id, array['pending']::public.payment_status[]) then 'in_review'
         when private.month_in_review(d.id, array['correction_requested']::public.payment_status[]) then 'needs_correction'
         when public.due_date(d.period) < private.today() then 'overdue'
         when d.period > date_trunc('month', private.today())::date then 'upcoming'
         else 'open'
       end as state
from public.dues_months d;

revoke all on public.dues_overview from anon, authenticated;
grant select on public.dues_overview to authenticated;

-- Functions: nothing for anonymous visitors, and only the app-facing ones for
-- signed-in users. Each function still checks the caller's role itself.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

grant execute on function
  private.today(), private.is_admin(), private.my_member_id(), private.is_active_user(),
  private.month_in_review(uuid, public.payment_status[])
to authenticated;

grant execute on function
  public.due_date(date),
  public.claim_member_code(text),
  public.update_my_name(text),
  public.admin_set_account_status(uuid, public.account_status),
  public.admin_set_admin(uuid, boolean),
  public.admin_add_member(text, text),
  public.admin_update_member(uuid, text, text, boolean),
  public.admin_release_member_code(uuid),
  public.admin_update_settings(numeric, smallint, date, text, boolean),
  public.admin_generate_dues(date),
  public.submit_payment(public.momo_network, text, text, numeric, date, time, date[]),
  public.resubmit_payment(uuid, public.momo_network, text, text, numeric, date, time, date[]),
  public.review_payment(uuid, public.review_decision, text),
  public.record_expense(text, text, numeric, date, text),
  public.review_expense(uuid, public.review_decision, text),
  public.finance_summary(),
  public.mark_notifications_read(bigint[])
to authenticated;

-- Daily at 08:00 Ghana time (UTC): create the month's dues and send reminders.
create extension if not exists pg_cron;
select cron.schedule('daily-dues-jobs', '0 8 * * *', $$select private.run_daily_jobs()$$);
