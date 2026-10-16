------------------------------------------------------------------------------
-- Payments
------------------------------------------------------------------------------

-- Allocations carry the review round they belong to; only rows matching the
-- payment's current review_round count. A resubmission re-tags the months it
-- keeps and adds new ones; months it drops keep their old round number and are
-- ignored. (Older rounds are only partly preserved here — the audit log holds
-- the full history of each resubmission.)
alter table public.payment_allocations add column round smallint not null default 1;

-- Checks a set of months and writes the allocations for one payment.
-- Shared by first submission and resubmission after a correction.
create or replace function private.allocate_payment(p_payment uuid, p_member uuid, p_periods date[], p_amount numeric)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_settings public.group_settings;
  v_round smallint;
  v_periods date[];
  v_count int;
  v_total numeric(12,2);
  v_bad text;
begin
  select * into v_settings from public.group_settings where id = 1;
  select review_round into v_round from public.payments where id = p_payment;

  select array_agg(distinct date_trunc('month', p)::date order by date_trunc('month', p)::date)
    into v_periods from unnest(p_periods) p where p is not null;

  if v_periods is null then
    raise exception 'Choose at least one month.' using errcode = 'P0001';
  end if;
  if array_length(v_periods, 1) > 24 then
    raise exception 'One payment can cover at most 24 months.' using errcode = 'P0001';
  end if;
  if v_periods[1] < v_settings.dues_start then
    raise exception 'Dues start from %.', private.month_label(v_settings.dues_start) using errcode = 'P0001';
  end if;
  if v_periods[array_length(v_periods, 1)] > (date_trunc('month', private.today()) + interval '12 months')::date then
    raise exception 'You can pay at most 12 months ahead.' using errcode = 'P0001';
  end if;

  perform private.ensure_dues(p_member, v_periods[array_length(v_periods, 1)]);

  -- Lock the months so two submissions can't claim the same one at once.
  perform 1 from public.dues_months
   where member_id = p_member and period = any(v_periods)
   order by period for update;

  select string_agg(private.month_label(d.period), ', ' order by d.period) into v_bad
    from public.dues_months d
   where d.member_id = p_member and d.period = any(v_periods) and d.paid_at is not null;
  if v_bad is not null then
    raise exception 'Already paid: %.', v_bad using errcode = 'P0001';
  end if;

  select string_agg(private.month_label(d.period), ', ' order by d.period) into v_bad
    from public.dues_months d
    join public.payment_allocations a on a.dues_month_id = d.id
    join public.payments p on p.id = a.payment_id and a.round = p.review_round
   where d.member_id = p_member and d.period = any(v_periods)
     and p.id <> p_payment and p.status in ('pending', 'correction_requested');
  if v_bad is not null then
    raise exception 'Another payment waiting for review already covers %.', v_bad using errcode = 'P0001';
  end if;

  select count(*), sum(amount_due) into v_count, v_total
    from public.dues_months where member_id = p_member and period = any(v_periods);
  if v_count <> array_length(v_periods, 1) then
    raise exception 'Some of those months are not open for payment.' using errcode = 'P0001';
  end if;
  if p_amount <> v_total then
    raise exception 'Part payments are not accepted. % month(s) comes to %, but you entered %.',
      v_count, private.cedis(v_total), private.cedis(p_amount) using errcode = 'P0001';
  end if;

  insert into public.payment_allocations (payment_id, dues_month_id, amount, round)
  select p_payment, d.id, d.amount_due, v_round
    from public.dues_months d where d.member_id = p_member and d.period = any(v_periods)
  on conflict (payment_id, dues_month_id)
  do update set amount = excluded.amount, round = excluded.round;
end;
$$;

create or replace function private.check_payment_fields(p_txn text, p_sender text, p_amount numeric, p_paid_on date, p_paid_time time)
returns void language plpgsql stable set search_path = ''
as $$
begin
  if length(trim(coalesce(p_txn, ''))) not between 4 and 60 then
    raise exception 'Enter the transaction ID from your MoMo message.' using errcode = 'P0001';
  end if;
  if p_sender is not null and trim(p_sender) <> '' and trim(p_sender) !~ '^0[0-9]{9}$' then
    raise exception 'The sending number should be 10 digits, starting with 0.' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount you sent.' using errcode = 'P0001';
  end if;
  if p_paid_on is null or p_paid_time is null then
    raise exception 'Enter the date and time of the payment.' using errcode = 'P0001';
  end if;
  -- Ghana is on UTC all year, so Accra local time compares directly.
  if (p_paid_on + p_paid_time) > (now() at time zone 'Africa/Accra') + interval '5 minutes' then
    raise exception 'The payment date and time cannot be in the future.' using errcode = 'P0001';
  end if;
  if p_paid_on < date '2019-01-01' then
    raise exception 'Check the payment date.' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.submit_payment(
  p_network public.momo_network, p_transaction_id text, p_sender_number text,
  p_amount numeric, p_paid_on date, p_paid_time time, p_periods date[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid := private.my_member_id();
  v_id uuid;
begin
  if v_member is null then
    raise exception 'Your account has not been approved yet.' using errcode = 'P0001';
  end if;
  perform private.check_payment_fields(p_transaction_id, p_sender_number, p_amount, p_paid_on, p_paid_time);

  begin
    insert into public.payments (member_id, network, transaction_id, sender_number, amount,
                                 paid_on, paid_time, submitted_by)
    values (v_member, p_network, upper(trim(p_transaction_id)), nullif(trim(p_sender_number), ''),
            p_amount, p_paid_on, p_paid_time, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That transaction ID has already been recorded.' using errcode = 'P0001';
  end;

  perform private.allocate_payment(v_id, v_member, p_periods, p_amount);
  perform private.audit('payment.submitted', 'payments', v_id::text,
    jsonb_build_object('amount', p_amount, 'network', p_network, 'txn', upper(trim(p_transaction_id))));
  return v_id;
end;
$$;

create or replace function public.resubmit_payment(
  p_payment uuid, p_network public.momo_network, p_transaction_id text, p_sender_number text,
  p_amount numeric, p_paid_on date, p_paid_time time, p_periods date[])
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid := private.my_member_id();
  v_pay public.payments;
begin
  select * into v_pay from public.payments where id = p_payment for update;
  if v_member is null or v_pay.id is null or v_pay.member_id <> v_member then
    raise exception 'Payment not found.' using errcode = 'P0001';
  end if;
  if v_pay.status <> 'correction_requested' then
    raise exception 'Only a payment sent back for correction can be changed.' using errcode = 'P0001';
  end if;
  perform private.check_payment_fields(p_transaction_id, p_sender_number, p_amount, p_paid_on, p_paid_time);

  begin
    update public.payments
       set network = p_network, transaction_id = upper(trim(p_transaction_id)),
           sender_number = nullif(trim(p_sender_number), ''), amount = p_amount,
           paid_on = p_paid_on, paid_time = p_paid_time,
           status = 'pending', review_round = review_round + 1, status_note = null,
           updated_at = now()
     where id = p_payment;
  exception when unique_violation then
    raise exception 'That transaction ID has already been recorded.' using errcode = 'P0001';
  end;

  perform private.allocate_payment(p_payment, v_member, p_periods, p_amount);
  perform private.audit('payment.resubmitted', 'payments', p_payment::text,
    jsonb_build_object('round', v_pay.review_round + 1, 'amount', p_amount));
end;
$$;

-- Two approvals approve. Two rejections reject. One "send back" returns it
-- to the member. A split decision waits for a third admin.
create or replace function public.review_payment(p_payment uuid, p_decision public.review_decision, p_note text default null)
returns public.payment_status language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_pay public.payments;
  v_payer_profile uuid;
  v_approvals int;
  v_rejections int;
  v_months text;
  v_unavailable int;
  v_receipt text;
  v_note text := nullif(trim(p_note), '');
begin
  perform private.require_admin();

  select * into v_pay from public.payments where id = p_payment for update;
  if not found then
    raise exception 'Payment not found.' using errcode = 'P0001';
  end if;
  if v_pay.status <> 'pending' then
    raise exception 'This payment is no longer waiting for review.' using errcode = 'P0001';
  end if;

  select profile_id into v_payer_profile from public.members where id = v_pay.member_id;
  if v_payer_profile = v_uid or v_pay.submitted_by = v_uid then
    raise exception 'You cannot review your own payment.' using errcode = 'P0001';
  end if;
  if p_decision <> 'approve' and v_note is null then
    raise exception 'Say why, so the member knows what to fix.' using errcode = 'P0001';
  end if;

  begin
    insert into public.payment_reviews (payment_id, round, reviewer_id, decision, note)
    values (p_payment, v_pay.review_round, v_uid, p_decision, left(v_note, 500));
  exception when unique_violation then
    raise exception 'You have already reviewed this payment.' using errcode = 'P0001';
  end;

  perform private.audit('payment.review.' || p_decision::text, 'payments', p_payment::text,
                        jsonb_build_object('round', v_pay.review_round, 'note', v_note));

  if p_decision = 'request_correction' then
    update public.payments
       set status = 'correction_requested', status_note = v_note, updated_at = now()
     where id = p_payment;
    perform private.notify(v_payer_profile, 'payment_correction', 'Please check your payment',
      'An admin sent your ' || private.cedis(v_pay.amount) || ' payment back: ' || v_note, p_payment);
    return 'correction_requested';
  end if;

  -- Only count reviewers who are still active admins.
  select count(*) filter (where r.decision = 'approve'),
         count(*) filter (where r.decision = 'reject')
    into v_approvals, v_rejections
    from public.payment_reviews r
    join public.profiles pr on pr.id = r.reviewer_id and pr.is_admin and pr.account_status = 'active'
   where r.payment_id = p_payment and r.round = v_pay.review_round;

  if v_approvals >= 2 then
    perform 1 from public.dues_months d
      join public.payment_allocations a on a.dues_month_id = d.id and a.round = v_pay.review_round
     where a.payment_id = p_payment order by d.period for update of d;

    select count(*) into v_unavailable
      from public.dues_months d
      join public.payment_allocations a on a.dues_month_id = d.id and a.round = v_pay.review_round
     where a.payment_id = p_payment and (d.paid_at is not null or d.member_id <> v_pay.member_id);
    if v_unavailable > 0 then
      raise exception 'One of the months on this payment is already paid. Send it back for correction.'
        using errcode = 'P0001';
    end if;
    if (select coalesce(sum(amount), 0) from public.payment_allocations
         where payment_id = p_payment and round = v_pay.review_round) <> v_pay.amount then
      raise exception 'The months on this payment do not add up to the amount. Send it back for correction.'
        using errcode = 'P0001';
    end if;

    update public.dues_months d
       set paid_at = now(), payment_id = p_payment
      from public.payment_allocations a
     where a.dues_month_id = d.id and a.payment_id = p_payment and a.round = v_pay.review_round;

    update public.payments
       set status = 'approved', decided_at = now(), status_note = null, updated_at = now()
     where id = p_payment;

    v_receipt := 'C19-' || to_char(private.today(), 'YYYY') || '-' ||
                 lpad(nextval('public.receipt_seq')::text, 5, '0');
    insert into public.receipts (receipt_number, payment_id) values (v_receipt, p_payment);

    select string_agg(private.month_label(d.period), ', ' order by d.period) into v_months
      from public.dues_months d
      join public.payment_allocations a on a.dues_month_id = d.id and a.round = v_pay.review_round
     where a.payment_id = p_payment;

    perform private.notify(v_payer_profile, 'payment_approved', 'Payment confirmed',
      private.cedis(v_pay.amount) || ' for ' || v_months || '. Receipt ' || v_receipt || '.', p_payment);
    perform private.audit('payment.approved', 'payments', p_payment::text,
                          jsonb_build_object('receipt', v_receipt, 'amount', v_pay.amount));
    return 'approved';
  end if;

  if v_rejections >= 2 then
    update public.payments
       set status = 'rejected', decided_at = now(), updated_at = now(),
           status_note = (select string_agg(note, ' / ' order by created_at) from public.payment_reviews
                           where payment_id = p_payment and round = v_pay.review_round and decision = 'reject')
     where id = p_payment;
    perform private.notify(v_payer_profile, 'payment_rejected', 'Payment not accepted',
      'Two admins could not confirm your ' || private.cedis(v_pay.amount) || ' payment (' ||
      v_pay.transaction_id || '). Speak to an admin if you think this is wrong.', p_payment);
    perform private.audit('payment.rejected', 'payments', p_payment::text);
    return 'rejected';
  end if;

  return 'pending';
end;
$$;
