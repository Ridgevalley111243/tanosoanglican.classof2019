-- Migration 11: members can register without a code.
--
-- A sign-up without a valid code gets its own class-list entry and member
-- code straight away. That entry stays inactive (owes nothing, isn't in the
-- reports) until an admin approves the account, which is now the check that
-- the person really is a classmate. Codes handed out by admins still work.

alter table public.members add column self_registered boolean not null default false;

-- '+233 24 123 4567', '233241234567', '0241234567' → '0241234567'; anything else → null.
create or replace function private.normalize_phone(p text)
returns text language sql immutable set search_path = ''
as $$
  select case
    when d ~ '^0[0-9]{9}$' then d
    when d ~ '^233[0-9]{9}$' then '0' || substr(d, 4)
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120);
  v_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'member_code', '')));
  v_phone text := private.normalize_phone(new.raw_user_meta_data ->> 'phone');
  v_linked uuid;
begin
  v_name := coalesce(case when length(v_name) >= 2 then v_name end, 'New member');
  insert into public.profiles (id, full_name, email) values (new.id, v_name, new.email);

  -- A code from an admin links to the entry they created.
  if v_code <> '' then
    update public.members
       set profile_id = new.id, updated_at = now()
     where member_code = v_code and profile_id is null and is_active
    returning id into v_linked;
  end if;

  -- Otherwise the member gets their own entry and code, inactive until approved.
  if v_linked is null then
    for attempt in 1..10 loop
      begin
        insert into public.members (member_code, full_name, phone, profile_id, is_active, self_registered)
        values (private.random_code(), v_name, v_phone, new.id, false, true);
        exit;
      exception when unique_violation then
        if attempt = 10 then raise; end if;
      end;
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_account_status(p_profile uuid, p_status public.account_status)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid;
  v_old public.account_status;
  v_is_admin boolean;
begin
  perform private.require_admin();
  if p_profile = auth.uid() then
    raise exception 'You cannot change your own account status.' using errcode = 'P0001';
  end if;

  select account_status, is_admin into v_old, v_is_admin from public.profiles where id = p_profile for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'P0001';
  end if;
  if v_is_admin and p_status <> v_old then
    raise exception 'This person is an admin. Remove their admin rights first (that needs two admins), then change their account.'
      using errcode = 'P0001';
  end if;

  select id into v_member from public.members where profile_id = p_profile;
  if p_status = 'active' and v_member is null then
    raise exception 'Link this account to a member code before approving it.' using errcode = 'P0001';
  end if;

  update public.profiles set account_status = p_status, updated_at = now() where id = p_profile;

  -- Approving a new sign-up puts their own class-list entry into use.
  if p_status = 'active' and v_old = 'pending' then
    update public.members set is_active = true, updated_at = now()
     where id = v_member and self_registered and not is_active;
  end if;
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

revoke execute on function private.normalize_phone(text) from public, anon, authenticated;
