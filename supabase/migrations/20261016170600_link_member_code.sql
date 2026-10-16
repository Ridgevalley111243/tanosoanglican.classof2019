-- Migration 7: claim_member_code raised on a wrong code, which also rolled
-- back the record of the failed attempt, so the attempt limit never
-- triggered. It is retired (no one may call it) and replaced by
-- link_member_code, which returns false for a wrong code so the attempt is kept.
revoke execute on function public.claim_member_code(text) from public, anon, authenticated;

create or replace function public.link_member_code(p_code text)
returns boolean language plpgsql security definer set search_path = ''
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
    return false;
  end if;
  perform private.audit('member_code.claimed', 'members', v_member::text, '{}'::jsonb);
  return true;
end;
$$;

revoke execute on function public.link_member_code(text) from public, anon;
grant execute on function public.link_member_code(text) to authenticated;
