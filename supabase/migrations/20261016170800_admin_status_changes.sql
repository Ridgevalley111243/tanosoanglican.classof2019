-- Migration 9: close the remaining single-admin paths around admin rights
-- (code review of migration 8).
--
-- * Blocking or unblocking an admin switched their powers off and on, so one
--   admin could do it alone. Admins' accounts can no longer be blocked or
--   unblocked directly: remove their admin rights first (two admins).
-- * Removing admin rights now works on blocked accounts too.
-- * pending_roles counts only proposals the viewing admin can confirm.

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

create or replace function public.admin_change_role(p_profile uuid, p_make_admin boolean)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_target public.profiles;
  v_prop public.admin_role_proposals;
begin
  perform private.require_admin();
  if p_profile = v_uid then
    raise exception 'You cannot change your own admin rights.' using errcode = 'P0001';
  end if;

  select * into v_target from public.profiles where id = p_profile for update;
  if v_target.id is null then
    raise exception 'Account not found.' using errcode = 'P0001';
  end if;
  -- Granting needs an active account; removing works whatever the status.
  if p_make_admin and v_target.account_status <> 'active' then
    raise exception 'Only an active account can be made an admin.' using errcode = 'P0001';
  end if;
  if v_target.is_admin = p_make_admin then
    raise exception '% %.', v_target.full_name,
      case when p_make_admin then 'is already an admin' else 'is not an admin' end using errcode = 'P0001';
  end if;

  select * into v_prop from public.admin_role_proposals
   where profile_id = p_profile and make_admin = p_make_admin and closed_at is null
     and created_at > now() - interval '7 days'
   order by created_at desc limit 1 for update;

  if v_prop.id is not null and v_prop.proposed_by = v_uid then
    raise exception 'You already proposed this. A different admin must confirm it.' using errcode = 'P0001';
  end if;

  if v_prop.id is not null and private.is_admin_id(v_prop.proposed_by) then
    update public.profiles set is_admin = p_make_admin, updated_at = now() where id = p_profile;
    update public.admin_role_proposals set closed_at = now(), confirmed_by = v_uid where id = v_prop.id;
    perform private.audit(case when p_make_admin then 'admin.granted' else 'admin.revoked' end, 'profiles', p_profile::text,
      jsonb_build_object('proposed_by', v_prop.proposed_by, 'confirmed_by', v_uid));
    perform private.notify(p_profile, 'account',
      case when p_make_admin then 'You are now an admin' else 'Admin rights removed' end,
      case when p_make_admin then 'Two admins agreed to give you admin rights.' else 'Two admins agreed to remove your admin rights.' end);
    return 'done';
  end if;

  update public.admin_role_proposals set closed_at = now() where profile_id = p_profile and closed_at is null;
  insert into public.admin_role_proposals (profile_id, make_admin, proposed_by) values (p_profile, p_make_admin, v_uid);
  perform private.audit(case when p_make_admin then 'admin.grant_proposed' else 'admin.revoke_proposed' end,
                        'profiles', p_profile::text);
  return 'proposed';
end;
$$;

-- Open proposals the signed-in admin could confirm right now.
create or replace function public.admin_open_role_proposals()
returns setof public.admin_role_proposals language sql stable security definer set search_path = ''
as $$
  select p.* from public.admin_role_proposals p
   where private.is_admin()
     and p.closed_at is null
     and p.created_at > now() - interval '7 days'
     and private.is_admin_id(p.proposed_by)
   order by p.created_at
$$;

revoke execute on function public.admin_open_role_proposals() from public, anon;
grant execute on function public.admin_open_role_proposals() to authenticated;

create or replace function public.finance_summary()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_collected numeric := (select coalesce(sum(amount), 0) from public.payments where status = 'approved');
  v_spent numeric := (select coalesce(sum(amount), 0) from public.expenses where status = 'approved');
  v_today date := private.today();
  v_uid uuid := auth.uid();
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
      'pending_roles', (select count(*) from public.admin_open_role_proposals() p
                         where p.proposed_by <> v_uid and p.profile_id <> v_uid),
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
