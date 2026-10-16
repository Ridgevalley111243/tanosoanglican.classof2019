------------------------------------------------------------------------------
-- Expenses
------------------------------------------------------------------------------

create or replace function public.record_expense(p_description text, p_category text, p_amount numeric,
                                                 p_spent_on date, p_reference text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform private.require_admin();
  if p_spent_on is null or p_spent_on > private.today() then
    raise exception 'Enter the date the money was spent (not in the future).' using errcode = 'P0001';
  end if;
  insert into public.expenses (description, category, amount, spent_on, reference, recorded_by)
  values (trim(p_description), trim(p_category), p_amount, p_spent_on, nullif(trim(p_reference), ''), auth.uid())
  returning id into v_id;
  perform private.audit('expense.recorded', 'expenses', v_id::text,
                        jsonb_build_object('amount', p_amount, 'description', trim(p_description)));
  return v_id;
exception when check_violation then
  raise exception 'Check the description, category and amount.' using errcode = 'P0001';
end;
$$;

-- Two admins other than the one who recorded it must agree.
create or replace function public.review_expense(p_expense uuid, p_decision public.review_decision, p_note text default null)
returns public.expense_status language plpgsql security definer set search_path = ''
as $$
declare
  v_exp public.expenses;
  v_approvals int;
  v_rejections int;
begin
  perform private.require_admin();
  if p_decision = 'request_correction' then
    raise exception 'Expenses can only be approved or rejected.' using errcode = 'P0001';
  end if;
  select * into v_exp from public.expenses where id = p_expense for update;
  if not found then
    raise exception 'Expense not found.' using errcode = 'P0001';
  end if;
  if v_exp.status <> 'pending' then
    raise exception 'This expense has already been decided.' using errcode = 'P0001';
  end if;
  if v_exp.recorded_by = auth.uid() then
    raise exception 'You recorded this expense, so two other admins must review it.' using errcode = 'P0001';
  end if;
  if p_decision = 'reject' and nullif(trim(p_note), '') is null then
    raise exception 'Say why you are rejecting it.' using errcode = 'P0001';
  end if;

  begin
    insert into public.expense_reviews (expense_id, reviewer_id, decision, note)
    values (p_expense, auth.uid(), p_decision, left(nullif(trim(p_note), ''), 500));
  exception when unique_violation then
    raise exception 'You have already reviewed this expense.' using errcode = 'P0001';
  end;

  select count(*) filter (where r.decision = 'approve'), count(*) filter (where r.decision = 'reject')
    into v_approvals, v_rejections
    from public.expense_reviews r
    join public.profiles pr on pr.id = r.reviewer_id and pr.is_admin and pr.account_status = 'active'
   where r.expense_id = p_expense;

  if v_approvals >= 2 then
    update public.expenses set status = 'approved', decided_at = now() where id = p_expense;
  elsif v_rejections >= 2 then
    update public.expenses set status = 'rejected', decided_at = now() where id = p_expense;
  end if;

  perform private.audit('expense.review.' || p_decision::text, 'expenses', p_expense::text,
                        jsonb_build_object('note', nullif(trim(p_note), '')));
  return (select status from public.expenses where id = p_expense);
end;
$$;

------------------------------------------------------------------------------
-- Reading helpers
------------------------------------------------------------------------------

-- Totals. Admins get everything; members get the headline numbers if the
-- group has chosen to show them.
create or replace function public.finance_summary()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_collected numeric := (select coalesce(sum(amount), 0) from public.payments where status = 'approved');
  v_spent numeric := (select coalesce(sum(amount), 0) from public.expenses where status = 'approved');
  v_today date := private.today();
begin
  if private.is_admin() then
    return jsonb_build_object(
      'collected', v_collected,
      'spent', v_spent,
      'balance', v_collected - v_spent,
      'overdue', (select coalesce(sum(d.amount_due), 0) from public.dues_months d
                  where d.paid_at is null and public.due_date(d.period) < v_today),
      'awaiting_review', (select coalesce(sum(amount), 0) from public.payments where status = 'pending'),
      'pending_payments', (select count(*) from public.payments where status = 'pending'),
      'pending_expenses', (select count(*) from public.expenses where status = 'pending'),
      'pending_accounts', (select count(*) from public.profiles where account_status = 'pending'),
      'active_members', (select count(*) from public.members where is_active),
      'monthly', (select coalesce(jsonb_agg(row_to_json(x) order by x.period), '[]'::jsonb) from (
                    select d.period,
                           coalesce(sum(d.amount_due) filter (where d.paid_at is not null), 0) as paid,
                           coalesce(sum(d.amount_due) filter (where d.paid_at is null), 0) as unpaid
                      from public.dues_months d
                     where d.period <= date_trunc('month', v_today)::date
                     group by d.period order by d.period desc limit 12) x));
  end if;

  if private.is_active_user()
     and (select show_balance_to_members from public.group_settings where id = 1) then
    return jsonb_build_object('collected', v_collected, 'spent', v_spent, 'balance', v_collected - v_spent);
  end if;
  return null;
end;
$$;

create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void language sql security definer set search_path = ''
as $$
  update public.notifications set read_at = now()
   where profile_id = (select auth.uid()) and read_at is null
     and (p_ids is null or id = any(p_ids));
$$;

-- True when a payment awaiting review or correction currently claims the month.
create or replace function private.month_in_review(p_dues_month uuid, p_statuses public.payment_status[])
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.payment_allocations a
      join public.payments p on p.id = a.payment_id and a.round = p.review_round
     where a.dues_month_id = p_dues_month and p.status = any(p_statuses))
$$;

------------------------------------------------------------------------------
-- Scheduled jobs (called by pg_cron, never through the API)
------------------------------------------------------------------------------

create or replace function private.run_daily_jobs()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := private.today();
  r record;
begin
  -- Make sure this month's dues exist for everyone.
  perform private.generate_dues(v_today);

  -- Before and on the due date: one notice per unpaid month.
  for r in
    select d.period, public.due_date(d.period) as due, d.amount_due, m.profile_id
      from public.dues_months d
      join public.members m on m.id = d.member_id and m.is_active
      join public.profiles p on p.id = m.profile_id and p.account_status = 'active'
     where d.paid_at is null
       and v_today between public.due_date(d.period) - 5 and public.due_date(d.period) + 2
       and not private.month_in_review(d.id, array['pending', 'correction_requested']::public.payment_status[])
  loop
    if v_today < r.due then
      perform private.notify(r.profile_id, 'reminder', private.month_label(r.period) || ' dues',
        private.cedis(r.amount_due) || ' is due on ' || to_char(r.due, 'FMDay FMDD Mon') || '.',
        null, 'before:' || r.period);
    else
      perform private.notify(r.profile_id, 'reminder', private.month_label(r.period) || ' dues are due',
        private.cedis(r.amount_due) || ' was due ' ||
        case when v_today = r.due then 'today' else to_char(r.due, 'FMDay FMDD Mon') end || '.',
        null, 'due:' || r.period);
    end if;
  end loop;

  -- Overdue: one summary per member per calendar month, from 3 days after a due date.
  for r in
    select m.profile_id, count(*) as months, sum(d.amount_due) as total
      from public.dues_months d
      join public.members m on m.id = d.member_id and m.is_active
      join public.profiles p on p.id = m.profile_id and p.account_status = 'active'
     where d.paid_at is null and public.due_date(d.period) + 3 <= v_today
       and not private.month_in_review(d.id, array['pending', 'correction_requested']::public.payment_status[])
     group by m.profile_id
  loop
    perform private.notify(r.profile_id, 'overdue', 'Overdue dues',
      'You have ' || r.months || ' overdue month' || case when r.months > 1 then 's' else '' end ||
      ' (' || private.cedis(r.total) || ').', null, 'overdue:' || to_char(v_today, 'YYYY-MM'));
  end loop;
end;
$$;
