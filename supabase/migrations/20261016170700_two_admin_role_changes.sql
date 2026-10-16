-- Migration 8: giving or removing admin rights takes two admins.
--
-- Security review finding: one admin could make two accounts they control
-- into admins, then use them as the "two admins" that approve a payment or
-- expense. Now one admin proposes a change and a different admin confirms it
-- within 7 days. The single-admin admin_set_admin is retired (no one may call it).

revoke execute on function public.admin_set_admin(uuid, boolean) from public, anon, authenticated;

create table public.admin_role_proposals (
  id           bigint generated always as identity primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  make_admin   boolean not null,
  proposed_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  -- Set when confirmed, or when superseded by a newer proposal.
  closed_at    timestamptz,
  confirmed_by uuid references public.profiles(id)
);
create index admin_role_proposals_open_idx on public.admin_role_proposals (profile_id) where closed_at is null;

alter table public.admin_role_proposals enable row level security;
create policy "admins read role proposals" on public.admin_role_proposals
  for select to authenticated using ((select private.is_admin()));
revoke all on public.admin_role_proposals from anon, authenticated;
grant select on public.admin_role_proposals to authenticated;

create or replace function private.is_admin_id(p_profile uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = p_profile and is_admin and account_status = 'active')
$$;

-- Returns 'proposed' (waiting for a second admin) or 'done'.
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
  if v_target.id is null or v_target.account_status <> 'active' then
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

  -- New proposal; it replaces any other open proposal for this person.
  update public.admin_role_proposals set closed_at = now() where profile_id = p_profile and closed_at is null;
  insert into public.admin_role_proposals (profile_id, make_admin, proposed_by) values (p_profile, p_make_admin, v_uid);
  perform private.audit(case when p_make_admin then 'admin.grant_proposed' else 'admin.revoke_proposed' end,
                        'profiles', p_profile::text);
  return 'proposed';
end;
$$;

revoke execute on function private.is_admin_id(uuid) from public, anon, authenticated;
revoke execute on function public.admin_change_role(uuid, boolean) from public, anon;
grant execute on function public.admin_change_role(uuid, boolean) to authenticated;

-- finance_summary gains a count of open admin-rights proposals for the to-do list.
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
      'pending_roles', (select count(*) from public.admin_role_proposals
                         where closed_at is null and created_at > now() - interval '7 days'),
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
