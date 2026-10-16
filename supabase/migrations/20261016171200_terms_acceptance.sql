-- Migration 13: record which version of the terms and privacy policy each
-- person has accepted. New sign-ups accept at registration; everyone else is
-- asked once after signing in. Bump the version string in the app (and here
-- in comments) when the documents change, and everyone is asked again.

alter table public.profiles
  add column terms_version text,
  add column terms_accepted_at timestamptz;

-- The signed-in user accepts a version of the terms.
create or replace function public.accept_terms(p_version text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'P0001';
  end if;
  if p_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Unknown terms version.' using errcode = 'P0001';
  end if;
  update public.profiles
     set terms_version = p_version, terms_accepted_at = now(), updated_at = now()
   where id = auth.uid();
  perform private.audit('terms.accepted', 'profiles', auth.uid()::text, jsonb_build_object('version', p_version));
end;
$$;

revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- Sign-up: also record the terms the person ticked on the form.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := left(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 120);
  v_code text := upper(trim(coalesce(new.raw_user_meta_data ->> 'member_code', '')));
  v_phone text := private.normalize_phone(new.raw_user_meta_data ->> 'phone');
  v_terms text := new.raw_user_meta_data ->> 'terms_version';
  v_linked uuid;
begin
  v_name := coalesce(case when length(v_name) >= 2 then v_name end, 'New member');
  insert into public.profiles (id, full_name, email, terms_version, terms_accepted_at)
  values (new.id, v_name, new.email,
          case when v_terms ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_terms end,
          case when v_terms ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then now() end);

  if v_code <> '' then
    update public.members
       set profile_id = new.id, updated_at = now()
     where member_code = v_code and profile_id is null and is_active
    returning id into v_linked;
  end if;

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
