-- Migration 3: every write the app can make.
--
-- All functions are SECURITY DEFINER with an empty search_path, take the
-- caller's identity from auth.uid() only, and raise a plain-English message
-- the app shows as-is. Errors raised with errcode 'P0001' are user-facing.

------------------------------------------------------------------------------
-- Internal helpers
------------------------------------------------------------------------------

create or replace function private.audit(p_action text, p_table text, p_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, target_table, target_id, details)
  values ((select auth.uid()), p_action, p_table, p_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function private.notify(p_profile uuid, p_kind text, p_title text, p_body text,
                                          p_payment uuid default null, p_dedupe text default null)
returns void language sql security definer set search_path = ''
as $$
  insert into public.notifications (profile_id, kind, title, body, payment_id, dedupe_key)
  select p_profile, p_kind, p_title, p_body, p_payment, p_dedupe
  where p_profile is not null
  on conflict (profile_id, dedupe_key) do nothing;
$$;

create or replace function private.month_label(p date)
returns text language sql immutable set search_path = ''
as $$ select to_char(p, 'FMMonth YYYY') $$;

create or replace function private.cedis(p numeric)
returns text language sql immutable set search_path = ''
as $$ select 'GH₵' || to_char(p, 'FM999,999,990.00') $$;

-- Month M is due on settings.due_day of month M+1.
create or replace function public.due_date(p_period date)
returns date language sql stable security definer set search_path = ''
as $$
  select (date_trunc('month', p_period) + interval '1 month')::date + (s.due_day - 1)
  from public.group_settings s where s.id = 1
$$;

create or replace function private.random_code()
returns text language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(5);
  code text := 'C19-';
begin
  for i in 0..4 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return code;
end;
$$;

-- Create the member's dues rows from the group's start month up to p_through.
-- Safe to repeat. Inactive roster entries accrue nothing new.
create or replace function private.ensure_dues(p_member uuid, p_through date)
returns void language sql security definer set search_path = ''
as $$
  insert into public.dues_months (member_id, period, amount_due)
  select m.id, gs.period::date, s.monthly_dues
  from public.members m
  cross join public.group_settings s
  cross join lateral generate_series(s.dues_start, date_trunc('month', p_through)::date, interval '1 month') as gs(period)
  where m.id = p_member and m.is_active
  on conflict (member_id, period) do nothing;
$$;

create or replace function private.require_admin()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Only an active admin can do this.' using errcode = 'P0001';
  end if;
end;
$$;

------------------------------------------------------------------------------
-- Sign-up and account approval
------------------------------------------------------------------------------

-- Runs when someone registers. The profile always starts pending and
-- never an admin, whatever the sign-up form sent.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120);
  v_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'member_code', '')));
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(case when length(v_name) >= 2 then v_name end, 'New member'), new.email);

  if v_code <> '' then
    update public.members
       set profile_id = new.id, updated_at = now()
     where member_code = v_code and profile_id is null and is_active;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- For a registered user whose code didn't match at sign-up.
create or replace function public.claim_member_code(p_code text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tries int;
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.members where profile_id = v_uid) then
    raise exception 'Your account is already linked to a member code.' using errcode = 'P0001';
  end if;

  select count(*) into v_tries from public.audit_logs
   where actor_id = v_uid and action = 'member_code.failed' and created_at > now() - interval '1 hour';
  if v_tries >= 5 then
    raise exception 'Too many wrong codes. Try again in an hour or ask an admin.' using errcode = 'P0001';
  end if;

  update public.members
     set profile_id = v_uid, updated_at = now()
   where member_code = upper(trim(p_code)) and profile_id is null and is_active
  returning id into v_member;

  if v_member is null then
    perform private.audit('member_code.failed', 'members', null, '{}'::jsonb);
    raise exception 'That code is not valid or has already been used.' using errcode = 'P0001';
  end if;
  perform private.audit('member_code.claimed', 'members', v_member::text, '{}'::jsonb);
end;
$$;

create or replace function public.update_my_name(p_full_name text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if length(trim(coalesce(p_full_name, ''))) not between 2 and 120 then
    raise exception 'Enter your full name.' using errcode = 'P0001';
  end if;
  update public.profiles set full_name = trim(p_full_name), updated_at = now()
   where id = auth.uid();
end;
$$;

create or replace function public.admin_set_account_status(p_profile uuid, p_status public.account_status)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid;
  v_old public.account_status;
begin
  perform private.require_admin();
  if p_profile = auth.uid() then
    raise exception 'You cannot change your own account status.' using errcode = 'P0001';
  end if;

  select account_status into v_old from public.profiles where id = p_profile for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'P0001';
  end if;

  select id into v_member from public.members where profile_id = p_profile;
  if p_status = 'active' and v_member is null
     and not exists (select 1 from public.profiles where id = p_profile and is_admin) then
    raise exception 'Link this account to a member code before approving it.' using errcode = 'P0001';
  end if;

  update public.profiles set account_status = p_status, updated_at = now() where id = p_profile;

  if p_status = 'active' and v_member is not null then
    perform private.ensure_dues(v_member, private.today());
  end if;
  if p_status = 'active' and v_old <> 'active' then
    perform private.notify(p_profile, 'account', 'Your account is active',
      'An admin has confirmed you. You can now see your dues and record payments.');
  end if;

  perform private.audit('account.' || p_status::text, 'profiles', p_profile::text,
                        jsonb_build_object('from', v_old));
end;
$$;

create or replace function public.admin_set_admin(p_profile uuid, p_is_admin boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  if p_profile = auth.uid() then
    raise exception 'You cannot change your own admin rights.' using errcode = 'P0001';
  end if;
  update public.profiles set is_admin = p_is_admin, updated_at = now()
   where id = p_profile and account_status = 'active';
  if not found then
    raise exception 'Only an active account can be made an admin.' using errcode = 'P0001';
  end if;
  perform private.audit(case when p_is_admin then 'admin.granted' else 'admin.revoked' end,
                        'profiles', p_profile::text);
end;
$$;

------------------------------------------------------------------------------
-- Roster
------------------------------------------------------------------------------

create or replace function public.admin_add_member(p_full_name text, p_phone text default null)
returns public.members language plpgsql security definer set search_path = ''
as $$
declare
  v_row public.members;
begin
  perform private.require_admin();
  for attempt in 1..10 loop
    begin
      insert into public.members (member_code, full_name, phone, created_by)
      values (private.random_code(), trim(p_full_name), nullif(trim(p_phone), ''), auth.uid())
      returning * into v_row;
      exit;
    exception when unique_violation then
      if attempt = 10 then raise; end if;
    end;
  end loop;
  perform private.ensure_dues(v_row.id, private.today());
  perform private.audit('member.added', 'members', v_row.id::text,
                        jsonb_build_object('name', v_row.full_name, 'code', v_row.member_code));
  return v_row;
exception when check_violation then
  raise exception 'Check the name (2–120 letters) and phone (10 digits, starting with 0).' using errcode = 'P0001';
end;
$$;

create or replace function public.admin_update_member(p_member uuid, p_full_name text, p_phone text, p_is_active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_admin();
  update public.members
     set full_name = trim(p_full_name), phone = nullif(trim(p_phone), ''),
         is_active = p_is_active, updated_at = now()
   where id = p_member;
  if not found then
    raise exception 'Member not found.' using errcode = 'P0001';
  end if;
  if p_is_active then
    perform private.ensure_dues(p_member, private.today());
  end if;
  perform private.audit('member.updated', 'members', p_member::text,
                        jsonb_build_object('name', p_full_name, 'active', p_is_active));
exception when check_violation then
  raise exception 'Check the name (2–120 letters) and phone (10 digits, starting with 0).' using errcode = 'P0001';
end;
$$;

-- For when the wrong person claimed a code. Their account goes back to pending.
create or replace function public.admin_release_member_code(p_member uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
begin
  perform private.require_admin();
  select profile_id into v_profile from public.members where id = p_member for update;
  if v_profile is null then
    raise exception 'That code is not linked to any account.' using errcode = 'P0001';
  end if;
  if v_profile = auth.uid() then
    raise exception 'You cannot unlink your own account.' using errcode = 'P0001';
  end if;
  update public.members set profile_id = null, updated_at = now() where id = p_member;
  update public.profiles set account_status = 'pending', updated_at = now()
   where id = v_profile and not is_admin;
  perform private.audit('member_code.released', 'members', p_member::text,
                        jsonb_build_object('profile', v_profile));
end;
$$;

------------------------------------------------------------------------------
-- Settings and monthly dues
------------------------------------------------------------------------------

create or replace function public.admin_update_settings(
  p_monthly_dues numeric, p_due_day smallint, p_dues_start date,
  p_momo_instructions text, p_show_balance boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.group_settings;
  v_start date := date_trunc('month', p_dues_start)::date;
begin
  perform private.require_admin();
  select * into v_old from public.group_settings where id = 1 for update;

  if v_start > v_old.dues_start
     and exists (select 1 from public.dues_months where period < v_start) then
    raise exception 'Dues already exist before %. The start month can only move earlier.',
      private.month_label(v_start) using errcode = 'P0001';
  end if;

  update public.group_settings
     set monthly_dues = p_monthly_dues, due_day = p_due_day, dues_start = v_start,
         momo_instructions = nullif(trim(p_momo_instructions), ''),
         show_balance_to_members = p_show_balance,
         updated_by = auth.uid(), updated_at = now()
   where id = 1;

  perform private.audit('settings.updated', 'group_settings', '1', jsonb_build_object(
    'monthly_dues', jsonb_build_array(v_old.monthly_dues, p_monthly_dues),
    'due_day', jsonb_build_array(v_old.due_day, p_due_day),
    'dues_start', jsonb_build_array(v_old.dues_start, v_start),
    'show_balance', jsonb_build_array(v_old.show_balance_to_members, p_show_balance)));
exception when check_violation then
  raise exception 'Dues must be above zero and the due day between 1 and 28.' using errcode = 'P0001';
end;
$$;

-- Fills in dues for every active member up to the given month. Idempotent.
create or replace function private.generate_dues(p_through date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_before bigint;
  v_after bigint;
  m record;
begin
  select count(*) into v_before from public.dues_months;
  for m in select id from public.members where is_active loop
    perform private.ensure_dues(m.id, p_through);
  end loop;
  select count(*) into v_after from public.dues_months;
  return v_after - v_before;
end;
$$;

create or replace function public.admin_generate_dues(p_through date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_created integer;
begin
  perform private.require_admin();
  if p_through > (date_trunc('month', private.today()) + interval '12 months')::date then
    raise exception 'Dues can be generated at most 12 months ahead.' using errcode = 'P0001';
  end if;
  v_created := private.generate_dues(p_through);
  perform private.audit('dues.generated', 'dues_months', null,
    jsonb_build_object('through', date_trunc('month', p_through)::date, 'created', v_created));
  return v_created;
end;
$$;
