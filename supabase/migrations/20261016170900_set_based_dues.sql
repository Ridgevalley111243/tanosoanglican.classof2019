-- Migration 10: set-based dues work (efficiency review).
--
-- * generate_dues: one insert for all members instead of a loop.
-- * due_date: a plain SQL function Postgres can inline (settings are readable
--   by every signed-in user, so it doesn't need SECURITY DEFINER).
-- * dues_overview: one lateral lookup of the current-round payment per row
--   instead of two function calls, and the due date computed inline.
-- * run_daily_jobs: reminders written with set-based inserts.

create or replace function private.generate_dues(p_through date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_created integer;
begin
  insert into public.dues_months (member_id, period, amount_due)
  select m.id, gs.period::date, s.monthly_dues
    from public.members m
   cross join public.group_settings s
   cross join lateral generate_series(s.dues_start, date_trunc('month', p_through)::date, interval '1 month') as gs(period)
   where m.is_active
  on conflict (member_id, period) do nothing;
  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

create or replace function public.due_date(p_period date)
returns date language sql stable security invoker set search_path = ''
as $$
  select (date_trunc('month', p_period) + interval '1 month')::date + (s.due_day - 1)
  from public.group_settings s where s.id = 1
$$;

create or replace view public.dues_overview with (security_invoker = true) as
select d.id,
       d.member_id,
       d.period,
       d.amount_due,
       d.paid_at,
       d.payment_id,
       (date_trunc('month', d.period) + interval '1 month')::date + (s.due_day - 1) as due_on,
       case
         when d.paid_at is not null then 'paid'
         when r.in_review then 'in_review'
         when r.needs_fix then 'needs_correction'
         when (date_trunc('month', d.period) + interval '1 month')::date + (s.due_day - 1) < private.today() then 'overdue'
         when d.period > date_trunc('month', private.today())::date then 'upcoming'
         else 'open'
       end as state
from public.dues_months d
join public.group_settings s on s.id = 1
left join lateral (
  select bool_or(p.status = 'pending') as in_review,
         bool_or(p.status = 'correction_requested') as needs_fix
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id and a.round = p.review_round
   where a.dues_month_id = d.id
) r on true;

-- Unpaid months of active members that no payment is currently claiming.
create or replace function private.unpaid_unclaimed()
returns table (period date, amount_due numeric, profile_id uuid, due date)
language sql stable security definer set search_path = ''
as $$
  select d.period, d.amount_due, m.profile_id,
         (date_trunc('month', d.period) + interval '1 month')::date + (s.due_day - 1)
    from public.dues_months d
    join public.group_settings s on s.id = 1
    join public.members m on m.id = d.member_id and m.is_active
    join public.profiles p on p.id = m.profile_id and p.account_status = 'active'
   where d.paid_at is null
     and not private.month_in_review(d.id, array['pending', 'correction_requested']::public.payment_status[])
$$;
revoke execute on function private.unpaid_unclaimed() from public, anon, authenticated;

create or replace function private.run_daily_jobs()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := private.today();
begin
  perform private.generate_dues(v_today);

  -- Five days before, and on, the due date: one notice per month.
  insert into public.notifications (profile_id, kind, title, body, dedupe_key)
  select u.profile_id, 'reminder',
         private.month_label(u.period) || case when v_today < u.due then ' dues' else ' dues are due' end,
         private.cedis(u.amount_due) ||
           case when v_today < u.due then ' is due on ' || to_char(u.due, 'FMDay FMDD Mon') || '.'
                when v_today = u.due then ' was due today.'
                else ' was due ' || to_char(u.due, 'FMDay FMDD Mon') || '.' end,
         case when v_today < u.due then 'before:' else 'due:' end || u.period
    from private.unpaid_unclaimed() u
   where v_today between u.due - 5 and u.due + 2
  on conflict (profile_id, dedupe_key) do nothing;

  -- Overdue: one summary per member per calendar month, from 3 days after a due date.
  insert into public.notifications (profile_id, kind, title, body, dedupe_key)
  select u.profile_id, 'overdue', 'Overdue dues',
         'You have ' || count(*) || ' overdue month' || case when count(*) > 1 then 's' else '' end ||
         ' (' || private.cedis(sum(u.amount_due)) || ').',
         'overdue:' || to_char(v_today, 'YYYY-MM')
    from private.unpaid_unclaimed() u
   where u.due + 3 <= v_today
   group by u.profile_id
  on conflict (profile_id, dedupe_key) do nothing;
end;
$$;
