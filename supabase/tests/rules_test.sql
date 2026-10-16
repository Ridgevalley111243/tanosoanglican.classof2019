-- End-to-end test of the dues rules with fictional accounts.
--
-- Paste into the Supabase SQL editor (or run through the MCP execute_sql tool).
-- Everything happens inside one DO block that always ends by raising an
-- exception, so every change is rolled back and nothing is left behind.
-- The final message reads "ALL n CHECKS PASSED" or names the first failure.

do $test$
declare
  a1 uuid := gen_random_uuid();  -- admin who is also a member
  a2 uuid := gen_random_uuid();  -- admin
  a3 uuid := gen_random_uuid();  -- admin
  m1 uuid := gen_random_uuid();  -- member
  m2 uuid := gen_random_uuid();  -- second member
  pup uuid := gen_random_uuid(); -- account one admin tries to promote alone
  code1 text; code2 text; code_a1 text;
  pay1 uuid; pay2 uuid; pay3 uuid; pay4 uuid; pay_a1 uuid; exp1 uuid;
  st text; n int; j jsonb;
  today date := (now() at time zone 'Africa/Accra')::date;
  this_month date := date_trunc('month', (now() at time zone 'Africa/Accra'))::date;
  checks int := 0;
begin
  -- Setup as the database owner: three admins and two roster members.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (a1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a1@test.invalid', '{"full_name":"Ama Admin"}', now(), now()),
         (a2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a2@test.invalid', '{"full_name":"Kofi Admin"}', now(), now()),
         (a3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a3@test.invalid', '{"full_name":"Esi Admin"}', now(), now());
  update public.profiles set is_admin = true, account_status = 'active' where id in (a1, a2, a3);

  -- Admin A1 adds roster entries (acting through the API role).
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select member_code into code1 from public.admin_add_member('Yaw Mensah', '0241234567');
  select member_code into code2 from public.admin_add_member('Abena Owusu', null);
  select member_code into code_a1 from public.admin_add_member('Ama Admin', null);
  reset role;
  if code1 !~ '^C19-[A-HJ-NP-Z2-9]{5}$' then raise exception 'FAIL: bad member code %', code1; end if;
  checks := checks + 1;

  -- 1. Sign-up claims the code, ignores any attempt to self-promote.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (m1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm1@test.invalid',
          json_build_object('full_name', 'Yaw Mensah', 'member_code', lower(code1), 'is_admin', true, 'account_status', 'active')::jsonb, now(), now()),
         (m2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'm2@test.invalid',
          '{"full_name":"Abena Owusu","member_code":"C19-WRONG"}', now(), now());
  update public.members set profile_id = a1 where member_code = code_a1;

  if not exists (select 1 from public.profiles where id = m1 and account_status = 'pending' and not is_admin) then
    raise exception 'FAIL 1: new sign-up should be a pending non-admin'; end if;
  if not exists (select 1 from public.members where member_code = code1 and profile_id = m1) then
    raise exception 'FAIL 1: member code was not claimed at sign-up'; end if;
  checks := checks + 1;

  -- 2. A pending member can't submit and sees no dues.
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.submit_payment('mtn', 'TXN0001', null, 20, today, '08:00', array[this_month]);
    raise exception 'FAIL 2: pending member submitted a payment';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%not been approved%' then raise; end if;
  end;
  if exists (select 1 from public.dues_months) then raise exception 'FAIL 2: pending member can see dues'; end if;
  checks := checks + 1;

  -- 3. Members can't write tables directly or call admin functions.
  begin
    insert into public.payments (member_id, network, transaction_id, amount, paid_on, paid_time, submitted_by, status)
    values (gen_random_uuid(), 'mtn', 'HACK', 20, today, '08:00', m1, 'approved');
    raise exception 'FAIL 3: direct insert allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set is_admin = true where id = m1;
    raise exception 'FAIL 3: direct profile update allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_add_member('Intruder', null);
    raise exception 'FAIL 3: member called an admin function';
  exception when sqlstate 'P0001' then null;
  end;
  checks := checks + 1;

  -- 4. Wrong code at sign-up can be fixed later; M2 claims their code.
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.link_member_code(code1) then raise exception 'FAIL 4: claimed a code that is already used'; end if;
  if not public.link_member_code(code2) then raise exception 'FAIL 4: valid code refused'; end if;
  reset role;
  if (select count(*) from public.audit_logs where action = 'member_code.failed' and actor_id = m2) <> 1 then
    raise exception 'FAIL 4: failed attempt was not recorded'; end if;
  set local role authenticated;
  checks := checks + 1;

  -- 5. Admin approves both accounts; dues appear from the start month.
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  perform public.admin_set_account_status(m1, 'active');
  perform public.admin_set_account_status(m2, 'active');
  begin
    perform public.admin_set_account_status(a1, 'suspended');
    raise exception 'FAIL 5: admin changed own status';
  exception when sqlstate 'P0001' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.dues_months;
  if n <> (select (extract(year from age(this_month, dues_start)) * 12 + extract(month from age(this_month, dues_start)))::int + 1
             from public.group_settings) then
    raise exception 'FAIL 5: expected dues from start month, member sees % rows', n; end if;
  checks := checks + 1;

  -- 6. No part payments; several whole months at once is fine.
  begin
    perform public.submit_payment('mtn', 'TXN0001', null, 30, today, '08:00',
                                  array[this_month, (this_month + interval '1 month')::date]);
    raise exception 'FAIL 6: wrong amount accepted';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Part payments%' then raise; end if;
  end;
  pay1 := public.submit_payment('mtn', ' txn0001 ', '0241234567', 40, today, '08:00',
                                array[this_month, (this_month + interval '1 month')::date]);
  if (select status from public.payments where id = pay1) <> 'pending' then raise exception 'FAIL 6: not pending'; end if;
  checks := checks + 1;

  -- 7. Same month can't be claimed twice; same reference can't be reused.
  begin
    perform public.submit_payment('mtn', 'TXN0002', null, 20, today, '09:00', array[(this_month + interval '1 month')::date]);
    raise exception 'FAIL 7: month claimed twice';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'Another payment%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  begin
    perform public.submit_payment('mtn', 'TXN0001', null, 20, today, '08:00', array[this_month]);
    raise exception 'FAIL 7: transaction ID reused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%already been recorded%' then raise; end if;
  end;
  -- Another network may legitimately reuse the same reference format.
  pay3 := public.submit_payment('telecel', 'TXN0001', null, 20, today, '08:00', array[this_month]);
  -- And M2 cannot see M1's payment.
  if exists (select 1 from public.payments where id = pay1) then raise exception 'FAIL 7: saw another member''s payment'; end if;
  checks := checks + 1;

  -- 8. One approval is not enough; the same admin can't approve twice.
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  st := public.review_payment(pay1, 'approve');
  if st <> 'pending' then raise exception 'FAIL 8: one approval changed status to %', st; end if;
  begin
    perform public.review_payment(pay1, 'approve');
    raise exception 'FAIL 8: same admin approved twice';
  exception when sqlstate 'P0001' then null;
  end;
  if exists (select 1 from public.dues_months where payment_id = pay1) then raise exception 'FAIL 8: month paid after one approval'; end if;
  checks := checks + 1;

  -- 9. Second admin approves: months paid, one receipt, member notified.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  st := public.review_payment(pay1, 'approve');
  if st <> 'approved' then raise exception 'FAIL 9: expected approved, got %', st; end if;
  select count(*) into n from public.dues_months where payment_id = pay1 and paid_at is not null;
  if n <> 2 then raise exception 'FAIL 9: expected 2 paid months, got %', n; end if;
  select count(*) into n from public.receipts where payment_id = pay1;
  if n <> 1 then raise exception 'FAIL 9: expected 1 receipt, got %', n; end if;
  begin
    perform public.review_payment(pay1, 'approve');
    raise exception 'FAIL 9: reviewed a decided payment';
  exception when sqlstate 'P0001' then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.notifications where kind = 'payment_approved') then raise exception 'FAIL 9: no notification'; end if;
  if not exists (select 1 from public.receipts) then raise exception 'FAIL 9: member cannot see own receipt'; end if;
  if exists (select 1 from public.payment_reviews) then raise exception 'FAIL 9: member can read reviews'; end if;
  select count(*) into n from public.dues_overview where state = 'paid';
  if n <> 2 then raise exception 'FAIL 9: overview shows % paid', n; end if;
  checks := checks + 1;

  -- 10. Correction round: send back, member fixes, round 2 needs two fresh approvals.
  pay2 := public.submit_payment('airteltigo', 'AT-77881', null, 20, today, '10:00', array[(this_month + interval '2 month')::date]);
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  perform public.review_payment(pay2, 'approve');
  begin
    perform public.review_payment(pay2, 'request_correction', '  ');
    raise exception 'FAIL 10: correction without a reason';
  exception when sqlstate 'P0001' then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true);
  st := public.review_payment(pay2, 'request_correction', 'Statement shows GH₵40, please add January');
  if st <> 'correction_requested' then raise exception 'FAIL 10: got %', st; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  perform public.resubmit_payment(pay2, 'airteltigo', 'AT-77881', null, 40, today, '10:00',
                                  array[(this_month + interval '2 month')::date, (this_month + interval '3 month')::date]);
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  st := public.review_payment(pay2, 'approve');   -- A2 again, but in round 2
  if st <> 'pending' then raise exception 'FAIL 10: round-1 approval carried over (%)', st; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true);
  st := public.review_payment(pay2, 'approve');
  if st <> 'approved' then raise exception 'FAIL 10: round 2 not approved (%)', st; end if;
  select count(*) into n from public.dues_months where payment_id = pay2;
  if n <> 2 then raise exception 'FAIL 10: expected 2 months paid by corrected payment, got %', n; end if;
  checks := checks + 1;

  -- 11. Rejection needs two admins; a split vote waits for a third.
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  begin
    perform public.review_payment(pay3, 'reject');
    raise exception 'FAIL 11: rejection without a reason';
  exception when sqlstate 'P0001' then null;
  end;
  st := public.review_payment(pay3, 'reject', 'Not on the Telecel statement');
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  st := public.review_payment(pay3, 'approve');
  if st <> 'pending' then raise exception 'FAIL 11: split vote decided (%)', st; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true);
  st := public.review_payment(pay3, 'reject', 'Cannot find it');
  if st <> 'rejected' then raise exception 'FAIL 11: two rejections gave %', st; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m2, 'role', 'authenticated')::text, true);
  if (select state from public.dues_overview where period = this_month) <> 'open' then
    raise exception 'FAIL 11: month should be open again after rejection'; end if;
  checks := checks + 1;

  -- 12. An admin who is a member can't review their own payment.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  perform public.admin_set_account_status(a1, 'active');
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  pay_a1 := public.submit_payment('mtn', 'ADMIN-OWN-1', null, 20, today, '11:00', array[this_month]);
  begin
    perform public.review_payment(pay_a1, 'approve');
    raise exception 'FAIL 12: admin approved own payment';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%your own payment%' then raise; end if;
  end;
  checks := checks + 1;

  -- 13. Expenses: recorder can't review; two other admins approve.
  exp1 := public.record_expense('Wreath for a classmate''s father', 'Welfare', 150, today, 'MoMo 55012');
  begin
    perform public.review_expense(exp1, 'approve');
    raise exception 'FAIL 13: recorder reviewed own expense';
  exception when sqlstate 'P0001' then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  if public.review_expense(exp1, 'approve') <> 'pending' then raise exception 'FAIL 13: one approval decided expense'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', a3, 'role', 'authenticated')::text, true);
  if public.review_expense(exp1, 'approve') <> 'approved' then raise exception 'FAIL 13: expense not approved'; end if;
  checks := checks + 1;

  -- 14. Totals: only approved money counts. Members see headline numbers only.
  j := public.finance_summary();
  if (j ->> 'collected')::numeric <> 80 or (j ->> 'spent')::numeric <> 150 or (j ->> 'balance')::numeric <> -70 then
    raise exception 'FAIL 14: admin totals wrong: %', j; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  j := public.finance_summary();
  if j ? 'monthly' or (j ->> 'balance')::numeric <> -70 then raise exception 'FAIL 14: member summary wrong: %', j; end if;
  if exists (select 1 from public.expenses) then raise exception 'FAIL 14: member can read expenses'; end if;
  checks := checks + 1;

  -- 15. Suspended accounts lose access immediately.
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  perform public.admin_set_account_status(m1, 'suspended');
  perform set_config('request.jwt.claims', json_build_object('sub', m1, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.dues_months) then raise exception 'FAIL 15: suspended member still sees dues'; end if;
  checks := checks + 1;

  -- 16. Anonymous visitors see nothing.
  reset role;
  set local role anon;
  begin
    perform 1 from public.profiles;
    raise exception 'FAIL 16: anon can query profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.finance_summary();
    raise exception 'FAIL 16: anon can call functions';
  exception when insufficient_privilege then null;
  end;
  reset role;
  checks := checks + 1;

  -- 17. The daily job runs and is safe to repeat.
  perform private.run_daily_jobs();
  perform private.run_daily_jobs();
  checks := checks + 1;

  -- 18. The audit log recorded the key events.
  select count(*) into n from public.audit_logs
   where action in ('payment.approved', 'payment.rejected', 'expense.recorded', 'account.active');
  if n < 5 then raise exception 'FAIL 18: audit log has only % key events', n; end if;
  checks := checks + 1;

  -- 19. Admin rights need two admins: one proposes, a different one confirms.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values (pup, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pup@test.invalid', '{"full_name":"Puppet"}', now(), now());
  update public.profiles set account_status = 'active' where id = pup;
  perform set_config('request.jwt.claims', json_build_object('sub', a1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.admin_set_admin(pup, true);
    raise exception 'FAIL 19: retired single-admin function still callable';
  exception when insufficient_privilege then null;
  end;
  if public.admin_change_role(pup, true) <> 'proposed' then raise exception 'FAIL 19: not a proposal'; end if;
  begin
    perform public.admin_change_role(pup, true);
    raise exception 'FAIL 19: proposer confirmed own proposal';
  exception when sqlstate 'P0001' then null;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', a2, 'role', 'authenticated')::text, true);
  if public.admin_change_role(pup, true) <> 'done' then raise exception 'FAIL 19: second admin could not confirm'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pup, 'role', 'authenticated')::text, true);
  if public.admin_change_role(a1, false) <> 'proposed' then raise exception 'FAIL 19: one admin removed another'; end if;
  -- Blocking an admin would switch their powers off; one admin can't do that either.
  begin
    perform public.admin_set_account_status(a1, 'suspended');
    raise exception 'FAIL 19: one admin blocked another admin';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'This person is an admin%' then raise; end if;
  end;
  reset role;
  if not (select is_admin from public.profiles where id = pup) then raise exception 'FAIL 19: confirmed admin not saved'; end if;
  if not (select is_admin and account_status = 'active' from public.profiles where id = a1) then raise exception 'FAIL 19: a1 lost admin after one vote'; end if;
  checks := checks + 1;

  raise exception 'ALL % CHECKS PASSED (rolled back)', checks;
end
$test$;
